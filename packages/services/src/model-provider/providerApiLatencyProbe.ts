import type { ProviderApiType } from "@zcode/provider";
import type { ProviderApiLatencyProbeResult } from "@zcode/shared";
import {
  buildRemoteModelCatalogHeaders,
  resolveRemoteModelCatalogUrl,
} from "./providerRemoteModelCatalog.js";

const PROBE_TIMEOUT_MS = 15_000;

export interface ProbeProviderApiLatencyInput {
  readonly apiType: ProviderApiType;
  readonly baseUrl: string;
  readonly apiKey?: string | null;
  readonly extraHeaders?: Readonly<Record<string, string>> | null;
  readonly request?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly now?: () => number;
}

/**
 * 轻量模型商延迟探测：GET /models（或 anthropic 等价路径），不发起 chat completion。
 * 收到任意 HTTP 响应即视为路径可达并回报 RTT；网络错误 fail-closed。
 */
export async function probeProviderApiLatency(
  input: ProbeProviderApiLatencyInput,
): Promise<ProviderApiLatencyProbeResult> {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) {
    return { ok: false, latencyMs: null, error: "missing_base_url" };
  }
  let url: string;
  try {
    url = resolveRemoteModelCatalogUrl(input.apiType, baseUrl);
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const request = input.request ?? globalThis.fetch.bind(globalThis);
  const now = input.now ?? Date.now;
  const startedAt = now();
  try {
    const response = await request(url, {
      method: "GET",
      headers: buildRemoteModelCatalogHeaders(input.apiType, input.apiKey, input.extraHeaders),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // 消耗 body 但不解析密钥；状态码仅用于展示，401/403 仍算延迟成功。
    await response.arrayBuffer().catch(() => undefined);
    return {
      ok: true,
      latencyMs: Math.max(0, now() - startedAt),
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
