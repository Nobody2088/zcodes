import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveServiceLoggerPid } from "../src/logger/serviceLogger.js";

test("resolveServiceLoggerPid 在没有 process 时不抛并回退 0", () => {
  assert.equal(resolveServiceLoggerPid(undefined, {}), 0);
  assert.equal(resolveServiceLoggerPid(12, {}), 12);
  assert.equal(resolveServiceLoggerPid(undefined, { pid: 7 }), 7);
});

test("browser facade 不得静态导入 catalog sync（会把 process.pid 打进 renderer）", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/model-provider/providerFacadeServices.ts"),
    "utf8",
  );
  assert.equal(src.includes("providerRemoteModelCatalogSync"), false);
  assert.equal(src.includes("createServiceLogger"), false);
});
