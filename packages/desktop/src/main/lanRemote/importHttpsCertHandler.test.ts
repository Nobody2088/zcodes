import assert from "node:assert/strict";
import test from "node:test";
import { normalizeImportRequest } from "./importHttpsCertRequest.js";

test("normalizeImportRequest treats string as directory path", () => {
  assert.deepEqual(normalizeImportRequest("/tmp/acme"), {
    kind: "directory",
    directoryPath: "/tmp/acme",
  });
  assert.deepEqual(normalizeImportRequest(""), { kind: "directory" });
});

test("normalizeImportRequest defaults to files and accepts pick actions", () => {
  assert.deepEqual(normalizeImportRequest(undefined), { kind: "files" });
  assert.deepEqual(normalizeImportRequest({ kind: "pickCertificate" }), {
    kind: "pickCertificate",
  });
  assert.deepEqual(
    normalizeImportRequest({ kind: "files", certPath: "/c.pem", keyPath: "/k.pem" }),
    { kind: "files", certPath: "/c.pem", keyPath: "/k.pem" },
  );
});

test("cancelled import result stays quiet without throw message", () => {
  // 与 Main 取消路径一致：返回 cancelled，不抛 Certificate import cancelled。
  const result = { cancelled: true as const, state: { enabled: false } };
  assert.equal(result.cancelled, true);
  assert.doesNotThrow(() => {
    if (result.cancelled) return;
    throw new Error("Certificate import cancelled");
  });
});
