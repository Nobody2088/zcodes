import assert from "node:assert/strict";
import test from "node:test";
import {
  databaseStartupControlSchema,
  shouldReplayDatabaseStartupServicePort,
} from "../src/database-startup.js";

test("ready without a matching port must request replay", () => {
  assert.equal(
    shouldReplayDatabaseStartupServicePort({
      phase: "ready",
      hasMatchingPort: false,
      appInitialized: false,
    }),
    true,
  );
});

test("ready with a matching port must not request replay", () => {
  assert.equal(
    shouldReplayDatabaseStartupServicePort({
      phase: "ready",
      hasMatchingPort: true,
      appInitialized: false,
    }),
    false,
  );
});

test("starting or already-initialized must not request replay", () => {
  assert.equal(
    shouldReplayDatabaseStartupServicePort({
      phase: "starting",
      hasMatchingPort: false,
      appInitialized: false,
    }),
    false,
  );
  assert.equal(
    shouldReplayDatabaseStartupServicePort({
      phase: "ready",
      hasMatchingPort: false,
      appInitialized: true,
    }),
    false,
  );
});

test("request-service-port is a Main-only startup control", () => {
  const parsed = databaseStartupControlSchema.safeParse({ action: "request-service-port" });
  assert.equal(parsed.success, true);
});
