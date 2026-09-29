import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { createServer as createNetServer, type Socket as NetSocket } from "node:net";
import { networkInterfaces } from "node:os";
import type { Duplex } from "node:stream";
import { createSecureContext, type SecureContext } from "node:tls";
import { WebSocketServer, type WebSocket } from "ws";
import {
  LAN_REMOTE_CLEANUP_PATH,
  LAN_REMOTE_INFO_PATH,
  LAN_REMOTE_PAIR_FAILURE_LIMIT,
  LAN_REMOTE_PAIR_LOCK_MS,
  LAN_REMOTE_PAIR_PATH,
  LAN_REMOTE_PROTOCOL_VERSION,
  LAN_REMOTE_RELAUNCH_PATH,
  LAN_REMOTE_WS_PATH,
  isPrivateLanIPv4,
  isLanPasswordlessPair,
  lanRemoteAuthMessageSchema,
  lanRemotePairRequestSchema,
} from "@zcode/shared";
import {
  findActiveDevice,
  issueLanDeviceToken,
  verifyLanPassword,
  type LanRemoteSecret,
  type LanRemoteTrustedDevice,
} from "./secret.js";
import { tryServeLanWebUi } from "./staticUi.js";

export interface LanRemoteClient {
  socket: WebSocket;
  device: LanRemoteTrustedDevice;
}

export interface LanRemoteServer {
  port: number;
  host: string;
  close(): Promise<void>;
}

interface PairFailure {
  count: number;
  lockedUntil: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
  });
  res.end(payload);
}

/** 远控端口绑全部 IPv4，路由器端口映射才能打到这个进程。 */
export const LAN_REMOTE_BIND_HOST = "0.0.0.0";

export interface LanRemotePublicTls {
  certPem: string;
  keyPem: string;
  domain: string;
}

function isTlsClientHello(chunk: Buffer): boolean {
  return chunk.length > 0 && chunk[0] === 0x16;
}

export function listPrivateLanIPv4(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && isPrivateLanIPv4(entry.address)) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

export async function startLanRemoteServer(options: {
  host: string;
  port?: number;
  /** http = 明文局域网；https = TLS（局域网自签或公网导入材料）。 */
  protocol?: "http" | "https";
  /**
   * HTTPS 时使用的材料。省略则用 secret 的局域网自签。
   * 公网监听传入导入的 fullchain/privkey，不得写回 secret。
   */
  tlsMaterial?: { certPem: string; keyPem: string };
  /** 手机 Web UI 静态根目录；缺省则只提供配对与 WS。 */
  webRoot?: string;
  getSecret: () => LanRemoteSecret;
  setSecret: (secret: LanRemoteSecret) => Promise<void>;
  onClient: (client: LanRemoteClient) => void;
  /** 已配对设备请求清理桌面数据。缺省时该路径返回 404。 */
  onCleanup?: (categories: string[]) => Promise<{ removed: number }>;
  /** 已配对设备请求重启桌面。缺省时该路径返回 404。 */
  onRelaunch?: () => void | Promise<void>;
  /**
   * 已导入的公网证书。开启后这张证书用于该端口上的全部 HTTPS，
   * 含内网 IP 连接。不写回 secret。
   */
  publicTls?: LanRemotePublicTls | null;
  /** 写入 /lan/v1/info 与发现通告的指纹。公网证书开启时必须是该证书指纹。 */
  advertisedFingerprint?: string;
  /**
   * 同一 TCP 端口同时接受明文 HTTP 与 HTTPS。
   * 映射端口（如 49608）因此既能打开 https://域名:port/，也能打开内网 http://。
   */
  coalesceHttpAndHttps?: boolean;
}): Promise<LanRemoteServer> {
  const failures = new Map<string, PairFailure>();
  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });
  const protocol = options.protocol ?? "https";
  const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 400, { error: "bad request" });
    });
  };

  let server: HttpServer | HttpsServer;
  let httpPeer: HttpServer | undefined;
  const lanMaterial = options.tlsMaterial ?? {
    certPem: options.getSecret().certPem,
    keyPem: options.getSecret().keyPem,
  };
  const lanSecureContext = createSecureContext({
    cert: lanMaterial.certPem,
    key: lanMaterial.keyPem,
  });
  const publicSecureContext = options.publicTls
    ? createSecureContext({
        cert: options.publicTls.certPem,
        key: options.publicTls.keyPem,
      })
    : undefined;

  function selectSecureContext(_servername: string | undefined): SecureContext {
    // 手机内网按 IP 连接，SNI 不是域名。公网证书开启时，所有 HTTPS 都出示这张证书，
    // 否则已配对的手机会因指纹不一致直接断开。
    if (publicSecureContext) return publicSecureContext;
    return lanSecureContext;
  }

  if (protocol === "http" && !options.coalesceHttpAndHttps) {
    server = createHttpServer(requestHandler);
  } else {
    server = createHttpsServer(
      {
        cert: options.publicTls?.certPem ?? lanMaterial.certPem,
        key: options.publicTls?.keyPem ?? lanMaterial.keyPem,
        SNICallback: (servername, callback) => {
          try {
            callback(null, selectSecureContext(servername));
          } catch (error) {
            callback(error instanceof Error ? error : new Error(String(error)));
          }
        },
      },
      requestHandler,
    );
    if (options.coalesceHttpAndHttps) {
      httpPeer = createHttpServer(requestHandler);
    }
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }
    const url = new URL(req.url ?? "/", "https://lan.local");
    const secret = options.getSecret();
    if (req.method === "GET" && url.pathname === LAN_REMOTE_INFO_PATH) {
      sendJson(res, 200, {
        protocolVersion: LAN_REMOTE_PROTOCOL_VERSION,
        deviceId: secret.deviceId,
        displayName: secret.displayName,
        fingerprint: options.advertisedFingerprint || secret.fingerprint,
        authRequired: true,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === LAN_REMOTE_PAIR_PATH) {
      await handlePair(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === LAN_REMOTE_CLEANUP_PATH) {
      await handleCleanup(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === LAN_REMOTE_RELAUNCH_PATH) {
      await handleRelaunch(req, res);
      return;
    }
    // 手机配对后加载同源 UI（/?lan=1），不能再依赖手机本机 Vite。
    if (tryServeLanWebUi(req, res, options.webRoot)) {
      return;
    }
    sendJson(res, 404, { error: "not found" });
  }

  function authorizedDevice(req: IncomingMessage) {
    const header = req.headers.authorization;
    const token =
      typeof header === "string" ? /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] : undefined;
    if (!token) return undefined;
    return findActiveDevice(options.getSecret(), token);
  }

  async function handleCleanup(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!options.onCleanup) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (!authorizedDevice(req)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const categories = JSON.parse(await readBody(req)) as string[];
    const result = await options.onCleanup(Array.isArray(categories) ? categories : []);
    sendJson(res, 200, result);
  }

  async function handleRelaunch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!options.onRelaunch) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (!authorizedDevice(req)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    sendJson(res, 200, {});
    await options.onRelaunch();
  }

  async function handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remoteAddress = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const failure = failures.get(remoteAddress);
    if (failure && failure.lockedUntil > now) {
      sendJson(res, 429, { error: "locked" });
      return;
    }
    const parsed = lanRemotePairRequestSchema.safeParse(JSON.parse(await readBody(req)));
    if (!parsed.success) {
      sendJson(res, 400, { error: "bad request" });
      return;
    }
    const secret = options.getSecret();
    const lanTrust = isLanPasswordlessPair(remoteAddress) && parsed.data.password.length === 0;
    if (!lanTrust && !(await verifyLanPassword(secret, parsed.data.password))) {
      const count =
        failure && failure.lockedUntil > 0 && failure.lockedUntil <= now
          ? 1
          : (failure?.count ?? 0) + 1;
      failures.set(remoteAddress, {
        count,
        lockedUntil: count >= LAN_REMOTE_PAIR_FAILURE_LIMIT ? now + LAN_REMOTE_PAIR_LOCK_MS : 0,
      });
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    failures.delete(remoteAddress);
    const issued = issueLanDeviceToken(secret, parsed.data.clientId, parsed.data.clientName);
    await options.setSecret(issued.secret);
    sendJson(res, 200, { token: issued.token });
  }

  const upgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "https://lan.local");
    if (url.pathname !== LAN_REMOTE_WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket as Duplex, head, (ws) => {
      sockets.add(ws);
      let authenticated = false;
      const timer = setTimeout(() => {
        if (!authenticated) ws.close(4001, "auth timeout");
      }, 5_000);
      timer.unref?.();
      ws.once("message", (payload, isBinary) => {
        clearTimeout(timer);
        if (isBinary || authenticated) {
          ws.close(4001, "auth required");
          return;
        }
        const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload);
        let parsed: ReturnType<typeof lanRemoteAuthMessageSchema.safeParse>;
        try {
          parsed = lanRemoteAuthMessageSchema.safeParse(JSON.parse(text));
        } catch {
          ws.close(4001, "auth required");
          return;
        }
        const device = parsed.success
          ? findActiveDevice(options.getSecret(), parsed.data.token)
          : undefined;
        if (!device) {
          ws.close(4001, "unauthorized");
          return;
        }
        authenticated = true;
        ws.send(JSON.stringify({ type: "auth", ok: true }));
        options.onClient({ socket: ws, device });
      });
      ws.on("close", () => sockets.delete(ws));
      ws.on("error", () => ws.close());
    });
  };
  server.on("upgrade", upgradeHandler);
  httpPeer?.on("upgrade", upgradeHandler);

  const bindHost = options.host;
  let netServer: ReturnType<typeof createNetServer> | undefined;
  if (options.coalesceHttpAndHttps && httpPeer) {
    const httpsServer = server;
    netServer = createNetServer((socket: NetSocket) => {
      socket.once("data", (chunk: Buffer) => {
        socket.pause();
        // 把已经读走的首包还回去，再交给真正的 HTTP/HTTPS server。
        // 不能先 new TLSSocket：HTTPS server 会再握手一次，连接停在 accept 之后。
        // resume 必须放到下一拍，否则 TLS server 还没挂上 reader，首包就丢了。
        socket.unshift(chunk);
        const target = isTlsClientHello(chunk) ? httpsServer : httpPeer;
        target.emit("connection", socket);
        setImmediate(() => {
          socket.resume();
        });
      });
      socket.on("error", () => {
        socket.destroy();
      });
    });
  }

  await new Promise<void>((resolve, reject) => {
    const listening = netServer ?? server;
    listening.once("error", reject);
    listening.listen(options.port ?? 0, bindHost, () => resolve());
  });
  const address = (netServer ?? server).address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 0);
  return {
    port,
    host: bindHost,
    close: async () => {
      for (const socket of sockets) socket.close(1001, "stopped");
      const closeQuiet = (target: { close: (callback?: (error?: Error) => void) => void }) =>
        new Promise<void>((resolve) => {
          target.close(() => resolve());
        });
      await closeQuiet(wss);
      await closeQuiet(server);
      if (httpPeer) await closeQuiet(httpPeer);
      if (netServer) await closeQuiet(netServer);
    },
  };
}
