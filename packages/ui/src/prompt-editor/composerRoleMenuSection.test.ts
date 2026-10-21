import assert from "node:assert/strict";
import test from "node:test";
import { listSelectableComposerRoles } from "@zcode/shared";
import {
  composerRoleOptionMeta,
  insertComposerRoleSection,
} from "./composerRoleMenuSection.js";

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

test("role options keep the full catalog description for hover hints", () => {
  const roles = listSelectableComposerRoles();
  const binary = roles.find((role) => role.id === "二进制分析");
  assert.ok(binary);
  assert.equal(binary.description.includes("请使用逆向工程工具"), false);
  assert.equal(binary.detail.includes("请使用逆向工程工具"), true);
  for (const role of roles) {
    const option = composerRoleOptionMeta(role);
    assert.equal(option.id, `role:${role.id}`);
    assert.equal(option.label, role.name);
    assert.equal(option.description, role.description);
    assert.equal(option.detail, role.detail);
    assert.equal(option.detail.includes("…"), false);
    assert.equal(option.detail.endsWith("..."), false);
  }
});
