import { Socket } from "node:net";
import { canonicalizeProxyHop, parseSocks5ProxyHop, type ProxyEndpointTestResult } from "@zcode/shared";

const DEFAULT_TIMEOUT_MS = 5_000;

export interface ProbeProxyEndpointOptions {
  readonly proxyUrl: string;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly connect?: (params: {
    host: string;
    port: number;
    timeoutMs: number;
  }) => Promise<Socket>;
}

/**
 * 探测单条代理自身是否可达。fail-closed：连不上或协议不符都算失败。
 * 不经系统代理二次转发，直连该代理地址。
 */
export async function probeProxyEndpoint(
  options: ProbeProxyEndpointOptions,
): Promise<ProxyEndpointTestResult> {
  const startedAt = (options.now ?? Date.now)();
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const hop =
    parseSocks5ProxyHop(options.proxyUrl) ??
    (() => {
      const canonical = canonicalizeProxyHop(options.proxyUrl);
      return canonical ? parseSocks5ProxyHop(canonical) : undefined;
    })();

  if (!hop) {
    return { ok: false, latencyMs: null, error: "invalid_proxy_url" };
  }

  const connect = options.connect ?? connectTcp;
  let socket: Socket | undefined;
  try {
    socket = await connect({ host: hop.host, port: hop.port, timeoutMs });
    if (hop.protocol === "socks5") {
      await probeSocks5Greeting(socket, timeoutMs);
    } else {
      await probeHttpProxy(socket, hop.host, timeoutMs);
    }
    return { ok: true, latencyMs: Math.max(0, (options.now ?? Date.now)() - startedAt) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    socket?.destroy();
  }
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(15_000, Math.max(200, Math.floor(timeoutMs)));
}

function connectTcp(params: {
  host: string;
  port: number;
  timeoutMs: number;
}): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      handler();
    };
    socket.setTimeout(params.timeoutMs);
    socket.once("connect", () => finish(() => resolve(socket)));
    socket.once("timeout", () =>
      finish(() => {
        socket.destroy();
        reject(new Error(`timeout(${params.timeoutMs}ms)`));
      }),
    );
    socket.once("error", (error) =>
      finish(() => {
        socket.destroy();
        reject(error);
      }),
    );
    socket.connect(params.port, params.host);
  });
}

function probeSocks5Greeting(socket: Socket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout(${timeoutMs}ms)`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      clearTimeout(timer);
      socket.off("error", onError);
      // VER=5, METHOD=0x00 (no auth) 或 0x02 (user/pass) 均表示 SOCKS5 服务响应。
      if (chunk.length >= 2 && chunk[0] === 0x05 && (chunk[1] === 0x00 || chunk[1] === 0x02)) {
        resolve();
        return;
      }
      if (chunk.length >= 2 && chunk[0] === 0x05 && chunk[1] === 0xff) {
        reject(new Error("socks5_no_acceptable_auth"));
        return;
      }
      reject(new Error("socks5_bad_greeting"));
    };
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    socket.once("data", onData);
    socket.once("error", onError);
    // 无认证问候；若服务要求账密仍会回 0x02，视为可达。
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
  });
}

function probeHttpProxy(socket: Socket, proxyHost: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout(${timeoutMs}ms)`)), timeoutMs);
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      if (!buffer.includes("\r\n")) return;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      // 任意 HTTP 状态行都证明对端是 HTTP 代理/服务；连 407 也算链路通。
      if (/^HTTP\/\d\.\d\s+\d{3}/i.test(buffer)) {
        resolve();
        return;
      }
      reject(new Error("http_proxy_bad_response"));
    };
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    // 对代理自身发 OPTIONS，避免依赖外网目标；部分代理会 405/400，仍算可达。
    socket.write(
      `OPTIONS http://example.invalid/ HTTP/1.1\r\nHost: ${proxyHost}\r\nConnection: close\r\n\r\n`,
    );
  });
}
