import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import test from "node:test";
import { WebSocket } from "ws";
import {
  LAN_REMOTE_CLEANUP_PATH,
  LAN_REMOTE_INFO_PATH,
  LAN_REMOTE_PAIR_PATH,
  LAN_REMOTE_WS_PATH,
} from "@zcode/shared";
import { startLanRemoteServer } from "./server.js";
import { createLanRemoteSecret, verifyLanPassword, type LanRemoteSecret } from "./secret.js";

function requestJson(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        rejectUnauthorized: false,
        headers: {
          ...(headers ?? {}),
          ...(payload
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            json: text ? (JSON.parse(text) as unknown) : {},
          });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function requestText(
  port: number,
  path: string,
): Promise<{ status: number; contentType: string; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port,
        method: "GET",
        path,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers["content-type"] ?? ""),
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("pairing rejects the wrong password and accepts the desktop password", async () => {
  let secret = await createLanRemoteSecret("Desk");
  assert.equal(await verifyLanPassword(secret, secret.password), true);
  const server = await startLanRemoteServer({
    host: "127.0.0.1",
    port: 0,
    getSecret: () => secret,
    setSecret: async (next) => {
      secret = next;
    },
    onClient: () => undefined,
  });
  try {
    const info = await requestJson(server.port, "GET", LAN_REMOTE_INFO_PATH);
    assert.equal(info.status, 200);
    assert.equal((info.json as { fingerprint: string }).fingerprint, secret.fingerprint);
    assert.equal(JSON.stringify(info.json).includes(secret.password), false);

    const rejected = await requestJson(server.port, "POST", LAN_REMOTE_PAIR_PATH, {
      password: "nope",
      clientId: "phone-1",
      clientName: "Phone",
    });
    assert.equal(rejected.status, 401);

    const paired = await requestJson(server.port, "POST", LAN_REMOTE_PAIR_PATH, {
      password: secret.password,
      clientId: "phone-1",
      clientName: "Phone",
    });
    assert.equal(paired.status, 200);
    const token = (paired.json as { token: string }).token;
    assert.equal(typeof token, "string");

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`wss://127.0.0.1:${server.port}${LAN_REMOTE_WS_PATH}`, {
        rejectUnauthorized: false,
      });
      ws.once("open", () => {
        ws.send(JSON.stringify({ type: "auth", token }));
      });
      ws.once("message", (data, isBinary) => {
        if (isBinary) {
          reject(new Error("expected auth text"));
          return;
        }
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        assert.equal(JSON.parse(text).ok, true);
        ws.close();
        resolve();
      });
      ws.once("error", reject);
    });
  } finally {
    await server.close();
  }
});

test("five bad passwords lock the source address", async () => {
  let secret: LanRemoteSecret = await createLanRemoteSecret("Desk");
  const server = await startLanRemoteServer({
    host: "127.0.0.1",
    getSecret: () => secret,
    setSecret: async (next) => {
      secret = next;
    },
    onClient: () => undefined,
  });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await requestJson(server.port, "POST", LAN_REMOTE_PAIR_PATH, {
        password: "nope",
        clientId: "phone-1",
        clientName: "Phone",
      });
      assert.equal(response.status, 401);
    }
    const locked = await requestJson(server.port, "POST", LAN_REMOTE_PAIR_PATH, {
      password: secret.password,
      clientId: "phone-1",
      clientName: "Phone",
    });
    assert.equal(locked.status, 429);
  } finally {
    await server.close();
  }
});

test("serves lan-web index for phone UI at /", async () => {
  const webRoot = mkdtempSync(join(tmpdir(), "zcode-lan-web-"));
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>zcode-lan</title>");
  writeFileSync(join(webRoot, "app.js"), "window.__zcode=1");
  let secret = await createLanRemoteSecret("Desk");
  const server = await startLanRemoteServer({
    host: "127.0.0.1",
    webRoot,
    getSecret: () => secret,
    setSecret: async (next) => {
      secret = next;
    },
    onClient: () => undefined,
  });
  try {
    const index = await requestText(server.port, "/?lan=1");
    assert.equal(index.status, 200);
    assert.match(index.contentType, /text\/html/);
    assert.match(index.text, /zcode-lan/);

    const asset = await requestText(server.port, "/app.js");
    assert.equal(asset.status, 200);
    assert.match(asset.contentType, /javascript/);
    assert.match(asset.text, /__zcode/);

    // 配对 API 仍优先于静态回退
    const info = await requestJson(server.port, "GET", LAN_REMOTE_INFO_PATH);
    assert.equal(info.status, 200);
  } finally {
    await server.close();
  }
});

test("paired phone can ask the desktop to clean, unpaired requests are rejected", async () => {
  let secret = await createLanRemoteSecret("Desk");
  const cleaned: string[][] = [];
  const server = await startLanRemoteServer({
    host: "127.0.0.1",
    port: 0,
    getSecret: () => secret,
    setSecret: async (next) => {
      secret = next;
    },
    onClient: () => undefined,
    onCleanup: async (categories) => {
      cleaned.push(categories);
      return { removed: categories.length };
    },
  });
  try {
    const rejected = await requestJson(server.port, "POST", LAN_REMOTE_CLEANUP_PATH, ["caches"]);
    assert.equal(rejected.status, 401);
    assert.deepEqual(cleaned, []);

    const paired = await requestJson(server.port, "POST", LAN_REMOTE_PAIR_PATH, {
      password: secret.password,
      clientId: "phone-cleanup",
      clientName: "Phone",
    });
    const token = (paired.json as { token: string }).token;
    const accepted = await requestJson(
      server.port,
      "POST",
      LAN_REMOTE_CLEANUP_PATH,
      ["conversations", "caches"],
      { authorization: `Bearer ${token}` },
    );
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.json, { removed: 2 });
    assert.deepEqual(cleaned, [["conversations", "caches"]]);
  } finally {
    await server.close();
  }
});
