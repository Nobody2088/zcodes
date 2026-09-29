import assert from "node:assert/strict";
import test from "node:test";
import {
  FORK_DESKTOP_IN_APP_UPDATE_ENABLED,
  isDesktopInAppUpdateEnabled,
} from "../src/desktopInAppUpdate.js";

test("production fork keeps in-app update disabled", () => {
  assert.equal(FORK_DESKTOP_IN_APP_UPDATE_ENABLED, false);
  assert.equal(isDesktopInAppUpdateEnabled("production"), false);
  assert.equal(isDesktopInAppUpdateEnabled("preview"), false);
});

test("official restoration only enables production flavor", () => {
  assert.equal(isDesktopInAppUpdateEnabled("production", true), true);
  assert.equal(isDesktopInAppUpdateEnabled("preview", true), false);
  assert.equal(isDesktopInAppUpdateEnabled("production", false), false);
});
