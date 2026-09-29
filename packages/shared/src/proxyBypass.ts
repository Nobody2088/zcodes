/**
 * 代理绕过：默认本地规则、CIDR 包含匹配、有效 NO_PROXY 解析。
 * 纯函数，无 IO。详见 specs/http-proxy-egress.md。
 */

/** 未保存显式列表时的运行时默认绕过（逗号拼接见 DEFAULT_LOCAL_PROXY_BYPASS）。 */
export const DEFAULT_LOCAL_PROXY_BYPASS_RULES = [
  "localhost",
  "127.0.0.1",
  "::1",
  "169.254.0.0/16",
  "fe80::/10",
] as const;

/** 默认绕过字符串，供 UI 文案与 Electron proxyBypassRules 使用。 */
export const DEFAULT_LOCAL_PROXY_BYPASS = DEFAULT_LOCAL_PROXY_BYPASS_RULES.join(",");

export type ProxyBypassToken =
  | { kind: "all" }
  | { kind: "host"; host: string; port?: string }
  | { kind: "cidr"; network: bigint; prefixLength: number; bits: 32 | 128; port?: string }
  | { kind: "invalid-cidr"; raw: string };

/**
 * 用户未填写时使用默认本地绕过；已有显式列表则原样规范化，不合并默认项以免覆盖用户意图。
 */
export function resolveEffectiveNoProxy(userNoProxy?: string | null): string {
  const normalized = normalizeNoProxyList(userNoProxy);
  return normalized ?? DEFAULT_LOCAL_PROXY_BYPASS;
}

/** 规范化逗号列表；全空返回 undefined。 */
export function normalizeNoProxyList(value?: string | null): string | undefined {
  const tokens = (value ?? "")
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length > 0 ? tokens.join(",") : undefined;
}

/**
 * 校验绕过列表。含 `/` 的 token 必须是合法 CIDR，否则列入 invalidRules。
 * 空串合法（表示回退默认）。
 */
export function validateNoProxyRules(
  value: string,
): { ok: true; normalized: string } | { ok: false; invalidRules: string[] } {
  const rawTokens = value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const invalidRules: string[] = [];
  for (const raw of rawTokens) {
    const parsed = parseProxyBypassToken(raw);
    if (parsed?.kind === "invalid-cidr") {
      invalidRules.push(raw);
    }
  }
  if (invalidRules.length > 0) {
    return { ok: false, invalidRules };
  }
  return { ok: true, normalized: rawTokens.join(",") };
}

export function matchesProxyBypass(requestUrl: string | URL, noProxy?: string | null): boolean {
  let url: URL;
  try {
    url = typeof requestUrl === "string" ? new URL(requestUrl) : requestUrl;
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  const effective = resolveEffectiveNoProxy(noProxy);
  const host = normalizeBypassHost(url.hostname);
  if (!host) return false;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const hostIp = tryParseIpAddress(host);

  for (const raw of effective.split(",")) {
    const token = parseProxyBypassToken(raw);
    if (!token || token.kind === "invalid-cidr") continue;
    if (token.kind === "all") return true;
    if (token.port && token.port !== port) continue;
    if (token.kind === "cidr") {
      if (!hostIp || hostIp.bits !== token.bits) continue;
      if (ipInCidr(hostIp.value, token.network, token.prefixLength, token.bits)) {
        return true;
      }
      continue;
    }
    if (matchesBypassHost(host, token.host)) {
      return true;
    }
  }
  return false;
}

/** 代理启用时：未绕过 → proxy；绕过或无代理 → direct。 */
export function resolveProxyRouteDecision(
  requestUrl: string | URL,
  options: { httpProxy?: string | null; noProxy?: string | null },
): "proxy" | "direct" {
  const proxy = options.httpProxy?.trim();
  if (!proxy) return "direct";
  return matchesProxyBypass(requestUrl, options.noProxy) ? "direct" : "proxy";
}

export function parseProxyBypassToken(rawToken: string): ProxyBypassToken | undefined {
  const trimmed = rawToken.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "*") return { kind: "all" };

  if (trimmed.includes("/")) {
    return parseCidrBypassToken(trimmed);
  }

  if (trimmed.includes("://")) {
    try {
      const parsed = new URL(trimmed);
      return {
        kind: "host",
        host: normalizeBypassHost(parsed.hostname),
        port: parsed.port || undefined,
      };
    } catch {
      return undefined;
    }
  }

  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close > 1) {
      const host = normalizeBypassHost(trimmed.slice(1, close));
      const rest = trimmed.slice(close + 1);
      const port = rest.startsWith(":") ? rest.slice(1) : undefined;
      return { kind: "host", host, ...(port ? { port } : {}) };
    }
  }

  // IPv6 字面量含多个冒号，不能按 host:port 切。
  if (trimmed.includes(":") && looksLikeIpv6(trimmed)) {
    return { kind: "host", host: normalizeBypassHost(trimmed) };
  }

  const separatorIndex = trimmed.lastIndexOf(":");
  const hasPort = separatorIndex > 0 && trimmed.indexOf(":") === separatorIndex;
  if (!hasPort) {
    return { kind: "host", host: normalizeBypassHost(trimmed) };
  }

  return {
    kind: "host",
    host: normalizeBypassHost(trimmed.slice(0, separatorIndex)),
    port: trimmed.slice(separatorIndex + 1),
  };
}

function parseCidrBypassToken(trimmed: string): ProxyBypassToken {
  const slash = trimmed.indexOf("/");
  const addressPart = trimmed.slice(0, slash);
  const prefixPart = trimmed.slice(slash + 1);
  const portSplit = prefixPart.includes(":") ? prefixPart.split(":") : [prefixPart];
  const prefixText = portSplit[0] ?? "";
  const port = portSplit.length > 1 ? portSplit.slice(1).join(":") : undefined;
  const prefixLength = Number(prefixText);
  const ip = tryParseIpAddress(addressPart.replace(/^\[|\]$/g, ""));
  if (
    !ip ||
    !Number.isInteger(prefixLength) ||
    prefixLength < 0 ||
    prefixLength > ip.bits ||
    (port !== undefined && port.length === 0)
  ) {
    return { kind: "invalid-cidr", raw: trimmed };
  }
  const network = ip.value & prefixMask(prefixLength, ip.bits);
  return {
    kind: "cidr",
    network,
    prefixLength,
    bits: ip.bits,
    ...(port ? { port } : {}),
  };
}

function matchesBypassHost(host: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  if (pattern.startsWith(".")) {
    const suffix = pattern.slice(1);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === pattern || host.endsWith(`.${pattern}`);
}

function normalizeBypassHost(value: string): string {
  return value
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function looksLikeIpv6(value: string): boolean {
  return value.includes("::") || value.split(":").length > 2;
}

function tryParseIpAddress(value: string): { value: bigint; bits: 32 | 128 } | undefined {
  const v4 = parseIpv4(value);
  if (v4 !== undefined) return { value: v4, bits: 32 };
  const v6 = parseIpv6(value);
  if (v6 !== undefined) return { value: v6, bits: 128 };
  return undefined;
}

function parseIpv4(value: string): bigint | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
    result = (result << 8n) + BigInt(n);
  }
  return result;
}

function parseIpv6(value: string): bigint | undefined {
  const trimmed = value.trim().toLowerCase();
  // 不做 IPv4-mapped 混写，避免与 hostname 歧义。
  if (!trimmed.includes(":") || trimmed.includes(".")) return undefined;
  if (!/^[0-9a-f:]+$/.test(trimmed)) return undefined;
  const sides = trimmed.split("::");
  if (sides.length > 2) return undefined;
  const parseSide = (side: string): number[] | undefined => {
    if (!side) return [];
    const parts = side.split(":");
    const out: number[] = [];
    for (const part of parts) {
      if (!part || part.length > 4 || !/^[0-9a-f]+$/.test(part)) return undefined;
      out.push(Number.parseInt(part, 16));
    }
    return out;
  };
  if (sides.length === 1) {
    const parts = parseSide(sides[0]!);
    if (!parts || parts.length !== 8) return undefined;
    return packIpv6(parts);
  }
  const head = parseSide(sides[0]!);
  const tail = parseSide(sides[1]!);
  if (!head || !tail) return undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return packIpv6([...head, ...Array.from({ length: missing }, () => 0), ...tail]);
}

function packIpv6(parts: readonly number[]): bigint {
  return parts.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
}

function prefixMask(prefixLength: number, bits: 32 | 128): bigint {
  if (prefixLength <= 0) return 0n;
  if (prefixLength >= bits) {
    return bits === 32 ? 0xffff_ffffn : (1n << 128n) - 1n;
  }
  const width = BigInt(bits);
  const prefix = BigInt(prefixLength);
  return ((1n << prefix) - 1n) << (width - prefix);
}

function ipInCidr(
  address: bigint,
  network: bigint,
  prefixLength: number,
  bits: 32 | 128,
): boolean {
  const mask = prefixMask(prefixLength, bits);
  return (address & mask) === (network & mask);
}
