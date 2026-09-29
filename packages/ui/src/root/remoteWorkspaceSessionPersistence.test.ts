import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings } from "@zcode/shared";
import {
  mergeLanLocalWorkspacesIntoSession,
  unionPersistedWorkspaceSessions,
} from "./lanLocalWorkspaceSession.js";
import {
  resolveLanMobileRestoreIndex,
  resolveLanMobileRestoreTaskId,
} from "./lanMobileActiveWorkspace.js";

const remoteSession = {
  kind: "remote" as const,
  workspacePath: "/srv/app",
  workspaceIdentity: "ssh://dev@example.test/srv/app",
  target: { kind: "ssh" as const, host: "example.test", username: "dev" },
  lastOpenedAt: 10,
  lastConnectionStatus: "connected" as const,
};

function settings(
  session: NonNullable<AppSettings["lastWorkspaceSession"]>,
  recentProjects: string[] = [],
): Pick<AppSettings, "lastWorkspaceSession" | "recentProjects"> {
  return { lastWorkspaceSession: session, recentProjects };
}

test("phone appends a new local project and keeps remote sessions", () => {
  const merged = mergeLanLocalWorkspacesIntoSession(
    settings(
      [
        { kind: "local", workspacePath: "/desk", workspacePurpose: "project" },
        remoteSession,
      ],
      ["/desk"],
    ),
    [{ workspacePath: "/phone", workspacePurpose: "project" }],
  );

  assert.ok(merged);
  assert.deepEqual(
    merged.patch.lastWorkspaceSession?.map((entry) =>
      entry.kind === "local" ? entry.workspacePath : entry.workspaceIdentity,
    ),
    ["/desk", "ssh://dev@example.test/srv/app", "/phone"],
  );
  assert.deepEqual(merged.patch.recentProjects, ["/phone", "/desk"]);
  assert.equal("lastActiveTabIndex" in merged.patch, false);
  assert.deepEqual(merged.appended, [{ workspacePath: "/phone", workspacePurpose: "project" }]);
});

test("empty phone workspace list does not write", () => {
  assert.equal(
    mergeLanLocalWorkspacesIntoSession(
      settings([{ kind: "local", workspacePath: "/desk", workspacePurpose: "project" }]),
      [],
    ),
    null,
  );
});

test("phone does not drop a desktop project it has not opened", () => {
  const merged = mergeLanLocalWorkspacesIntoSession(
    settings([
      { kind: "local", workspacePath: "/desk-only", workspacePurpose: "project" },
      remoteSession,
    ]),
    [{ workspacePath: "/phone", workspacePurpose: "project" }],
  );
  const paths = merged?.patch.lastWorkspaceSession?.map((entry) => entry.workspacePath);
  assert.deepEqual(paths, ["/desk-only", "/srv/app", "/phone"]);
});

test("conversation workspace is appended without becoming a recent project", () => {
  const merged = mergeLanLocalWorkspacesIntoSession(settings([]), [
    { workspacePath: "/tmp/conversation", workspacePurpose: "conversation" },
  ]);
  assert.ok(merged);
  assert.equal(merged.patch.recentProjects, undefined);
  assert.equal(merged.patch.lastWorkspaceSession?.[0]?.kind, "local");
});

test("union keeps entries dropped by a stale snapshot", () => {
  const union = unionPersistedWorkspaceSessions(
    settings([{ kind: "local", workspacePath: "/desk", workspacePurpose: "project" }, remoteSession]),
    settings([{ kind: "local", workspacePath: "/phone", workspacePurpose: "project" }]),
  );
  assert.deepEqual(
    union.lastWorkspaceSession?.map((entry) => entry.workspacePath),
    ["/desk", "/srv/app", "/phone"],
  );
});

test("phone restore prefers the project it last opened", () => {
  assert.equal(resolveLanMobileRestoreIndex(["/desk", "/phone"], 0, "/phone"), 1);
  assert.equal(resolveLanMobileRestoreIndex(["/desk", "/phone"], 0, "/missing"), 0);
  assert.equal(resolveLanMobileRestoreIndex(["/desk"], 0, null), 0);
});

test("phone restore prefers the conversation it last viewed", () => {
  assert.equal(resolveLanMobileRestoreTaskId(["t-new", "t-old"], "t-old"), "t-old");
  assert.equal(resolveLanMobileRestoreTaskId(["t-new", "t-old"], "t-gone"), "t-new");
  assert.equal(resolveLanMobileRestoreTaskId(["t-new"], null), "t-new");
  assert.equal(resolveLanMobileRestoreTaskId([], "t-old"), null);
});
