import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { appSettingsSchema, parseSocks5ProxyChain } from "@zcode/shared";
import { buildAgentRuntimeEnv } from "../src/runtime-tools/agentProxyEnv.js";
import { startSocks5ProxyChainGateway } from "@zcode/shared/proxy-chain";
import { resolveConfiguredEgressProxy } from "../src/network/proxy-chain/resolveEgressProxy.js";

test("parseSocks5ProxyChain 拒绝第 6 跳和坏地址", () => {
  const hops = Array.from({ length: 6 }, (_, index) => `socks5://10.0.0.${index + 1}:1080`);
  assert.equal(parseSocks5ProxyChain(hops).ok, false);
  assert.equal(parseSocks5ProxyChain(["http://127.0.0.1:7890"]).ok, true);
  const bareHttp = parseSocks5ProxyChain(["127.0.0.1:7890"]);
  assert.equal(bareHttp.ok, true);
  if (bareHttp.ok) assert.equal(bareHttp.hops[0]?.protocol, "http");
  assert.equal(parseSocks5ProxyChain(["not-a-proxy"]).ok, false);
  assert.equal(parseSocks5ProxyChain(["socks5://127.0.0.1"]).ok, false);
  const parsed = parseSocks5ProxyChain(["socks5://user:pass@127.0.0.1:1080"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.hops[0]?.username, "user");
    assert.equal(parsed.hops[0]?.port, 1080);
  }
  const settings = appSettingsSchema.safeParse({
    proxyChain: ["socks5://127.0.0.1:1", "socks5://127.0.0.1:2", "not-a-proxy"],
  });
  assert.equal(settings.success, false);
});

test("一跳 HTTP 或 SOCKS5 直接使用该地址，不改写到 47821", () => {
  const httpHop = resolveConfiguredEgressProxy({
    proxyChain: ["127.0.0.1:7890"],
    env: {},
  });
  assert.equal(httpHop.httpProxy, "http://127.0.0.1:7890");
  assert.equal(httpHop.chainActive, false);
  assert.equal(httpHop.gatewayMissing, false);

  const socksHop = resolveConfiguredEgressProxy({
    httpProxy: "http://127.0.0.1:7890",
    proxyChain: ["socks5://10.0.0.1:1080"],
    env: {},
  });
  assert.equal(socksHop.httpProxy, "socks5://10.0.0.1:1080");
  assert.equal(socksHop.allProxy, "socks5://10.0.0.1:1080");
  assert.equal(socksHop.gatewayMissing, false);
  const socksEnv = buildAgentRuntimeEnv({
    httpProxy: socksHop.httpProxy,
    allProxy: socksHop.allProxy,
  });
  assert.equal(socksEnv.HTTP_PROXY, "socks5://10.0.0.1:1080");
  assert.equal(socksEnv.ALL_PROXY, "socks5://10.0.0.1:1080");
});

test("多跳在网关地址缺失时 fail-closed，有地址时才指向本机入口", () => {
  const missing = resolveConfiguredEgressProxy({
    proxyChain: ["socks5://10.0.0.1:1080", "socks5://10.0.0.2:1080"],
    env: {},
  });
  assert.equal(missing.gatewayMissing, true);
  assert.equal(missing.httpProxy, undefined);
  const resolved = resolveConfiguredEgressProxy({
    proxyChain: ["socks5://10.0.0.1:1080", "socks5://10.0.0.2:1080"],
    env: {
      ZCODE_LOCAL_PROXY_GATEWAY_HTTP: "http://127.0.0.1:9",
      ZCODE_LOCAL_PROXY_GATEWAY_SOCKS: "socks5://127.0.0.1:10",
    },
  });
  assert.equal(resolved.httpProxy, "http://127.0.0.1:9");
  assert.equal(resolved.allProxy, "socks5://127.0.0.1:10");
  const env = buildAgentRuntimeEnv({
    httpProxy: resolved.httpProxy,
    allProxy: resolved.allProxy,
  });
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:9");
  assert.equal(env.ALL_PROXY, "socks5://127.0.0.1:10");
  const invalid = resolveConfiguredEgressProxy({
    httpProxy: "http://127.0.0.1:7890",
    proxyChain: ["not-a-proxy"],
    env: {},
  });
  assert.equal(invalid.gatewayMissing, true);
  assert.equal(invalid.httpProxy, undefined);
});

test("HTTP CONNECT 按 1→2→目标 穿过两条 SOCKS5", async () => {
  const seen: string[] = [];
  const echo = await listen((socket) => {
    socket.on("data", (chunk) => socket.write(chunk));
  });
  const hop2 = await listen((socket) => {
    void acceptSocks(socket, "hop2", seen);
  });
  const hop1 = await listen((socket) => {
    void acceptSocks(socket, "hop1", seen);
  });
  const gateway = await startSocks5ProxyChainGateway([
    { host: "127.0.0.1", port: hop1.port },
    { host: "127.0.0.1", port: hop2.port },
  ]);
  try {
    const gatewayUrl = new URL(gateway.httpProxyUrl);
    const payload = await httpConnect(
      Number(gatewayUrl.port),
      "127.0.0.1",
      echo.port,
      "ping",
    );
    assert.equal(payload, "ping");
    assert.deepEqual(seen, [`hop1->127.0.0.1:${hop2.port}`, `hop2->127.0.0.1:${echo.port}`]);
  } finally {
    await gateway.close();
    echo.server.close();
    hop1.server.close();
    hop2.server.close();
  }
});

test("明文 HTTP 绝对 URL 经代理链到达目标", async () => {
  const origin = await listen((socket) => {
    socket.once("data", () => {
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
    });
  });
  const hop = await listen((socket) => {
    void acceptSocks(socket, "hop", []);
  });
  const gateway = await startSocks5ProxyChainGateway([{ host: "127.0.0.1", port: hop.port }]);
  try {
    const proxyPort = Number(new URL(gateway.httpProxyUrl).port);
    const body = await httpGet(proxyPort, origin.port);
    assert.equal(body, "ok");
  } finally {
    await gateway.close();
    origin.server.close();
    hop.server.close();
  }
});

function httpGet(proxyPort: number, originPort: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: proxyPort });
    let buffer = "";
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write(
        `GET http://127.0.0.1:${originPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${originPort}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
    });
    socket.on("end", () => {
      const body = buffer.split("\r\n\r\n")[1] ?? "";
      resolve(body);
    });
  });
}

function listen(onConnection: (socket: net.Socket) => void): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(onConnection);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

async function acceptSocks(socket: net.Socket, name: string, seen: string[]): Promise<void> {
  const reader = createReader(socket);
  const greeting = await reader(2);
  await reader(greeting[1] ?? 0);
  socket.write(Buffer.from([0x05, 0x00]));
  const request = await reader(4);
  const target = await readTarget(reader, request[3] ?? 0);
  seen.push(`${name}->${target.host}:${target.port}`);
  const upstream = net.connect({ host: target.host, port: target.port });
  await new Promise<void>((resolve, reject) => {
    upstream.once("connect", () => resolve());
    upstream.once("error", reject);
  });
  socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
  upstream.pipe(socket);
  socket.pipe(upstream);
}

async function readTarget(
  read: (length: number) => Promise<Buffer>,
  atyp: number,
): Promise<{ host: string; port: number }> {
  if (atyp === 0x03) {
    const length = await read(1);
    const raw = await read((length[0] ?? 0) + 2);
    return {
      host: raw.subarray(0, raw.length - 2).toString("utf8"),
      port: raw.readUInt16BE(raw.length - 2),
    };
  }
  const raw = await read(6);
  return { host: [...raw.subarray(0, 4)].join("."), port: raw.readUInt16BE(4) };
}

function createReader(socket: net.Socket): (length: number) => Promise<Buffer> {
  const chunks: Buffer[] = [];
  const waiters: Array<{
    length: number;
    resolve: (buffer: Buffer) => void;
  }> = [];
  socket.on("data", (chunk) => {
    chunks.push(chunk);
    flush();
  });
  const flush = () => {
    while (waiters.length > 0) {
      const waiter = waiters[0];
      if (!waiter) return;
      const available = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (available < waiter.length) return;
      const buffer = Buffer.concat(chunks);
      chunks.length = 0;
      if (buffer.length > waiter.length) chunks.push(buffer.subarray(waiter.length));
      waiters.shift();
      waiter.resolve(buffer.subarray(0, waiter.length));
    }
  };
  return (length) =>
    new Promise((resolve) => {
      waiters.push({ length, resolve });
      flush();
    });
}

function httpConnect(proxyPort: number, host: string, port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: proxyPort });
    let buffer = Buffer.alloc(0);
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      if (!header.startsWith("HTTP/1.1 200")) {
        reject(new Error(header));
        return;
      }
      socket.removeAllListeners("data");
      const rest = buffer.subarray(headerEnd + 4);
      let body = rest.toString("utf8");
      socket.on("data", (next) => {
        body += next.toString("utf8");
        if (body.includes(payload)) {
          socket.end();
          resolve(body);
        }
      });
      socket.write(payload);
    });
  });
}

