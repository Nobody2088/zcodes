import {
  planProxyChainEgress,
  ZCODE_LOCAL_PROXY_GATEWAY_HTTP_ENV_KEY,
  ZCODE_LOCAL_PROXY_GATEWAY_SOCKS_ENV_KEY,
} from "@zcode/shared";

export interface ConfiguredEgressProxy {
  httpProxy?: string;
  allProxy?: string;
  chainActive: boolean;
  gatewayMissing: boolean;
}

export function resolveConfiguredEgressProxy(input: {
  httpProxy?: string;
  proxyChain?: readonly string[];
  proxyChainEnabled?: boolean;
  env?: Record<string, string | undefined>;
}): ConfiguredEgressProxy {
  const plan = planProxyChainEgress(input);
  if (plan.kind === "inactive") {
    return {
      httpProxy: input.httpProxy?.trim() || undefined,
      chainActive: false,
      gatewayMissing: false,
    };
  }
  if (plan.kind === "invalid") {
    // 手改 setting.json 写出的坏跳板不能当成「没配链」而直连。
    return { chainActive: true, gatewayMissing: true };
  }
  if (plan.kind === "direct") {
    // 一跳就是用户的代理。SOCKS5 不再改写成 127.0.0.1:47821。
    return {
      httpProxy: plan.proxyUrl,
      ...(plan.protocol === "socks5" ? { allProxy: plan.proxyUrl } : {}),
      chainActive: false,
      gatewayMissing: false,
    };
  }
  const env = input.env ?? process.env;
  const httpProxy = env[ZCODE_LOCAL_PROXY_GATEWAY_HTTP_ENV_KEY]?.trim();
  const allProxy = env[ZCODE_LOCAL_PROXY_GATEWAY_SOCKS_ENV_KEY]?.trim();
  if (httpProxy && allProxy) {
    return { httpProxy, allProxy, chainActive: true, gatewayMissing: false };
  }
  // 网关还没把地址写进环境变量时，不能假装 47821 上有人在听。
  return { chainActive: true, gatewayMissing: true };
}
