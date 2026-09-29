import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import {
  buildLanRemoteDnsSdRegisterArgs,
  canUseSystemBonjour,
  registerLanRemoteBonjour,
} from "./bonjour.js";

const announcement = {
  instanceName: "studio",
  hostname: "studio",
  port: 47321,
  addresses: ["192.168.1.20"],
  deviceId: "device-1",
  fingerprint: "ab".repeat(32),
};

test("dns-sd register args keep service type, port, and TXT without password", () => {
  const args = buildLanRemoteDnsSdRegisterArgs(announcement);
  assert.deepEqual(args.slice(0, 5), ["-R", "studio", "_zcode._tcp", "local", "47321"]);
  assert.equal(args.includes("id=device-1"), true);
  assert.equal(args.includes("ver=1"), true);
  assert.equal(args.includes(`fp=${announcement.fingerprint}`), true);
  assert.equal(args.some((arg) => arg.toLowerCase().includes("password")), false);
});

test("system Bonjour is preferred only on darwin", () => {
  assert.equal(canUseSystemBonjour("darwin"), true);
  assert.equal(canUseSystemBonjour("linux"), false);
  assert.equal(canUseSystemBonjour("win32"), false);
});

test("registerLanRemoteBonjour spawns dns-sd and stops by killing the child", () => {
  const child = Object.assign(new EventEmitter(), {
    killed: false,
    kill(signal?: string) {
      this.killed = true;
      this.lastSignal = signal;
      return true;
    },
    lastSignal: undefined as string | undefined,
  });
  let spawned: { command: string; args: string[] } | undefined;
  const stop = registerLanRemoteBonjour(announcement, {
    spawnImpl: ((command: string, args: string[]) => {
      spawned = { command, args };
      return child as never;
    }) as typeof import("node:child_process").spawn,
  });
  assert.equal(spawned?.command, "dns-sd");
  assert.deepEqual(spawned?.args, buildLanRemoteDnsSdRegisterArgs(announcement));
  stop();
  assert.equal(child.killed, true);
  assert.equal(child.lastSignal, "SIGTERM");
});
