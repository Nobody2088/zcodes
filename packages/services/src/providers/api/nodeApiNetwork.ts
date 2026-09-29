import http from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import tls, { rootCertificates } from "node:tls";
import { matchesProxyBypass, parseSocks5ProxyHop } from "@zcode/shared";
import { dialThroughSocks5Chain } from "@zcode/shared/proxy-chain";
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

export interface HostApiNetworkOptions {
  httpProxy?: string;
  noProxy?: string;
  caCertPath?: string;
  /** 设置里已有 SOCKS5 链，但本机网关还没起来。请求失败，不回退直连。 */
  proxyChainGatewayMissing?: boolean;
}

export interface HostApiNetworkTransport {
  fetch: typeof fetch;
  /** 代理设置变更后丢掉已缓存的出口，下一次请求重读设置。 */
  invalidate(): void;
  dispose(): void;
  disposeAndWait(): Promise<void>;
}

type HostProxyRoute =
  | { kind: "direct"; noProxyMatched?: boolean }
  | { kind: "proxy"; proxyUrl: string }
  | { kind: "invalid"; reason: string };

function mergeHostApiCaCertificates(
  customCa: string,
  defaultCa: readonly string[] = rootCertificates,
): string[] {
  // Node 的 tls.ca 会替换而不是追加默认根证书。只传企业代理 CA 会让未被
  // 中间人重签的公网证书失去信任链，因此必须同时保留 Node 默认根证书。
  return [...defaultCa, customCa];
}

function normalizeProxyUrl(value: string): string | undefined {
  const candidate = /^\w[\w+.-]*:\/\//.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname || !["http:", "https:", "socks5:"].includes(url.protocol)) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function resolveHostProxyForUrl(
  requestUrl: string | URL,
  options: HostApiNetworkOptions,
): HostProxyRoute {
  let url: URL;
  try {
    url = typeof requestUrl === "string" ? new URL(requestUrl) : requestUrl;
  } catch {
    return { kind: "direct" };
  }
  if (options.proxyChainGatewayMissing) {
    return { kind: "invalid", reason: "SOCKS5 proxy chain gateway is not running" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "direct" };
  }
  // 空列表走默认本地绕过；显式列表原样匹配（含 CIDR）。
  if (matchesProxyBypass(url, options.noProxy)) {
    return { kind: "direct", noProxyMatched: true };
  }
  const configuredProxy = options.httpProxy?.trim();
  if (!configuredProxy) {
    return { kind: "direct" };
  }
  const proxyUrl = normalizeProxyUrl(configuredProxy);
  return proxyUrl
    ? { kind: "proxy", proxyUrl }
    : { kind: "invalid", reason: "Configured Host proxy URL is invalid" };
}

interface HostApiNetworkTransportDependencies {
  createDispatcher?: typeof createDispatcher;
  fetchWithDispatcher?: (
    input: string,
    init: Omit<RequestInit, "dispatcher"> & { dispatcher: Dispatcher },
  ) => Promise<Response>;
}

export function createHostApiNetworkTransport(
  resolveOptions: () => Promise<HostApiNetworkOptions>,
  dependencies: HostApiNetworkTransportDependencies = {},
): HostApiNetworkTransport {
  // Host 是独立 Node 进程，Electron Session.setProxy 不会影响它的 globalThis.fetch；
  // 在 NodeApiClient 出口按请求注入 dispatcher，避免把 telemetry 等其它裸 fetch 全局改道。
  let optionsPromise: Promise<HostApiNetworkOptions> | undefined;
  const dispatcherPromises = new Map<string, Promise<Dispatcher>>();
  let disposed = false;
  let generation = 0;
  let pendingDispatcherCreations = 0;
  let resolveDispatcherCreations: (() => void) | undefined;
  let dispatcherCreationsDone: Promise<void> | undefined;
  const lateDisposePromises: Promise<void>[] = [];
  let disposePromise: Promise<void> | undefined;
  let disposeMode: "close" | "destroy" | undefined;
  const dispatcherFactory = dependencies.createDispatcher ?? createDispatcher;
  const fetchWithDispatcher =
    dependencies.fetchWithDispatcher ??
    ((input, init) => undiciFetch(input, init as never) as unknown as Promise<Response>);

  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (disposed) {
      throw new Error("Host API network transport has been disposed");
    }
    const requestGeneration = generation;
    if (!optionsPromise) {
      // 设置读取失败只影响当前请求；清掉 rejected promise，避免一次瞬时 IPC/启动竞态
      // 把 Host API 永久锁死，同时仍保持失败请求不回退到直连。
      optionsPromise = resolveOptions().catch((error: unknown) => {
        optionsPromise = undefined;
        throw error;
      });
    }
    const options = await optionsPromise;
    if (disposed || generation !== requestGeneration) {
      throw new Error("Host API network transport has been disposed");
    }
    const requestUrl = input instanceof Request ? input.url : String(input);
    const route = resolveHostProxyForUrl(requestUrl, options);
    if (route.kind === "invalid") {
      throw new Error(route.reason);
    }
    if (route.kind === "direct" && !options.caCertPath) {
      return globalThis.fetch(input as Parameters<typeof fetch>[0], init);
    }
    if (route.kind === "proxy" && route.proxyUrl.startsWith("socks5:")) {
      return fetchThroughSocks(input, init, route.proxyUrl, options.caCertPath);
    }

    const dispatcherKey = `${route.kind}:${route.kind === "proxy" ? route.proxyUrl : "direct"}:${options.caCertPath ?? ""}`;
    let dispatcherPromise = dispatcherPromises.get(dispatcherKey);
    if (!dispatcherPromise) {
      if (disposed) {
        throw new Error("Host API network transport has been disposed");
      }
      const dispatcherGeneration = generation;
      pendingDispatcherCreations += 1;
      dispatcherPromise = dispatcherFactory(route, options.caCertPath);
      dispatcherPromises.set(dispatcherKey, dispatcherPromise);
      void dispatcherPromise
        .then((dispatcher) => {
          if (
            (disposed || generation !== dispatcherGeneration) &&
            dispatcherPromises.get(dispatcherKey) === dispatcherPromise
          ) {
            dispatcherPromises.delete(dispatcherKey);
            const cleanupPromise = Promise.resolve(
              disposeMode === "close" ? dispatcher.close() : dispatcher.destroy(),
            ).catch(() => {});
            lateDisposePromises.push(cleanupPromise);
          }
        })
        .catch(() => {});
      const markDispatcherCreationDone = () => {
        pendingDispatcherCreations -= 1;
        if (pendingDispatcherCreations === 0) {
          resolveDispatcherCreations?.();
          resolveDispatcherCreations = undefined;
        }
      };
      void dispatcherPromise.then(markDispatcherCreationDone, markDispatcherCreationDone);
      dispatcherPromise.catch(() => {
        // 设置/CA 等临时 IO 失败只影响当前请求；清理 rejected dispatcher，避免一次启动竞态
        // 把同一路由永久锁死，同时仍保持失败请求 fail-closed、不回退到直连。
        if (dispatcherPromises.get(dispatcherKey) === dispatcherPromise) {
          dispatcherPromises.delete(dispatcherKey);
        }
      });
    }
    const dispatcher = await dispatcherPromise;
    if (disposed || generation !== requestGeneration) {
      throw new Error("Host API network transport has been disposed");
    }
    return fetchWithDispatcher(
      input as unknown as string,
      {
        ...init,
        dispatcher,
      } as Omit<RequestInit, "dispatcher"> & { dispatcher: Dispatcher },
    );
  };

  const startDispose = (mode: "close" | "destroy"): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposed = true;
    generation += 1;
    disposeMode = mode;
    // dispatcher 不能只被闭包缓存、没有 Host owner：窗口/远端 Host 重建后连接池和
    // keep-alive socket 仍可能存活。释放时对当前单飞 Promise 做快照，确保初始化中的 dispatcher
    // 也会在完成后被收口；同步退出 destroy，等待式退出 close。
    const pendingDispatchers = [...dispatcherPromises.values()];
    dispatcherPromises.clear();
    if (pendingDispatcherCreations > 0) {
      dispatcherCreationsDone = new Promise<void>((resolve) => {
        resolveDispatcherCreations = resolve;
      });
    }
    disposePromise = (async () => {
      await Promise.allSettled(
        pendingDispatchers.map(async (dispatcherPromise) => {
          const dispatcher = await dispatcherPromise;
          if (mode === "close") {
            await dispatcher.close();
          } else {
            await dispatcher.destroy();
          }
        }),
      );
      await dispatcherCreationsDone;
      await Promise.all(lateDisposePromises);
    })();
    return disposePromise;
  };

  return {
    fetch,
    invalidate() {
      // 不能沿用 dispose 的 generation：进行中的请求不该被说成 transport 已销毁。
      // 只丢掉缓存，下一次 fetch 重新 resolveOptions。
      optionsPromise = undefined;
      const pending = [...dispatcherPromises.values()];
      dispatcherPromises.clear();
      for (const dispatcherPromise of pending) {
        void dispatcherPromise.then((dispatcher) => dispatcher.close()).catch(() => undefined);
      }
    },
    dispose() {
      void startDispose("destroy");
    },
    disposeAndWait() {
      return startDispose("close");
    },
  };
}

async function fetchThroughSocks(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  proxyUrl: string,
  caCertPath: string | undefined,
): Promise<Response> {
  const hop = parseSocks5ProxyHop(proxyUrl);
  if (!hop) {
    throw new Error("Configured Host proxy URL is invalid");
  }
  const request = new Request(input, init);
  const url = new URL(request.url);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const upstream = await dialThroughSocks5Chain([hop], { host: url.hostname, port });
  const socket =
    url.protocol === "https:"
      ? await connectTls(upstream, url.hostname, caCertPath)
      : upstream;
  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());
  const headers: http.OutgoingHttpHeaders = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const agent = new http.Agent();
  agent.createConnection = () => socket;
  return new Promise((resolve, reject) => {
    const clientRequest = http.request(
      {
        agent,
        headers,
        hostname: url.hostname,
        method,
        path: `${url.pathname}${url.search}`,
      },
      (message) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(message.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.append(name, String(value));
          }
        }
        resolve(
          new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, {
            headers: responseHeaders,
            status: message.statusCode ?? 502,
            statusText: message.statusMessage,
          }),
        );
      },
    );
    clientRequest.once("error", reject);
    clientRequest.end(body);
  });
}

function connectTls(
  upstream: import("node:net").Socket,
  servername: string,
  caCertPath: string | undefined,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const ca = caCertPath
        ? mergeHostApiCaCertificates(await readFile(caCertPath, "utf8"))
        : undefined;
      const tlsSocket = tls.connect({ socket: upstream, servername, ca });
      tlsSocket.once("secureConnect", () => resolve(tlsSocket));
      tlsSocket.once("error", reject);
    })().catch(reject);
  });
}

async function createDispatcher(
  route: Exclude<HostProxyRoute, { kind: "invalid" }>,
  caCertPath: string | undefined,
): Promise<Dispatcher> {
  const customCa = caCertPath ? await readFile(caCertPath, "utf8") : undefined;
  const ca = customCa ? mergeHostApiCaCertificates(customCa) : undefined;
  if (route.kind === "proxy") {
    return new ProxyAgent({
      uri: route.proxyUrl,
      proxyTls: ca ? { ca } : undefined,
      requestTls: ca ? { ca } : undefined,
    });
  }
  return new Agent({ connect: ca ? { ca } : undefined });
}
