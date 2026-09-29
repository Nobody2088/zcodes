import assert from "node:assert/strict";
import test from "node:test";
import { canRunDisposableCleanup, readLanDesktopSession } from "./phoneDesktopCleanup.js";

test("a paired phone can clean without the desktop-only method", () => {
  assert.equal(
    canRunDisposableCleanup({ hasPlatformCleanup: false, hasLanSession: true }),
    true,
  );
  assert.equal(
    canRunDisposableCleanup({ hasPlatformCleanup: true, hasLanSession: false }),
    true,
  );
  assert.equal(
    canRunDisposableCleanup({ hasPlatformCleanup: false, hasLanSession: false }),
    false,
  );
});

test("paired session is read from the phone page storage", () => {
  const store = new Map<string, string>();
  const previous = globalThis.sessionStorage;
  Object.assign(globalThis, {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
    },
  });
  try {
    assert.equal(readLanDesktopSession(), null);
    store.set(
      "zcode:lan-remote-session",
      JSON.stringify({ origin: "https://mac.local:443/", token: "abc", clientId: "phone" }),
    );
    assert.deepEqual(readLanDesktopSession(), { origin: "https://mac.local:443", token: "abc" });
  } finally {
    Object.assign(globalThis, { sessionStorage: previous });
  }
});
