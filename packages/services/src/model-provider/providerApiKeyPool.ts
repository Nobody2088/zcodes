/* oxlint-disable eslint(max-lines) -- 号池分组、当前钥选择与探测分类必须共处一份纯函数，避免第二份 activeKey 真相。 */
export type OpenCodeApiKeyPoolFamily = "opencode-go" | "opencode-zen";

/** Host 拥有的额度查询模式，投影到号池视图。 */
export type ProviderApiKeyPoolQuotaQuery = "opencode" | "balance" | "channel" | "none";

export type ApiKeyPoolGroup =
  | "pool"
  | "cooling"
  | "exhausted"
  | "expired"
  | "invalid"
  | "unknown";

/** 余额制渠道的额度事实。unlimited 没有剩余数字时 credits 为 null。 */
export interface ApiKeyPoolBalanceFact {
  readonly scope: "personal" | "team";
  readonly credits: number | null;
  readonly limit: number | null;
  readonly used: number | null;
  readonly resetAt: number | null;
}

export interface ParsedApiKeyLine {
  readonly secret: string;
  readonly label: string | null;
}

export interface ParseBatchApiKeysResult {
  readonly added: readonly ParsedApiKeyLine[];
  readonly duplicate: readonly string[];
  readonly invalid: readonly string[];
  readonly skippedEmpty: number;
}

export interface OpenCodeUsageWindow {
  readonly status: "ok" | "rate-limited";
  readonly percent: number;
  readonly resetsAt: number;
}

export interface OpenCodeGoUsageClassification {
  readonly group: Extract<ApiKeyPoolGroup, "pool" | "cooling">;
  readonly remainingPercent: number;
  readonly resetAt: number | null;
  readonly availableAt: number | null;
  readonly membership: OpenCodeMembershipFact;
  readonly windows: {
    readonly rolling?: OpenCodeUsageWindow;
    readonly weekly?: OpenCodeUsageWindow;
    readonly monthly?: OpenCodeUsageWindow;
  };
}

export type OpenCodeKeyProbeAttempt =
  | {
      readonly kind: "http";
      readonly urlKind: "usage";
      readonly status: number;
      readonly json: unknown;
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: "http";
      readonly urlKind: "models";
      readonly status: number;
      readonly json: unknown;
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: "http";
      readonly urlKind: "balance";
      readonly status: number;
      readonly json: unknown;
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: "network";
      readonly message: string;
    };

export interface OpenCodeKeyProbeClassification {
  readonly group: ApiKeyPoolGroup;
  readonly remainingPercent: number | null;
  readonly resetAt: number | null;
  readonly availableAt: number | null;
  readonly probeError: "network" | "http" | "auth" | null;
  readonly membership?: OpenCodeMembershipFact;
  readonly windows?: OpenCodeGoUsageClassification["windows"];
  /** 本次探测的余额事实。null 表示清空；缺省表示保留上次。 */
  readonly balance?: ApiKeyPoolBalanceFact | null;
}

export interface OpenCodeMembershipFact {
  readonly state: "active" | "inactive";
  readonly renewsAt: number | null;
  readonly renewalAuthorizationRequired?: boolean;
}

const OPENCODE_GO_TEMPLATE_IDS = new Set([
  "opencode-go-chat",
  "opencode-go-messages",
  "opencode-go-responses",
]);

const OPENCODE_ZEN_TEMPLATE_IDS = new Set([
  "opencode-zen-chat",
  "opencode-zen-messages",
  "opencode-zen-responses",
]);

const MIN_API_KEY_LENGTH = 8;
const MAX_API_KEY_LABEL_LENGTH = 40;
const OFFICIAL_ZEN_BASE = /^https:\/\/opencode\.ai\/zen\/v1$/i;
const EXPIRED_MESSAGE = /expir/i;
const HAS_WHITESPACE = /\s/;
/** hostname 精确匹配。版本路径用于把聊天地址归一成余额接口，避免把 /chat/completions 接进探测 URL。 */
const BALANCE_QUOTA_HOSTS: Readonly<Record<string, string>> = {
  "api.b.ai": "/v1",
};

/** 设置卡上有 API Key 字段的个人供应商才进号池；账号 Coding Plan 仍走既有登录流。 */
export function supportsProviderApiKeyPool(
  access: { readonly type: string } | null | undefined,
): boolean {
  return access?.type === "api-key" || access?.type === "zhipu-coding-plan-api-key";
}

/** OpenCode 专用额度探测族；非 OpenCode 返回 null，仍可由 supportsProviderApiKeyPool 进池。 */
export function resolveOpenCodeApiKeyPoolFamily(
  templateId: string | null | undefined,
): OpenCodeApiKeyPoolFamily | null {
  const id = templateId?.trim() ?? "";
  if (!id) return null;
  if (OPENCODE_GO_TEMPLATE_IDS.has(id)) return "opencode-go";
  if (OPENCODE_ZEN_TEMPLATE_IDS.has(id)) return "opencode-zen";
  return null;
}

/**
 * 额度查询模式。OpenCode 模板先命中，避免 Base URL 被改成余额 host 时改走 /balance。
 * 其后按 hostname 识别余额制渠道，自定义供应商不必手填模板。
 */
export function resolveProviderApiKeyPoolQuotaQuery(
  templateId: string | null | undefined,
  baseUrl?: string | null,
): ProviderApiKeyPoolQuotaQuery {
  if (resolveOpenCodeApiKeyPoolFamily(templateId) != null) return "opencode";
  if (resolveBalanceQuotaUrl(baseUrl) != null) return "balance";
  const id = templateId?.trim() ?? "";
  if (!id) return "none";
  return "channel";
}

/** 已知余额 host 归一到 origin + 版本段 + /balance。非精确 hostname 返回 null。 */
export function resolveBalanceQuotaUrl(baseUrl: string | null | undefined): string | null {
  const raw = baseUrl?.trim() ?? "";
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const versionPath = BALANCE_QUOTA_HOSTS[url.hostname.toLowerCase()];
  if (!versionPath) return null;
  return `${url.origin}${versionPath}/balance`;
}

export function parseBatchApiKeys(
  text: string,
  existingSecrets: ReadonlySet<string>,
): ParseBatchApiKeysResult {
  const added: ParsedApiKeyLine[] = [];
  const duplicate: string[] = [];
  const invalid: string[] = [];
  let skippedEmpty = 0;
  const seen = new Set<string>();
  const lines = text.replace(/\s+$/u, "").split(/\r?\n/u);

  for (const line of lines) {
    const parsed = splitApiKeyLabel(line);
    if (!parsed) {
      skippedEmpty += 1;
      continue;
    }
    const { secret, label } = parsed;
    if (secret.length < MIN_API_KEY_LENGTH || HAS_WHITESPACE.test(secret)) {
      invalid.push(secret);
      continue;
    }
    if (existingSecrets.has(secret) || seen.has(secret)) {
      duplicate.push(secret);
      continue;
    }
    seen.add(secret);
    added.push({ secret, label });
  }

  return { added, duplicate, invalid, skippedEmpty };
}

function splitApiKeyLabel(line: string): { secret: string; label: string | null } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const hash = trimmed.indexOf("#");
  const secret = (hash === -1 ? trimmed : trimmed.slice(0, hash)).trim();
  const rawLabel = hash === -1 ? "" : trimmed.slice(hash + 1).trim();
  if (!secret) return null;
  const label = rawLabel ? rawLabel.slice(0, MAX_API_KEY_LABEL_LENGTH) : null;
  return { secret, label };
}

export function maskApiKey(secret: string): string {
  const value = secret.trim();
  if (value.length < MIN_API_KEY_LENGTH) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function deriveRemainingMs(
  availableAt: number | null | undefined,
  now: number,
): number | null {
  if (availableAt == null) return null;
  return Math.max(0, availableAt - now);
}

export function shouldReprobeCoolingKey(
  record: { readonly group: ApiKeyPoolGroup; readonly availableAt: number | null },
  now: number,
): boolean {
  return record.group === "cooling" && (record.availableAt == null || record.availableAt <= now);
}

export interface ActiveApiKeyCandidate {
  readonly id: string;
  readonly group: ApiKeyPoolGroup;
  readonly remainingPercent: number | null;
}

export const REQUEST_FAILURE_COOLING_MS = 60_000;

export function parsePooledRequestFailureStatus(message: string): 401 | 403 | 429 | null {
  if (/\b401\b/.test(message)) return 401;
  if (/\b403\b/.test(message)) return 403;
  if (/\b429\b/.test(message)) return 429;
  return null;
}

export function hasLeftApiKeyPool(group: ApiKeyPoolGroup): boolean {
  return (
    group === "cooling" || group === "exhausted" || group === "expired" || group === "invalid"
  );
}

export function resolveActiveApiKeyId(input: {
  readonly keys: readonly ActiveApiKeyCandidate[];
  readonly currentKeyId?: string | null;
  readonly requestedKeyId?: string | null;
  readonly excludedKeyIds?: readonly string[];
}): string | null {
  const excluded = new Set(input.excludedKeyIds ?? []);
  const pool = input.keys.filter((item) => item.group === "pool");
  const requested = input.requestedKeyId
    ? pool.find((item) => item.id === input.requestedKeyId && !excluded.has(item.id))
    : undefined;
  if (requested) return requested.id;

  const current = input.currentKeyId
    ? input.keys.find((item) => item.id === input.currentKeyId)
    : undefined;
  // overlay / 尚未探测的 unknown 不算离开号池；addKeys 探测到更高剩余时不得抢当前钥。
  if (current && !hasLeftApiKeyPool(current.group) && !excluded.has(current.id)) {
    return current.id;
  }

  const candidates = pool.filter((item) => !excluded.has(item.id));
  // 排除后没有其它号池成员时，unknown / 仍在号池的当前钥必须留下，不能写成 null。
  if (candidates.length === 0 && current && !hasLeftApiKeyPool(current.group)) {
    return current.id;
  }
  const usable = candidates.length > 0 ? candidates : pool;
  if (usable.length === 0) return null;

  let selected = usable[0]!;
  for (const item of usable) {
    if (remainingScore(item.remainingPercent) > remainingScore(selected.remainingPercent)) {
      selected = item;
    }
  }
  return selected.id;
}

function readProviderIdFromFailureText(text: string): string | null {
  const match = text.match(/provider=([^\s]+)/);
  return match?.[1]?.trim() || null;
}

export function readPooledRequestFailureFromTurnError(error: unknown): {
  readonly providerId: string;
  readonly status: 401 | 403 | 429;
} | null {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): { providerId: string; status: 401 | 403 | 429 } | null => {
    if (depth > 6 || !value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const record = asRecord(value);
    const attribution = asRecord(record.attribution);
    const context = asRecord(record.context);
    const message = readNonEmptyString(record.message) ?? "";
    const detail = readNonEmptyString(record.detail) ?? "";
    const providerId =
      readNonEmptyString(attribution.providerId) ??
      readNonEmptyString(context.providerId) ??
      readNonEmptyString(record.providerId) ??
      readProviderIdFromFailureText(detail) ??
      readProviderIdFromFailureText(message);
    const status =
      asPooledFailureStatus(attribution.statusCode) ??
      asPooledFailureStatus(context.statusCode) ??
      parsePooledRequestFailureStatus(message) ??
      parsePooledRequestFailureStatus(detail);
    if (providerId && status) return { providerId, status };
    return visit(record.cause, depth + 1) ?? visit(record.error, depth + 1);
  };
  return visit(error, 0);
}

function remainingScore(remainingPercent: number | null): number {
  return remainingPercent == null ? 100 : remainingPercent;
}

export function parseOpenCodeGoUsage(json: unknown): OpenCodeGoUsageClassification | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const usage = (json as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const record = usage as Record<string, unknown>;
  const rolling = parseUsageWindow(record.rolling);
  const weekly = parseUsageWindow(record.weekly);
  const monthly = parseUsageWindow(record.monthly);
  const windows = {
    ...(rolling ? { rolling } : {}),
    ...(weekly ? { weekly } : {}),
    ...(monthly ? { monthly } : {}),
  };
  const list = Object.values(windows);
  if (list.length === 0) return null;

  let maxPercent = 0;
  let cooling = false;
  let availableAt: number | null = null;
  let resetAt: number | null = null;
  for (const window of list) {
    maxPercent = Math.max(maxPercent, window.percent);
    resetAt = minTimestamp(resetAt, window.resetsAt);
    if (window.status === "rate-limited" || window.percent >= 100) {
      cooling = true;
      availableAt = minTimestamp(availableAt, window.resetsAt);
    }
  }

  const remainingPercent = Math.max(0, Math.min(100, 100 - maxPercent));
  const membership: OpenCodeMembershipFact = {
    state: "active",
    // 月窗口 resetsAt 是额度重置，不是会员到期。到期只认本钥响应里的订阅字段；
    // 官方 GET /zen/go/v1/usage（Bearer）目前没有这些字段。
    renewsAt: readSubscriptionRenewsAt(json),
    renewalAuthorizationRequired: rootRenewalAuthorizationRequired(json),
  };
  if (cooling) {
    return {
      group: "cooling",
      remainingPercent,
      resetAt: availableAt ?? resetAt,
      availableAt,
      membership,
      windows,
    };
  }
  return {
    group: "pool",
    remainingPercent,
    resetAt,
    availableAt: null,
    membership,
    windows,
  };
}

export function classifyOpenCodeKeyProbe(input: {
  readonly family: OpenCodeApiKeyPoolFamily | null;
  readonly quotaQuery?: ProviderApiKeyPoolQuotaQuery;
  readonly probes: readonly OpenCodeKeyProbeAttempt[];
  readonly previousGroup?: ApiKeyPoolGroup;
  readonly previousRemainingPercent?: number | null;
  readonly previousAvailableAt?: number | null;
}): OpenCodeKeyProbeClassification {
  const previous = rememberPrevious(input);
  const balance = input.probes.find(
    (probe): probe is Extract<OpenCodeKeyProbeAttempt, { kind: "http"; urlKind: "balance" }> =>
      probe.kind === "http" && probe.urlKind === "balance",
  );
  // 余额响应只按 /balance 分类。没有探测结果时不能当成「无额度数字也可入池」。
  if (balance) return classifyBalanceHttp(balance, previous);
  if (input.quotaQuery === "balance") {
    const balanceNetwork = input.probes.find((probe) => probe.kind === "network");
    if (balanceNetwork) return { ...unknownFrom(previous, "network") };
    return { ...unknownFrom(previous, "http") };
  }
  const usage = input.probes.find(
    (probe): probe is Extract<OpenCodeKeyProbeAttempt, { kind: "http"; urlKind: "usage" }> =>
      probe.kind === "http" && probe.urlKind === "usage",
  );
  const models = input.probes.find(
    (probe): probe is Extract<OpenCodeKeyProbeAttempt, { kind: "http"; urlKind: "models" }> =>
      probe.kind === "http" && probe.urlKind === "models",
  );
  const network = input.probes.find((probe) => probe.kind === "network");

  // 非 OpenCode：无 usage；无 models 探测结果时视为可用（等请求失败再 noteRequestFailure）。
  if (input.family == null && !usage && !models && !network) {
    return {
      group: "pool",
      remainingPercent: null,
      resetAt: null,
      availableAt: null,
      probeError: null,
    };
  }

  if (usage && input.family != null) {
    const auth = classifyAuthFailure(usage);
    if (auth) return auth;
    if (usage.status === 200) {
      const parsed = parseOpenCodeGoUsage(usage.json);
      if (parsed) {
        return {
          group: parsed.group,
          remainingPercent: parsed.remainingPercent,
          resetAt: parsed.resetAt,
          availableAt: parsed.availableAt,
          probeError: null,
          membership: parsed.membership,
          windows: parsed.windows,
        };
      }
      return { ...unknownFrom(previous, "http") };
    }
    if (usage.status === 429) {
      return classifyRateLimited(usage, previous);
    }
    if (usage.status === 403 && input.family === "opencode-go" && isGoSubscriptionMissing(usage)) {
      // 额度接口的 EntitlementError 表示 Go 会员已不在，和模型 RegionError 不是同一件事。
      return {
        group: "expired",
        remainingPercent: null,
        resetAt: null,
        availableAt: null,
        probeError: null,
        membership: { state: "inactive", renewsAt: null },
      };
    }
    if (usage.status === 403 && input.family === "opencode-go") {
      // 其余 Go 403（例如模型 RegionError）不能整钥标 Invalid，否则 getView 会换掉还能用的 overlay。
      return { ...unknownFrom(previous, "http") };
    }
    if (!(usage.status === 403 || usage.status === 404) || input.family === "opencode-go") {
      return { ...unknownFrom(previous, "http") };
    }
  }

  if (models) {
    const auth = classifyAuthFailure(models);
    if (auth) return auth;
    if (models.status === 200) {
      return {
        group: "pool",
        remainingPercent: null,
        resetAt: null,
        availableAt: null,
        probeError: null,
      };
    }
    if (models.status === 429) {
      return classifyRateLimited(models, previous);
    }
    return { ...unknownFrom(previous, "http") };
  }

  if (network) {
    return { ...unknownFrom(previous, "network") };
  }
  return { ...unknownFrom(previous, "http") };
}

export function resolveOpenCodeUsageUrl(
  family: OpenCodeApiKeyPoolFamily,
  baseUrl: string,
): string | null {
  const root = trimTrailingSlash(baseUrl.trim());
  if (!root) return null;
  if (family === "opencode-zen" && OFFICIAL_ZEN_BASE.test(root)) {
    return "https://opencode.ai/zen/go/v1/usage";
  }
  return `${root}/usage`;
}

function parseUsageWindow(value: unknown): OpenCodeUsageWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const status = record.status === "ok" || record.status === "rate-limited" ? record.status : null;
  const percent =
    typeof record.percent === "number" && Number.isFinite(record.percent) ? record.percent : null;
  const resetsAt = parseTimestamp(record.resetsAt);
  if (!status || percent === null || resetsAt == null) return undefined;
  return { status, percent, resetsAt };
}

function rootRenewalAuthorizationRequired(json: unknown): boolean | undefined {
  const value = asRecord(json).renewalAuthorizationRequired;
  return typeof value === "boolean" ? value : undefined;
}

function readSubscriptionRenewsAt(json: unknown): number | null {
  const root = asRecord(json);
  const subscription = asRecord(root.subscription);
  const billing = asRecord(root.billing);
  const access = asRecord(root.access);
  const candidates = [
    access.endsAt,
    subscription.renewsAt,
    subscription.currentPeriodEnd,
    subscription.expiresAt,
    billing.renewsAt,
    billing.currentPeriodEnd,
    billing.mandateExpiresAt,
    root.renewsAt,
  ];
  for (const value of candidates) {
    const parsed = parseTimestamp(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function minTimestamp(current: number | null, next: number): number {
  return current == null ? next : Math.min(current, next);
}

function readErrorMessage(json: unknown): string {
  if (!json || typeof json !== "object" || Array.isArray(json)) return "";
  const record = json as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  const error = record.error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const nested = error as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
  }
  return "";
}

function isGoSubscriptionMissing(
  probe: Extract<OpenCodeKeyProbeAttempt, { kind: "http" }>,
): boolean {
  if (probe.status !== 403) return false;
  const record =
    probe.json && typeof probe.json === "object" && !Array.isArray(probe.json)
      ? (probe.json as Record<string, unknown>)
      : {};
  const error =
    record.error && typeof record.error === "object" && !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : {};
  const type = typeof error.type === "string" ? error.type : "";
  if (type === "EntitlementError") return true;
  return /subscription required/i.test(readErrorMessage(probe.json));
}

function classifyAuthFailure(
  probe: Extract<OpenCodeKeyProbeAttempt, { kind: "http" }>,
): OpenCodeKeyProbeClassification | null {
  if (probe.status !== 401 && probe.status !== 403) return null;
  if (probe.status === 403) return null;
  const expired = EXPIRED_MESSAGE.test(readErrorMessage(probe.json));
  return {
    group: expired ? "expired" : "invalid",
    remainingPercent: null,
    resetAt: null,
    availableAt: null,
    probeError: "auth",
    balance: null,
  };
}

function classifyBalanceHttp(
  probe: Extract<OpenCodeKeyProbeAttempt, { kind: "http"; urlKind: "balance" }>,
  previous: PreviousProbeMemory,
): OpenCodeKeyProbeClassification {
  const auth = classifyAuthFailure(probe);
  if (auth) return auth;
  if (probe.status === 429) return classifyRateLimited(probe, previous);
  if (probe.status !== 200) return { ...unknownFrom(previous, "http") };
  if (asRecord(probe.json).success === false) return { ...unknownFrom(previous, "http") };
  const fact = parseBalanceFact(probe.json);
  if (!fact) return { ...unknownFrom(previous, "http") };
  return classificationFromBalance(fact);
}

function classificationFromBalance(fact: ApiKeyPoolBalanceFact): OpenCodeKeyProbeClassification {
  if (fact.credits == null) {
    return {
      group: "pool",
      remainingPercent: null,
      resetAt: null,
      availableAt: null,
      probeError: null,
      balance: fact,
    };
  }
  if (fact.credits <= 0) {
    // 没有重置时间的 0 余额不会自行恢复，不能放进冷却复检。
    if (fact.resetAt != null) {
      return {
        group: "cooling",
        remainingPercent: 0,
        resetAt: fact.resetAt,
        availableAt: fact.resetAt,
        probeError: null,
        balance: fact,
      };
    }
    return {
      group: "exhausted",
      remainingPercent: 0,
      resetAt: null,
      availableAt: null,
      probeError: null,
      balance: fact,
    };
  }
  return {
    group: "pool",
    remainingPercent: balanceRemainingPercent(fact),
    resetAt: fact.resetAt,
    availableAt: null,
    probeError: null,
    balance: fact,
  };
}

function balanceRemainingPercent(fact: ApiKeyPoolBalanceFact): number | null {
  if (fact.limit == null || fact.limit <= 0 || fact.used == null) return null;
  return Math.max(0, Math.min(100, 100 - (fact.used / fact.limit) * 100));
}

function parseBalanceFact(json: unknown): ApiKeyPoolBalanceFact | null {
  const data = asRecord(asRecord(json).data);
  const resetAt = parseTimestamp(data.quota_reset_at);
  if (data.api_key_type === "personal") {
    const credits = readFiniteNumber(data.personal_balance);
    if (credits == null) return null;
    return { scope: "personal", credits, limit: null, used: null, resetAt: null };
  }
  if (data.api_key_type !== "team") return null;
  if (data.quota_limit_type === "unlimited") {
    return { scope: "team", credits: null, limit: null, used: null, resetAt: null };
  }
  if (data.quota_limit_type !== "limited") return null;
  const limit = readFiniteNumber(data.member_quota_limit);
  const used = readFiniteNumber(data.member_quota_used);
  const teamBalance = readFiniteNumber(data.team_balance);
  const credits = limit != null && used != null ? Math.max(0, limit - used) : teamBalance;
  if (credits == null) return null;
  return { scope: "team", credits, limit, used, resetAt };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function classifyRateLimited(
  probe: Extract<OpenCodeKeyProbeAttempt, { kind: "http" }>,
  previous: PreviousProbeMemory,
): OpenCodeKeyProbeClassification {
  const availableAt =
    probe.retryAfterMs != null ? Date.now() + probe.retryAfterMs : previous.availableAt;
  return {
    group: "cooling",
    remainingPercent: 0,
    resetAt: availableAt,
    availableAt,
    probeError: null,
  };
}

interface PreviousProbeMemory {
  readonly group: ApiKeyPoolGroup;
  readonly remainingPercent: number | null;
  readonly availableAt: number | null;
}

function rememberPrevious(input: {
  readonly previousGroup?: ApiKeyPoolGroup;
  readonly previousRemainingPercent?: number | null;
  readonly previousAvailableAt?: number | null;
}): PreviousProbeMemory {
  return {
    group: input.previousGroup ?? "unknown",
    remainingPercent: input.previousRemainingPercent ?? null,
    availableAt: input.previousAvailableAt ?? null,
  };
}

function unknownFrom(
  previous: PreviousProbeMemory,
  probeError: OpenCodeKeyProbeClassification["probeError"],
): OpenCodeKeyProbeClassification {
  return {
    group: previous.group,
    remainingPercent: previous.remainingPercent,
    resetAt: null,
    availableAt: previous.availableAt,
    probeError,
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPooledFailureStatus(value: unknown): 401 | 403 | 429 | null {
  return value === 401 || value === 403 || value === 429 ? value : null;
}
