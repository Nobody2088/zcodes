import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseStartupAdmission } from "./databaseStartupAdmission.js";
import type { DatabaseStartupState } from "@zcode/shared";

function readyState(startupId: string): DatabaseStartupState {
  const now = 1;
  return {
    schemaVersion: 1,
    startupId,
    attemptId: "attempt",
    sequence: 1,
    startedAt: now,
    updatedAt: now,
    phase: "ready",
    disk: [],
  };
}

function fakePort(): MessagePort {
  return { close() {} } as MessagePort;
}

test("ready state without the same-generation port cannot enter Root", () => {
  const admission = new DatabaseStartupAdmission();
  admission.acceptState(readyState("host-a"));
  assert.equal(admission.takeReadyPort(), undefined);
  assert.equal(admission.needsServicePortReplay(false), true);
});

test("matching port after ready yields once and then needs no replay", () => {
  const admission = new DatabaseStartupAdmission();
  const port = fakePort();
  admission.acceptState(readyState("host-a"));
  admission.acceptPort({ databaseStartupId: "host-a" }, port);
  assert.equal(admission.needsServicePortReplay(false), false);
  assert.equal(admission.takeReadyPort(), port);
  assert.equal(admission.takeReadyPort(), undefined);
});

test("ready A cannot pair with port B", () => {
  const admission = new DatabaseStartupAdmission();
  admission.acceptState(readyState("host-a"));
  admission.acceptPort({ databaseStartupId: "host-b" }, fakePort());
  assert.equal(admission.takeReadyPort(), undefined);
  assert.equal(admission.needsServicePortReplay(false), true);
});
