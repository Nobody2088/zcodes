import type { ProviderApiType } from "@zcode/provider";
import {
  buildRemoteModelCatalogHeaders,
  resolveRemoteModelCatalogUrl,
} from "./providerRemoteModelCatalog.js";
import {
  parseOpenCodeGoUsage,
  resolveBalanceQuotaUrl,
  resolveOpenCodeUsageUrl,
  type OpenCodeApiKeyPoolFamily,
  type OpenCodeKeyProbeAttempt,
  type ProviderApiKeyPoolQuotaQuery,
} from "./providerApiKeyPool.js";

const PROBE_TIMEOUT_MS = 15_000;

type ProbeRequest = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ProbeProviderApiKeyInput {
  readonly family: OpenCodeApiKeyPoolFamily | null;
  /** Service 已经判定的模式。缺省时按 family 回退，避免旧调用把 OpenCode 打成 models。 */
  readonly quotaQuery?: ProviderApiKeyPoolQuotaQuery;
  readonly apiType: ProviderApiType;
  readonly baseUrl: string;
  readonly extraHeaders?: Readonly<Record<string, string>> | null;
  readonly secret: string;
  readonly request?: ProbeRequest;
}

/** @deprecated 使用 ProbeProviderApiKeyInput；保留别名避免旧测试 import 断裂。 */
export type ProbeOpenCodeApiKeyInput = ProbeProviderApiKeyInput;

export async function probeProviderApiKey(
  input: ProbeProviderApiKeyInput,
): Promise<readonly OpenCodeKeyProbeAttempt[]> {
  const request = input.request ?? fetch;
  const attempts: OpenCodeKeyProbeAttempt[] = [];
  const baseUrl = input.baseUrl.trim();
  const quotaQuery = input.quotaQuery ?? (input.family != null ? "opencode" : "channel");

  if (quotaQuery === "none") return attempts;

  if (quotaQuery === "balance") {
    // /models 在余额为 0 时仍可能 200，不能用目录探测代替余额接口。
    const balanceUrl = resolveBalanceQuotaUrl(baseUrl);
    if (!balanceUrl) return attempts;
    attempts.push(await requestProbe(request, balanceUrl, "balance", input));
    return attempts;
  }

  if (quotaQuery === "opencode" && input.family != null) {
    const usageUrl = resolveOpenCodeUsageUrl(input.family, baseUrl);
    if (usageUrl) {
      attempts.push(await requestProbe(request, usageUrl, "usage", input));
    }
    if (shouldProbeModels(input.family, attempts[0])) {
      if (!baseUrl) return attempts;
      const modelsUrl = resolveRemoteModelCatalogUrl(input.apiType, baseUrl);
      attempts.push(await requestProbe(request, modelsUrl, "models", input));
    }
    return attempts;
  }

  // 非 OpenCode：只做 models 鉴权；无 Base URL 时返回空 attempts，分类器会直接入 Pool。
  if (!baseUrl) return attempts;
  const modelsUrl = resolveRemoteModelCatalogUrl(input.apiType, baseUrl);
  attempts.push(await requestProbe(request, modelsUrl, "models", input));
  return attempts;
}

/** @deprecated 使用 probeProviderApiKey。 */
export async function probeOpenCodeApiKey(
  input: ProbeOpenCodeApiKeyInput,
): Promise<readonly OpenCodeKeyProbeAttempt[]> {
  return probeProviderApiKey(input);
}

function shouldProbeModels(
  family: OpenCodeApiKeyPoolFamily,
  usage: OpenCodeKeyProbeAttempt | undefined,
): boolean {
  if (family !== "opencode-zen") return false;
  if (!usage) return true;
  if (usage.kind === "network") return true;
  if (usage.status === 200) return parseOpenCodeGoUsage(usage.json) == null;
  return usage.status === 403 || usage.status === 404;
}

async function requestProbe(
  request: ProbeRequest,
  url: string,
  urlKind: "usage" | "models" | "balance",
  input: ProbeProviderApiKeyInput,
): Promise<OpenCodeKeyProbeAttempt> {
  try {
    const response = await request(url, {
      method: "GET",
      headers: buildRemoteModelCatalogHeaders(input.apiType, input.secret, input.extraHeaders),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return {
      kind: "http",
      urlKind,
      status: response.status,
      json: await readJson(response),
      ...(parseRetryAfterMs(response.headers.get("retry-after")) === undefined
        ? {}
        : { retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")) }),
    };
  } catch (error) {
    return {
      kind: "network",
      message: error instanceof Error ? error.message : "network",
    };
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}
