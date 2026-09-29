import assert from "node:assert/strict";
import test from "node:test";
import {
  httpsCertDaysRemaining,
  isHostFolderName,
  isPrivateLanIPv4,
  isLanPasswordlessPair,
  lanRemoteInfoSchema,
  shouldWarnHttpsCertExpiry,
} from "../src/lanRemoteControl.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

test("intranet pair may omit the password, loopback and public still require it", () => {
  assert.equal(isLanPasswordlessPair("192.168.8.20"), true);
  assert.equal(isLanPasswordlessPair("::ffff:10.0.0.8"), true);
  assert.equal(isLanPasswordlessPair("127.0.0.1"), false);
  assert.equal(isLanPasswordlessPair("119.131.66.140"), false);
});

test("private lan addresses are limited to rfc1918 ranges", () => {
  assert.equal(isPrivateLanIPv4("10.1.2.3"), true);
  assert.equal(isPrivateLanIPv4("192.168.0.8"), true);
  assert.equal(isPrivateLanIPv4("172.16.0.1"), true);
  assert.equal(isPrivateLanIPv4("172.32.0.1"), false);
  assert.equal(isPrivateLanIPv4("8.8.8.8"), false);
  assert.equal(isPrivateLanIPv4("127.0.0.1"), false);
});

test("folder names stay inside one path segment", () => {
  assert.equal(isHostFolderName("demo"), true);
  assert.equal(isHostFolderName("../etc"), false);
  assert.equal(isHostFolderName("a/b"), false);
  assert.equal(isHostFolderName("a\\b"), false);
  assert.equal(isHostFolderName("."), false);
});

test("lan info schema rejects a missing fingerprint", () => {
  assert.equal(
    lanRemoteInfoSchema.safeParse({
      protocolVersion: 1,
      deviceId: "device",
      displayName: "ZCode",
      fingerprint: "abc",
      authRequired: true,
    }).success,
    false,
  );
});

test("https cert expiry warning: 16 days no, 15 days and expired yes", () => {
  const now = Date.parse("2026-09-22T00:00:00.000Z");
  assert.equal(httpsCertDaysRemaining(now + 16 * MS_PER_DAY, now), 16);
  assert.equal(
    shouldWarnHttpsCertExpiry({
      notAfterMs: now + 16 * MS_PER_DAY,
      nowMs: now,
      lastWarnedNotAfter: null,
    }),
    false,
  );
  assert.equal(
    shouldWarnHttpsCertExpiry({
      notAfterMs: now + 15 * MS_PER_DAY,
      nowMs: now,
      lastWarnedNotAfter: null,
    }),
    true,
  );
  assert.equal(
    shouldWarnHttpsCertExpiry({
      notAfterMs: now - MS_PER_DAY,
      nowMs: now,
      lastWarnedNotAfter: null,
    }),
    true,
  );
});
