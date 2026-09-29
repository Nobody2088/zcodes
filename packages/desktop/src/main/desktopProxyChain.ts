import {
  LOCAL_PROXY_CHAIN_HTTP_PORT,
  LOCAL_PROXY_CHAIN_SOCKS_PORT,
  ZCODE_LOCAL_PROXY_GATEWAY_HTTP_ENV_KEY,
  ZCODE_LOCAL_PROXY_GATEWAY_SOCKS_ENV_KEY,
  parseSocks5ProxyChain,
  planProxyChainEgress,
} from "@zcode/shared";
import type { Session } from "electron";
import { startSocks5ProxyChainGateway, type Socks5ProxyChainGateway } from "@zcode/services/node";
import { applyDesktopChromiumNetworkPolicies } from "./desktopNetworkPolicy.js";

interface ProxyChainLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

interface ProxyChainSettings {
  httpProxy?: string;
  httpProxyNoProxy?: string;
  httpProxyCaCertPath?: string;
  embeddedBrowserAllowInsecureCertificates?: boolean;
  proxyChain?: string[];
  proxyChainEnabled?: boolean;
}

let gateway: Socks5ProxyChainGateway | undefined;
let applyQueue: Promise<void> = Promise.resolve();

export function applyDesktopProxyChainNow(
  sessionProvider: { readonly defaultSession: Session; fromPartition(partition: string): Session },
  settings: ProxyChainSettings,
  logger: ProxyChainLogger,
): Promise<void> {
  const run = applyQueue.then(() => applyDesktopProxyChain(sessionProvider, settings, logger));
  applyQueue = run.catch(() => undefined);
  return run;
}

async function applyDesktopProxyChain(
  sessionProvider: { readonly defaultSession: Session; fromPartition(partition: string): Session },
  settings: ProxyChainSettings,
  logger: ProxyChainLogger,
): Promise<void> {
  if (gateway) {
    await gateway.close();
    gateway = undefined;
  }
  delete process.env[ZCODE_LOCAL_PROXY_GATEWAY_HTTP_ENV_KEY];
  delete process.env[ZCODE_LOCAL_PROXY_GATEWAY_SOCKS_ENV_KEY];

  let chromiumProxyUrl: string | undefined;
  const plan = planProxyChainEgress(settings);
  if (plan.kind === "invalid") {
    logger.warn("[desktop-network] proxy chain is invalid");
  } else if (plan.kind === "direct") {
    chromiumProxyUrl = plan.proxyUrl;
    logger.info("[desktop-network] single proxy hop used directly");
  } else if (plan.kind === "gateway") {
    const parsed = parseSocks5ProxyChain(settings.proxyChain);
    if (parsed.ok && parsed.hops.length > 1) {
      gateway = await startSocks5ProxyChainGateway(parsed.hops, {
        httpPort: LOCAL_PROXY_CHAIN_HTTP_PORT,
        socksPort: LOCAL_PROXY_CHAIN_SOCKS_PORT,
      });
      process.env[ZCODE_LOCAL_PROXY_GATEWAY_HTTP_ENV_KEY] = gateway.httpProxyUrl;
      process.env[ZCODE_LOCAL_PROXY_GATEWAY_SOCKS_ENV_KEY] = gateway.socksProxyUrl;
      chromiumProxyUrl = gateway.socksProxyUrl;
      logger.info("[desktop-network] proxy chain gateway listening");
    }
  }

  await applyDesktopChromiumNetworkPolicies(sessionProvider, settings, logger, chromiumProxyUrl);
}
