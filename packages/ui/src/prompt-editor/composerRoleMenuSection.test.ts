import assert from "node:assert/strict";
import test from "node:test";
import { insertComposerRoleSection } from "./composerRoleMenuSection.js";

test("role section sits between add and plugins", () => {
  const sections = insertComposerRoleSection(
    [
      { id: "add" },
      { id: "plugins" },
      { id: "files" },
    ],
    { id: "roles" },
  );
  assert.deepEqual(
    sections.map((section) => section.id),
    ["add", "roles", "plugins", "files"],
  );
});

test("role section stays hidden when no role picker is mounted", () => {
  const sections = insertComposerRoleSection([{ id: "add" }, { id: "plugins" }], null);
  assert.deepEqual(
    sections.map((section) => section.id),
    ["add", "plugins"],
  );
});
