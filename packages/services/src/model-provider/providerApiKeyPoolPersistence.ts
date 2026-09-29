import { createHash } from "node:crypto";
import { isApiKeyAccess, type ProviderConfigObject } from "@zcode/provider";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ICredentialService } from "../credential/credential.js";
import type { IProviderSettingsService } from "./providerFacadeServices.js";
import {
  classifyOpenCodeKeyProbe,
  maskApiKey,
  shouldReprobeCoolingKey,
  type ApiKeyPoolBalanceFact,
  type ApiKeyPoolGroup,
  type OpenCodeApiKeyPoolFamily,
  type OpenCodeGoUsageClassification,
  type OpenCodeMembershipFact,
  type ProviderApiKeyPoolQuotaQuery,
} from "./providerApiKeyPool.js";
import type {
  ProviderApiKeyPoolKeyView,
  ProviderApiKeyPoolUsageWindowId,
  ProviderApiKeyPoolUsageWindowView,
  ProviderApiKeyPoolView,
} from "./providerApiKeyPoolContract.js";

const STORE_VERSION = 1;
const log = createServiceLogger("provider-api-key-pool");

export interface StoredApiKey {
  readonly keyId: string;
  readonly secret: string;
  readonly addedAt: number;
  lastCheckedAt: number | null;
  group: ApiKeyPoolGroup;
  remainingPercent: number | null;
  resetAt: number | null;
  availableAt: number | null;
  probeError: "network" | "http" | "auth" | null;
  windows?: OpenCodeGoUsageClassification["windows"];
  membership?: OpenCodeMembershipFact;
  balance?: ApiKeyPoolBalanceFact;
  label: string | null;
}

export function createStoredKey(
  secret: string,
  addedAt: number,
  label: string | null = null,
): StoredApiKey {
  return {
    keyId: createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16),
    secret,
    addedAt,
    lastCheckedAt: null,
    group: "unknown",
    remainingPercent: null,
    resetAt: null,
    availableAt: null,
    probeError: null,
    label,
  };
}

export function applyClassification(
  record: StoredApiKey,
  classified: ReturnType<typeof classifyOpenCodeKeyProbe>,
  checkedAt: number,
): void {
  record.group = classified.group;
  record.remainingPercent = classified.remainingPercent;
  record.resetAt = classified.resetAt;
  record.availableAt = classified.availableAt;
  record.probeError = classified.probeError;
  record.lastCheckedAt = checkedAt;
  record.windows = classified.windows;
  if (classified.balance !== undefined) {
    record.balance = classified.balance ?? undefined;
  }
  if (classified.balance) {
    // 余额事实与 OpenCode 会员到期不是同一件事，不能留着上一轮 membership。
    record.membership = undefined;
  }
  if (!classified.membership) return;
  record.balance = undefined;
  if (classified.membership.state === "inactive") {
    record.membership = classified.membership;
    return;
  }
  // 官方 Bearer /usage 不返回会员到期。只认本钥本次探测字段；不得沿用控制台 cookie
  // 写入或其它 Key 共享的 renewsAt / renewalAuthorizationRequired。
  record.membership = {
    state: "active",
    renewsAt: classified.membership.renewsAt ?? null,
    renewalAuthorizationRequired: classified.membership.renewalAuthorizationRequired === true,
  };
}

export async function loadApiKeyPoolStore(
  credentialService: Pick<ICredentialService, "load">,
  providerId: string,
): Promise<{ keys: StoredApiKey[]; activeKeyId: string | null }> {
  const raw = await credentialService.load(credentialStoreKey(providerId));
  if (!raw) return { keys: [], activeKeyId: null };
  const parsed = JSON.parse(raw) as { version?: unknown; keys?: unknown; activeKeyId?: unknown };
  if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.keys)) {
    throw new Error("API Key pool store is corrupt");
  }
  return {
    keys: parsed.keys.map((item) => ({ ...(item as StoredApiKey) })),
    activeKeyId:
      typeof parsed.activeKeyId === "string" && parsed.activeKeyId ? parsed.activeKeyId : null,
  };
}

export async function saveApiKeyPoolStore(
  credentialService: Pick<ICredentialService, "save">,
  providerId: string,
  keys: readonly StoredApiKey[],
  activeKeyId: string | null,
): Promise<void> {
  await credentialService.save(
    credentialStoreKey(providerId),
    JSON.stringify({ version: STORE_VERSION, activeKeyId, keys }),
  );
}

export function importOverlayKey(
  keys: StoredApiKey[],
  config: ProviderConfigObject | undefined,
  addedAt: number,
): void {
  if (!isApiKeyAccess(config?.access)) return;
  const secret = config.access.apiKey?.trim() ?? "";
  if (!secret || keys.some((item) => item.secret === secret)) return;
  keys.push(createStoredKey(secret, addedAt));
}

export function resolveCurrentKeyId(
  keys: readonly StoredApiKey[],
  storedActiveKeyId: string | null,
  config: ProviderConfigObject | undefined,
): string | null {
  if (storedActiveKeyId && keys.some((item) => item.keyId === storedActiveKeyId)) {
    return storedActiveKeyId;
  }
  if (!isApiKeyAccess(config?.access)) return null;
  const secret = config.access.apiKey?.trim() ?? "";
  if (!secret) return null;
  return keys.find((item) => item.secret === secret)?.keyId ?? null;
}

export async function syncActiveOverlay(
  providerSettings: Pick<IProviderSettingsService, "getView" | "savePersonalProviderOverlay">,
  providerId: string,
  keys: readonly StoredApiKey[],
  activeKeyId: string | null,
): Promise<void> {
  try {
    const view = await providerSettings.getView();
    const provider = view.providers.find((item) => item.providerId === providerId);
    if (!provider) return;
    const selected = activeKeyId ? keys.find((item) => item.keyId === activeKeyId) : undefined;
    const personal = provider.personalConfig ?? {};
    const { builtinModelIds: _b, personalModelIds: _p, ...overlay } = personal;
    const currentAccess = isApiKeyAccess(overlay.access)
      ? overlay.access
      : { type: "api-key" as const };
    const nextKey = selected?.secret ?? null;
    if ((currentAccess.apiKey ?? null) === nextKey) return;
    await providerSettings.savePersonalProviderOverlay(providerId, {
      ...overlay,
      access: {
        type: "api-key",
        apiKey: nextKey,
        ...(currentAccess.apiKeyManagementUrl === undefined
          ? {}
          : { apiKeyManagementUrl: currentAccess.apiKeyManagementUrl }),
      },
    });
  } catch (error) {
    log.warn(undefined, "failed to sync active api key overlay", {
      providerId,
      error: error instanceof Error ? error.message : "overlay",
    });
  }
}

export function projectApiKeyPoolView(
  providerId: string,
  family: OpenCodeApiKeyPoolFamily | null,
  keys: readonly StoredApiKey[],
  supported: boolean,
  revision: number,
  activeKeyId: string | null,
  quotaQuery: ProviderApiKeyPoolQuotaQuery,
): ProviderApiKeyPoolView {
  return {
    providerId,
    supported,
    family,
    quotaQuery,
    revision,
    activeKeyId,
    keys: keys.map(
      (item): ProviderApiKeyPoolKeyView => ({
        keyId: item.keyId,
        maskedKey: maskApiKey(item.secret),
        label: item.label ?? null,
        group: item.group,
        lastCheckedAt: item.lastCheckedAt,
        remainingPercent: item.remainingPercent,
        resetAt: item.resetAt,
        availableAt: item.availableAt,
        probeError: item.probeError,
        windows: projectUsageWindows(item.windows),
        membership: {
          state: item.membership?.state ?? "unknown",
          renewsAt: item.membership?.renewsAt ?? null,
          renewalAuthorizationRequired: item.membership?.renewalAuthorizationRequired === true,
        },
        balance: item.balance ?? null,
      }),
    ),
  };
}

/** 自定义渠道（quotaQuery=none）：本地提升 unknown / 到期 cooling，不发 HTTP。 */
export function promoteNoneQuotaQueryKeys(keys: StoredApiKey[], now: number): void {
  for (const record of keys) {
    if (record.group === "unknown") {
      record.group = "pool";
      record.remainingPercent = null;
      record.resetAt = null;
      record.availableAt = null;
      record.probeError = null;
      record.lastCheckedAt = null;
      record.windows = undefined;
      continue;
    }
    if (shouldReprobeCoolingKey(record, now)) {
      record.group = "pool";
      record.availableAt = null;
      record.remainingPercent = null;
      record.resetAt = null;
      record.probeError = null;
      record.windows = undefined;
    }
  }
}

const USAGE_WINDOW_ORDER = [
  "rolling",
  "weekly",
  "monthly",
] as const satisfies readonly ProviderApiKeyPoolUsageWindowId[];

function projectUsageWindows(
  windows: StoredApiKey["windows"],
): readonly ProviderApiKeyPoolUsageWindowView[] {
  if (!windows) return [];
  const projected: ProviderApiKeyPoolUsageWindowView[] = [];
  for (const windowId of USAGE_WINDOW_ORDER) {
    const window = windows[windowId];
    if (!window) continue;
    projected.push({
      window: windowId,
      status: window.status,
      usedPercent: window.percent,
      resetsAt: window.resetsAt,
    });
  }
  return projected;
}

function credentialStoreKey(providerId: string): string {
  return `provider-api-key-pool:${providerId}`;
}
