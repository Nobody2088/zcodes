import assert from "node:assert/strict";
import test from "node:test";
import { preferDefaultLanRemoteEnabled, type LanRemoteSecret } from "./secret.js";

function secret(patch: Partial<LanRemoteSecret>): LanRemoteSecret {
  return {
    deviceId: "device",
    displayName: "Desk",
    enabled: false,
    port: 0,
    httpPort: 0,
    publicHttpsEnabled: false,
    publicHttpsPort: 0,
    password: "secret",
    passwordSaltB64: "salt",
    passwordHashB64: "hash",
    certPem: "cert",
    keyPem: "key",
    fingerprint: "fp",
    devices: [],
    ...patch,
  };
}

test("unset lan switch defaults to enabled", () => {
  assert.equal(preferDefaultLanRemoteEnabled(secret({ enabled: false })).enabled, true);
});

test("a chosen off switch stays off", () => {
  const next = preferDefaultLanRemoteEnabled(secret({ enabled: false, enabledChosen: true }));
  assert.equal(next.enabled, false);
});

test("an already enabled switch stays enabled", () => {
  assert.equal(preferDefaultLanRemoteEnabled(secret({ enabled: true })).enabled, true);
});
