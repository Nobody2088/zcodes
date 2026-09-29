import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { probeProxyEndpoint } from "../src/network/proxyEndpointProbe.js";
import {
  createHostApiNetworkTransport,
  resolveHostProxyForUrl,
} from "../src/providers/api/nodeApiNetwork.js";
import { buildAgentRuntimeEnv } from "../src/runtime-tools/agentProxyEnv.js";
import { DEFAULT_LOCAL_PROXY_BYPASS } from "@zcode/shared";

async function listen(
  onConnection: (socket: net.Socket) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer(onConnection);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("HTTP 代理探活：收到 HTTP 状态行即成功", async () => {
  const server = await listen((socket) => {
    socket.once("data", () => {
      socket.write("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n");
    });
  });
  try {
    const result = await probeProxyEndpoint({
      proxyUrl: `http://127.0.0.1:${server.port}`,
      timeoutMs: 2000,
    });
    assert.equal(result.ok, true);
    assert.ok(result.latencyMs != null && result.latencyMs >= 0);
  } finally {
    await server.close();
  }
});

test("不可达代理 fail-closed", async () => {
  const result = await probeProxyEndpoint({
    proxyUrl: "http://127.0.0.1:1",
    timeoutMs: 500,
  });
  assert.equal(result.ok, false);
  assert.equal(result.latencyMs, null);
  assert.ok(result.error);
});

test("Host 出口：空 noProxy 时本地直连、外网走代理", () => {
  const options = { httpProxy: "http://127.0.0.1:7890", noProxy: undefined };
  const local = resolveHostProxyForUrl("http://127.0.0.1:3000/", options);
  assert.equal(local.kind, "direct");
  const remote = resolveHostProxyForUrl("https://api.openai.com/v1/models", options);
  assert.equal(remote.kind, "proxy");
  if (remote.kind === "proxy") {
    assert.equal(remote.proxyUrl, "http://127.0.0.1:7890/");
  }
  const cidr = resolveHostProxyForUrl("http://192.168.8.9/", {
    httpProxy: "http://127.0.0.1:7890",
    noProxy: "192.168.8.0/24",
  });
  assert.equal(cidr.kind, "direct");
});

test("Host 出口：代理不可达时 fail-closed，不回退直连成功响应", async () => {
  // 显式绕过列表不含 127.0.0.1，避免默认本地绕过把本测目标直连掉。
  let originHits = 0;
  const origin = http.createServer((_req, res) => {
    originHits += 1;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("direct-ok");
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", () => resolve()));
  const address = origin.address();
  assert.ok(address && typeof address === "object");
  const originUrl = `http://127.0.0.1:${address.port}/chat`;

  const transport = createHostApiNetworkTransport(async () => ({
    httpProxy: "http://127.0.0.1:1",
    noProxy: "example.invalid",
  }));

  try {
    const route = resolveHostProxyForUrl(originUrl, {
      httpProxy: "http://127.0.0.1:1",
      noProxy: "example.invalid",
    });
    assert.equal(route.kind, "proxy");

    await assert.rejects(
      () => transport.fetch(originUrl),
      (error: unknown) => error instanceof Error && error.message.length > 0,
    );
    assert.equal(originHits, 0, "死代理不得静默直连到目标服务");
  } finally {
    transport.dispose();
    await new Promise<void>((resolve, reject) =>
      origin.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("Host 出口在 invalidate 后重读代理，死代理不再直连", async () => {
  let originHits = 0;
  const origin = http.createServer((_req, res) => {
    originHits += 1;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("direct-ok");
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", () => resolve()));
  const address = origin.address();
  assert.ok(address && typeof address === "object");
  const originUrl = `http://127.0.0.1:${address.port}/chat`;
  let httpProxy: string | undefined;
  const transport = createHostApiNetworkTransport(async () => ({
    httpProxy,
    noProxy: "example.invalid",
  }));

  try {
    const first = await transport.fetch(originUrl);
    assert.equal(await first.text(), "direct-ok");
    httpProxy = "http://127.0.0.1:1";
    transport.invalidate();
    await assert.rejects(() => transport.fetch(originUrl));
    assert.equal(originHits, 1);
  } finally {
    transport.dispose();
    await new Promise<void>((resolve, reject) =>
      origin.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("Agent env 在有代理时注入默认 NO_PROXY", () => {
  const env = buildAgentRuntimeEnv({ httpProxy: "http://127.0.0.1:7890" });
  assert.equal(env.NO_PROXY, DEFAULT_LOCAL_PROXY_BYPASS);
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7890");
  const direct = buildAgentRuntimeEnv({ httpProxy: undefined });
  assert.equal(direct.NO_PROXY, undefined);
});
