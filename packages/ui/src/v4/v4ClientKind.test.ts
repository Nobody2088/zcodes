import assert from "node:assert/strict";
import test from "node:test";
import { resolveV4ClientKind, setV4ClientKindOverride } from "./v4ClientKind.js";

test("lan phone shell identifies itself as mobileApp", () => {
  assert.equal(resolveV4ClientKind("desktop-continuous"), "desktop");
  assert.equal(resolveV4ClientKind("web-remote-replayable"), "web");
  setV4ClientKindOverride("mobileApp");
  assert.equal(resolveV4ClientKind("web-remote-replayable"), "mobileApp");
  setV4ClientKindOverride(undefined);
});
