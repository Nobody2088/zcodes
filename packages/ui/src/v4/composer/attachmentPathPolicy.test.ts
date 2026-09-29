import assert from "node:assert/strict";
import test from "node:test";
import { shouldZeroCopyAttachmentPath } from "./attachmentPathPolicy.js";

test("local desktop path is zero-copy only when the workspace is not remote", () => {
  assert.equal(shouldZeroCopyAttachmentPath({ localPath: "/tmp/a.zip" }, {}), true);
  assert.equal(
    shouldZeroCopyAttachmentPath(
      { localPath: "/tmp/a.zip" },
      { workspaceIdentity: "ssh://dev@example.test/srv/app" },
    ),
    false,
  );
});

test("a file chosen on the agent filesystem stays zero-copy for a remote workspace", () => {
  assert.equal(
    shouldZeroCopyAttachmentPath(
      { localPath: "/srv/app/notes.md", agentFilesystem: true },
      { workspaceIdentity: "ssh://dev@example.test/srv/app", remoteSessionId: "remote-1" },
    ),
    true,
  );
});
