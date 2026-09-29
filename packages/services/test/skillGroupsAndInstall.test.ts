import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applySkillGroupMutation,
  buildSkillDescriptionZh,
  createSeededUserSkillGroupsDocument,
  mergeInstalledSkillAssignments,
  parseGitHubRepositoryUrl,
  projectSkillGroupSections,
  SkillGroupMutationError,
  skillGroupAssignmentKey,
  skillSourceUpdateAvailable,
} from "@zcode/shared";
import { createSkillsService } from "../src/skills/skillsService.js";
import {
  installSkillTree,
  listInstalledSources,
  replaceDirectory,
} from "../src/skills/skillGitHubInstall.js";

test("skill group mutations rename, reorder, and delete without removing skills", () => {
  const seeded = createSeededUserSkillGroupsDocument();
  const created = applySkillGroupMutation(seeded, {
    type: "create",
    id: "group-custom",
    name: "自定义",
  });
  const renamed = applySkillGroupMutation(created, {
    type: "rename",
    groupId: "builtin-browser",
    name: "网页",
  });
  assert.equal(renamed.groups[0]?.name, "网页");
  const ids = renamed.groups.map((group) => group.id);
  const reordered = applySkillGroupMutation(renamed, {
    type: "reorder",
    groupIds: [ids[1]!, ids[0]!, ...ids.slice(2)],
  });
  assert.equal(reordered.groups[0]?.id, "builtin-documents");
  const deleted = applySkillGroupMutation(reordered, {
    type: "delete",
    groupId: "builtin-browser",
  });
  assert.equal(
    deleted.assignments.some((assignment) => assignment.groupId === "builtin-browser"),
    false,
  );
  assert.equal(
    deleted.groups.some((group) => group.id === "builtin-browser"),
    false,
  );
  assert.throws(
    () => applySkillGroupMutation(deleted, { type: "create", id: "again", name: "自定义" }),
    SkillGroupMutationError,
  );
});

test("project sections keep preset groups and leave unknown skills ungrouped", () => {
  const userDocument = createSeededUserSkillGroupsDocument();
  const sections = projectSkillGroupSections({
    skills: [
      { scope: "plugin", name: "control-browser" },
      { scope: "user", name: "orchestration" },
    ],
    viewScope: "user",
    userDocument,
    workspaceDocument: { groups: [], assignments: [], initialized: true },
    ungroupedLabel: "未分组",
  });
  const browser = sections.find((section) => section.id === "builtin-browser");
  const ungrouped = sections.find((section) => section.id === "__ungrouped__");
  assert.deepEqual(
    browser?.skills.map((skill) => skill.name),
    ["control-browser"],
  );
  assert.deepEqual(
    ungrouped?.skills.map((skill) => skill.name),
    ["orchestration"],
  );
  assert.equal(browser?.editable, true);
});

test("description helpers keep Chinese text and label English skills", () => {
  assert.equal(
    buildSkillDescriptionZh({
      name: "router",
      description: "这是中文说明",
      groupName: "逆向",
    }),
    "这是中文说明",
  );
  assert.equal(
    buildSkillDescriptionZh({ name: "router", description: "Route tasks", groupName: "逆向" }),
    "逆向中的技能「router」。",
  );
  assert.deepEqual(parseGitHubRepositoryUrl("https://github.com/zhaoxuya520/reverse-skill"), {
    owner: "zhaoxuya520",
    repo: "reverse-skill",
    url: "https://github.com/zhaoxuya520/reverse-skill",
  });
  assert.equal(parseGitHubRepositoryUrl("https://example.com/a/b"), null);
});

test("skills longer than 1024 characters stay listed", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "zcode-skill-long-"));
  const skillDir = join(workspace, ".zcode", "skills", "orchestration");
  await mkdir(skillDir, { recursive: true });
  const description = "x".repeat(1100);
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: orchestration\ndescription: ${description}\n---\nbody\n`,
    "utf8",
  );
  try {
    const service = createSkillsService({ isDesktopRuntime: false });
    const listed = await service.list({ workspacePath: workspace });
    const skill = listed.skills.find((item) => item.name === "orchestration");
    assert.ok(skill);
    assert.equal(skill?.description.length, 1100);
    assert.equal(
      listed.diagnostics.some((diagnostic) => diagnostic.code === "skill_description_too_long"),
      false,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("local skill tree installs into a workspace group with Chinese descriptions", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "zcode-skill-install-"));
  const home = await mkdtemp(join(tmpdir(), "zcode-skill-home-"));
  const extracted = await mkdtemp(join(tmpdir(), "zcode-skill-src-"));
  const englishDir = join(extracted, "router");
  const chineseDir = join(extracted, "notes");
  await mkdir(englishDir, { recursive: true });
  await mkdir(chineseDir, { recursive: true });
  await writeFile(
    join(englishDir, "SKILL.md"),
    `---\nname: router\ndescription: ${"Route the work. ".repeat(80)}\nlicense: MIT\n---\n# Router\n`,
    "utf8",
  );
  await writeFile(
    join(chineseDir, "SKILL.md"),
    "---\nname: notes\ndescription: 记录已有结论\n---\n正文\n",
    "utf8",
  );
  try {
    const service = createSkillsService({ isDesktopRuntime: true, userHomeDir: home });
    const created = await service.mutateSkillGroups({
      workspacePath: workspace,
      scope: "workspace",
      mutation: { type: "create", id: "group-lab", name: "实验" },
    });
    const installed = await installSkillTree({
      extractedRoot: extracted,
      targetRoot: join(workspace, ".zcode", "skills"),
      scope: "workspace",
      groupId: "group-lab",
      groupName: "实验",
      groups: created,
      source: {
        provider: "github",
        owner: "example",
        repo: "skills",
        url: "https://github.com/example/skills",
        commit: "abc123",
        groupId: "group-lab",
      },
    });
    await service.mutateSkillGroups({
      workspacePath: workspace,
      scope: "workspace",
      mutation: {
        type: "assign",
        skillKey: skillGroupAssignmentKey("workspace", "router"),
        groupId: "group-lab",
      },
    });
    assert.deepEqual(installed.installed.map((skill) => skill.name).sort(), ["notes", "router"]);
    const routerMeta = JSON.parse(
      await readFile(join(workspace, ".zcode", "skills", "router", "_meta.json"), "utf8"),
    ) as { descriptionZh: string; source: { commit: string } };
    assert.equal(routerMeta.descriptionZh, "实验中的技能「router」。");
    assert.equal(routerMeta.source.commit, "abc123");
    const notesMeta = JSON.parse(
      await readFile(join(workspace, ".zcode", "skills", "notes", "_meta.json"), "utf8"),
    ) as { descriptionZh: string };
    assert.equal(notesMeta.descriptionZh, "记录已有结论");
    const markdown = await readFile(
      join(workspace, ".zcode", "skills", "router", "SKILL.md"),
      "utf8",
    );
    assert.match(markdown, /name: router/);
    assert.match(markdown, /license: MIT/);
    const listed = await service.list({ workspacePath: workspace });
    assert.equal(
      listed.skills.find((skill) => skill.name === "router")?.description.length,
      "Route the work. ".repeat(80).trim().length,
    );
    const deleted = await service.mutateSkillGroups({
      workspacePath: workspace,
      scope: "workspace",
      mutation: { type: "delete", groupId: "group-lab" },
    });
    assert.equal(deleted.groups.length, 0);
    assert.equal(
      await readFile(join(workspace, ".zcode", "skills", "router", "SKILL.md"), "utf8"),
      markdown,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    await rm(extracted, { recursive: true, force: true });
  }
});

test("replacing a skill directory keeps the original when staging fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-skill-replace-"));
  const target = join(root, "router");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "old\n", "utf8");
  try {
    await assert.rejects(
      replaceDirectory(target, async () => {
        throw new Error("copy-failed");
      }),
      /copy-failed/,
    );
    assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "old\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install assignment merge keeps groups created while a download is in flight", () => {
  const duringDownload = applySkillGroupMutation(
    {
      groups: [{ id: "group-lab", name: "实验" }],
      assignments: [],
      initialized: true,
    },
    { type: "create", id: "group-extra", name: "后来新建" },
  );
  const merged = mergeInstalledSkillAssignments({
    document: duringDownload,
    scope: "workspace",
    groupId: "group-lab",
    skillNames: ["router"],
  });
  assert.equal(
    merged.groups.some((group) => group.name === "后来新建"),
    true,
  );
  assert.equal(
    merged.assignments.some((assignment) => assignment.skillKey === "workspace:router"),
    true,
  );
  const deletedGroup = mergeInstalledSkillAssignments({
    document: { groups: [], assignments: [], initialized: true },
    scope: "workspace",
    groupId: "group-lab",
    skillNames: ["router"],
  });
  assert.equal(deletedGroup.assignments.length, 0);
});

test("a corrupt groups file is listed empty and is not overwritten", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "zcode-skill-corrupt-"));
  const groupsFile = join(workspace, ".zcode", "skill-groups.json");
  await mkdir(join(workspace, ".zcode"), { recursive: true });
  await writeFile(groupsFile, "{", "utf8");
  try {
    const service = createSkillsService({ isDesktopRuntime: false });
    const listed = await service.listSkillGroups({ workspacePath: workspace, scope: "workspace" });
    assert.equal(listed.groups.length, 0);
    assert.equal(await readFile(groupsFile, "utf8"), "{");
    await assert.rejects(
      service.mutateSkillGroups({
        workspacePath: workspace,
        scope: "workspace",
        mutation: { type: "create", id: "group-new", name: "新分组" },
      }),
      /skill-groups:invalid-file/,
    );
    assert.equal(await readFile(groupsFile, "utf8"), "{");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("mixed installed commits are reported as an available update", async () => {
  assert.equal(skillSourceUpdateAvailable(["aaa", "bbb"], "bbb"), true);
  assert.equal(skillSourceUpdateAvailable(["bbb"], "bbb"), false);
  const root = await mkdtemp(join(tmpdir(), "zcode-skill-commits-"));
  for (const [name, commit] of [
    ["router", "aaa"],
    ["notes", "bbb"],
  ] as const) {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name}\n---\n`,
      "utf8",
    );
    await writeFile(
      join(dir, "_meta.json"),
      JSON.stringify({
        source: {
          provider: "github",
          owner: "example",
          repo: "skills",
          url: "https://github.com/example/skills",
          commit,
          groupId: "group-lab",
        },
      }),
      "utf8",
    );
  }
  try {
    const sources = await listInstalledSources(root);
    assert.equal(sources.length, 1);
    assert.deepEqual(sources[0]?.commits.sort(), ["aaa", "bbb"]);
    assert.equal(skillSourceUpdateAvailable(sources[0]?.commits ?? [], "bbb"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("user groups are seeded once and keep later edits", async () => {
  const home = await mkdtemp(join(tmpdir(), "zcode-skill-groups-"));
  const workspace = await mkdtemp(join(tmpdir(), "zcode-skill-groups-ws-"));
  try {
    const service = createSkillsService({ isDesktopRuntime: true, userHomeDir: home });
    const seeded = await service.listSkillGroups({ workspacePath: workspace, scope: "user" });
    assert.equal(
      seeded.groups.some((group) => group.name === "浏览器"),
      true,
    );
    const renamed = await service.mutateSkillGroups({
      workspacePath: workspace,
      scope: "user",
      mutation: { type: "rename", groupId: "builtin-browser", name: "浏览" },
    });
    assert.equal(renamed.groups.find((group) => group.id === "builtin-browser")?.name, "浏览");
    const again = await service.listSkillGroups({ workspacePath: workspace, scope: "user" });
    assert.equal(again.groups.find((group) => group.id === "builtin-browser")?.name, "浏览");
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});
