export const MAX_SOCKS5_PROXY_CHAIN_HOPS = 5;
export const LOCAL_PROXY_CHAIN_HTTP_PORT = 47821;
export const LOCAL_PROXY_CHAIN_SOCKS_PORT = 47822;

export type ProxyHopProtocol = "socks5" | "http";

export interface Socks5ProxyHop {
  protocol?: ProxyHopProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function localProxyChainGatewayUrls(): { httpProxyUrl: string; socksProxyUrl: string } {
  return {
    httpProxyUrl: `http://127.0.0.1:${LOCAL_PROXY_CHAIN_HTTP_PORT}`,
    socksProxyUrl: `socks5://127.0.0.1:${LOCAL_PROXY_CHAIN_SOCKS_PORT}`,
  };
}

export function isProxyChainActive(input: {
  proxyChain?: readonly string[];
  proxyChainEnabled?: boolean;
}): boolean {
  if (input.proxyChainEnabled === false) return false;
  if (input.proxyChainEnabled === true) return (input.proxyChain?.length ?? 0) > 0;
  return (input.proxyChain?.length ?? 0) > 0;
}

export type Socks5ProxyChainParseResult =
  | { ok: true; hops: Socks5ProxyHop[] }
  | { ok: false; reason: "too_many" | "invalid" };

export function canonicalizeProxyHop(value: string): string | undefined {
  const hop = parseSocks5ProxyHop(value);
  if (!hop) return undefined;
  const auth =
    hop.username || hop.password
      ? `${encodeURIComponent(hop.username ?? "")}:${encodeURIComponent(hop.password ?? "")}@`
      : "";
  const protocol = hop.protocol === "http" ? "http" : "socks5";
  return `${protocol}://${auth}${hop.host}:${hop.port}`;
}

export function parseSocks5ProxyHop(value: string): Socks5ProxyHop | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // 没写协议的本地代理几乎都是 HTTP（7890）。SOCKS 必须显式写 socks5://，
  // 否则网关会用 SOCKS 握手去敲 HTTP 端口，所有模型请求一起 502。
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  const protocol: ProxyHopProtocol | undefined =
    url.protocol === "socks5:" ? "socks5" : url.protocol === "http:" ? "http" : undefined;
  if (!protocol || !url.hostname || !url.port) return undefined;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  return {
    protocol,
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

/** 空列表是「未启用链」。非空项必须全部合法，且不超过 5 跳。 */
export function parseSocks5ProxyChain(
  values: readonly string[] | undefined,
): Socks5ProxyChainParseResult {
  const entries = (values ?? []).map((value) => value.trim()).filter(Boolean);
  if (entries.length === 0) return { ok: true, hops: [] };
  if (entries.length > MAX_SOCKS5_PROXY_CHAIN_HOPS) return { ok: false, reason: "too_many" };
  const hops: Socks5ProxyHop[] = [];
  for (const entry of entries) {
    const hop = parseSocks5ProxyHop(entry);
    if (!hop) return { ok: false, reason: "invalid" };
    hops.push(hop);
  }
  return { ok: true, hops };
}

export type ProxyChainEgressPlan =
  | { kind: "inactive" }
  | { kind: "invalid" }
  | { kind: "direct"; proxyUrl: string; protocol: ProxyHopProtocol }
  | { kind: "gateway" };

/**
 * 一跳直接使用该 URL。两跳及以上才需要本机网关。
 * 一跳 SOCKS5 再套 HTTP 网关时，模型出口会整批失败。
 */
export function planProxyChainEgress(input: {
  proxyChain?: readonly string[];
  proxyChainEnabled?: boolean;
}): ProxyChainEgressPlan {
  if (!isProxyChainActive(input)) return { kind: "inactive" };
  const parsed = parseSocks5ProxyChain(input.proxyChain);
  if (!parsed.ok) return { kind: "invalid" };
  const hop = parsed.hops[0];
  if (!hop || parsed.hops.length === 0) return { kind: "inactive" };
  if (parsed.hops.length === 1) {
    const proxyUrl = canonicalizeProxyHop(input.proxyChain?.[0] ?? "");
    if (!proxyUrl) return { kind: "invalid" };
    return { kind: "direct", proxyUrl, protocol: hop.protocol === "http" ? "http" : "socks5" };
  }
  return { kind: "gateway" };
}
