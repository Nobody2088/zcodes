import type { SkillScope } from "./skills-types.js";

export type SkillGroupScope = "user" | "workspace";

export interface SkillGroup {
  id: string;
  name: string;
}

export interface SkillGroupAssignment {
  skillKey: string;
  groupId: string;
}

export interface SkillGroupsDocument {
  groups: SkillGroup[];
  assignments: SkillGroupAssignment[];
  initialized: boolean;
  /**
   * plugin / 内置等不可写技能目录的中文说明 overlay。
   * 键为 `skillGroupAssignmentKey(scope, name)`（如 `plugin:control-browser`）。
   */
  descriptionZhBySkillKey?: Record<string, string>;
}

export type SkillGroupMutation =
  | { type: "create"; id: string; name: string }
  | { type: "rename"; groupId: string; name: string }
  | { type: "delete"; groupId: string }
  | { type: "reorder"; groupIds: string[] }
  | { type: "assign"; skillKey: string; groupId: string | null };

export type SkillGroupMutationErrorCode =
  | "empty-name"
  | "duplicate-name"
  | "missing-group"
  | "invalid-order";

export class SkillGroupMutationError extends Error {
  constructor(readonly code: SkillGroupMutationErrorCode) {
    super(code);
    this.name = "SkillGroupMutationError";
  }
}

export const UNGROUPED_SKILL_GROUP_ID = "__ungrouped__";

const BUILTIN_SKILL_GROUPS: ReadonlyArray<{
  id: string;
  name: string;
  skills: readonly string[];
}> = [
  { id: "builtin-browser", name: "浏览器", skills: ["control-browser", "web-gui-tester"] },
  { id: "builtin-documents", name: "文档", skills: ["docx", "pdf", "pptx"] },
  {
    id: "builtin-planning",
    name: "规划",
    skills: [
      "brainstorming",
      "writing-plans",
      "executing-plans",
      "verification-before-completion",
      "dispatching-parallel-agents",
      "using-git-worktrees",
      "using-superpowers",
      "writing-skills",
      "dynamic-workflows",
      "finishing-a-development-branch",
      "receiving-code-review",
      "requesting-code-review",
      "subagent-driven-development",
      "systematic-debugging",
      "test-driven-development",
    ],
  },
  { id: "builtin-devices", name: "设备", skills: ["android-dev", "ios-dev"] },
  {
    id: "builtin-skill-creation",
    name: "技能创作",
    skills: ["agent-bypass", "skill-creator", "plugin-creator"],
  },
];

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  url: string;
  ref?: string;
}

export interface SkillGitHubInstallResult {
  repo: string;
  commit: string;
  installed: string[];
  skipped: Array<{ name: string; reason: string }>;
  groupId: string;
}

export type SkillTranslateTarget =
  | { mode: "all" }
  | { mode: "group"; groupId: string }
  | { mode: "skill"; skillId: string };

export interface SkillTranslateDescriptionsResult {
  translated: number;
  skipped: number;
  failed: number;
}

export interface SkillSourceUpdate {
  repo: string;
  url: string;
  installedCommit: string;
  remoteCommit: string;
  updateAvailable: boolean;
}

export interface SkillGroupSection<T> {
  id: string;
  name: string;
  ownerScope: SkillGroupScope | null;
  editable: boolean;
  skills: T[];
}

export function skillGroupAssignmentKey(scope: SkillScope, name: string): string {
  return `${scope}:${name.trim()}`;
}

export function createEmptySkillGroupsDocument(): SkillGroupsDocument {
  return { groups: [], assignments: [], initialized: true };
}

export function createSeededUserSkillGroupsDocument(): SkillGroupsDocument {
  return {
    initialized: true,
    groups: BUILTIN_SKILL_GROUPS.map((group) => ({ id: group.id, name: group.name })),
    assignments: BUILTIN_SKILL_GROUPS.flatMap((group) =>
      group.skills.map((name) => ({
        skillKey: skillGroupAssignmentKey("plugin", name),
        groupId: group.id,
      })),
    ),
  };
}

export function applySkillGroupMutation(
  document: SkillGroupsDocument,
  mutation: SkillGroupMutation,
): SkillGroupsDocument {
  switch (mutation.type) {
    case "create":
      return createGroup(document, mutation.id, mutation.name);
    case "rename":
      return renameGroup(document, mutation.groupId, mutation.name);
    case "delete":
      return deleteGroup(document, mutation.groupId);
    case "reorder":
      return reorderGroups(document, mutation.groupIds);
    case "assign":
      return assignSkill(document, mutation.skillKey, mutation.groupId);
    default:
      return document;
  }
}

export function mergeInstalledSkillAssignments(input: {
  document: SkillGroupsDocument;
  scope: SkillGroupScope;
  groupId: string;
  skillNames: readonly string[];
}): SkillGroupsDocument {
  if (!input.document.groups.some((group) => group.id === input.groupId)) {
    return input.document;
  }
  const assignmentScope = input.scope === "workspace" ? "workspace" : "user";
  let next = input.document;
  for (const name of input.skillNames) {
    const skillKey = skillGroupAssignmentKey(assignmentScope, name);
    if (next.assignments.some((assignment) => assignment.skillKey === skillKey)) {
      continue;
    }
    next = applySkillGroupMutation(next, {
      type: "assign",
      skillKey,
      groupId: input.groupId,
    });
  }
  return next;
}

export function skillSourceUpdateAvailable(
  commits: readonly string[],
  remoteCommit: string,
): boolean {
  return commits.some((commit) => commit !== remoteCommit);
}

/** 原文是否以汉字为主：Han 字符数不少于拉丁字母数。 */
export function isPredominantlyChinese(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const han = trimmed.match(/\p{Script=Han}/gu)?.length ?? 0;
  if (han === 0) {
    return false;
  }
  const latin = trimmed.match(/[A-Za-z]/g)?.length ?? 0;
  return han >= latin;
}

export function buildSkillDescriptionZh(input: {
  name: string;
  description: string;
  groupName: string;
}): string {
  const description = input.description.trim();
  if (isPredominantlyChinese(description)) {
    return description;
  }
  const groupName = input.groupName.trim() || "未分组";
  return `${groupName}中的技能「${input.name.trim()}」。`;
}

export function skillInstallDirectoryName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "skill";
}

export function parseGitHubRepositoryUrl(input: string): GitHubRepositoryRef | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const short = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/u.exec(trimmed);
  if (short) {
    return repositoryRef(short[1] ?? "", short[2] ?? "");
  }
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const ref = readGitHubRef(parts);
  return repositoryRef(parts[0] ?? "", (parts[1] ?? "").replace(/\.git$/u, ""), ref);
}

export function projectSkillGroupSections<T extends { scope: SkillScope; name: string }>(input: {
  skills: readonly T[];
  viewScope: SkillGroupScope;
  userDocument: SkillGroupsDocument;
  workspaceDocument: SkillGroupsDocument;
  ungroupedLabel: string;
}): Array<SkillGroupSection<T>> {
  const userAssignments = assignmentMap(input.userDocument);
  const workspaceAssignments = assignmentMap(input.workspaceDocument);
  const buckets = new Map<string, T[]>();
  const takeBucket = (id: string) => {
    const skills = buckets.get(id) ?? [];
    buckets.set(id, skills);
    return skills;
  };

  for (const skill of input.skills) {
    const key = skillGroupAssignmentKey(skill.scope, skill.name);
    const ownerDocument =
      skill.scope === "workspace" ? input.workspaceDocument : input.userDocument;
    const groupId =
      skill.scope === "workspace" ? workspaceAssignments.get(key) : userAssignments.get(key);
    const group = groupId ? ownerDocument.groups.find((item) => item.id === groupId) : undefined;
    takeBucket(
      group
        ? sectionKey(skill.scope === "workspace" ? "workspace" : "user", group.id)
        : UNGROUPED_SKILL_GROUP_ID,
    ).push(skill);
  }

  const sections: Array<SkillGroupSection<T>> = [];
  const pushDocument = (
    scope: SkillGroupScope,
    document: SkillGroupsDocument,
    editable: boolean,
  ) => {
    for (const group of document.groups) {
      const skills = buckets.get(sectionKey(scope, group.id)) ?? [];
      if (scope !== input.viewScope && skills.length === 0) {
        continue;
      }
      sections.push({
        id: group.id,
        name: group.name,
        ownerScope: scope,
        editable,
        skills,
      });
    }
  };

  if (input.viewScope === "user") {
    pushDocument("user", input.userDocument, true);
  } else {
    pushDocument("workspace", input.workspaceDocument, true);
    pushDocument("user", input.userDocument, false);
  }
  sections.push({
    id: UNGROUPED_SKILL_GROUP_ID,
    name: input.ungroupedLabel,
    ownerScope: null,
    editable: false,
    skills: buckets.get(UNGROUPED_SKILL_GROUP_ID) ?? [],
  });
  return sections;
}

function sectionKey(scope: SkillGroupScope, groupId: string): string {
  return `${scope}:${groupId}`;
}

function assignmentMap(document: SkillGroupsDocument): Map<string, string> {
  return new Map(
    document.assignments.map((assignment) => [assignment.skillKey, assignment.groupId]),
  );
}

function createGroup(document: SkillGroupsDocument, id: string, name: string): SkillGroupsDocument {
  const trimmed = requireGroupName(name);
  if (document.groups.some((group) => group.name === trimmed)) {
    throw new SkillGroupMutationError("duplicate-name");
  }
  return {
    ...document,
    initialized: true,
    groups: [...document.groups, { id, name: trimmed }],
  };
}

function renameGroup(
  document: SkillGroupsDocument,
  groupId: string,
  name: string,
): SkillGroupsDocument {
  const trimmed = requireGroupName(name);
  const current = requireGroup(document, groupId);
  if (document.groups.some((group) => group.id !== current.id && group.name === trimmed)) {
    throw new SkillGroupMutationError("duplicate-name");
  }
  return {
    ...document,
    initialized: true,
    groups: document.groups.map((group) =>
      group.id === groupId ? { ...group, name: trimmed } : group,
    ),
  };
}

function deleteGroup(document: SkillGroupsDocument, groupId: string): SkillGroupsDocument {
  requireGroup(document, groupId);
  return {
    ...document,
    initialized: true,
    groups: document.groups.filter((group) => group.id !== groupId),
    assignments: document.assignments.filter((assignment) => assignment.groupId !== groupId),
  };
}

function reorderGroups(
  document: SkillGroupsDocument,
  groupIds: readonly string[],
): SkillGroupsDocument {
  if (
    groupIds.length !== document.groups.length ||
    new Set(groupIds).size !== groupIds.length ||
    document.groups.some((group) => !groupIds.includes(group.id))
  ) {
    throw new SkillGroupMutationError("invalid-order");
  }
  const byId = new Map(document.groups.map((group) => [group.id, group]));
  return {
    ...document,
    initialized: true,
    groups: groupIds.map((groupId) => byId.get(groupId)!),
  };
}

function assignSkill(
  document: SkillGroupsDocument,
  skillKey: string,
  groupId: string | null,
): SkillGroupsDocument {
  const assignments = document.assignments.filter((assignment) => assignment.skillKey !== skillKey);
  if (groupId === null) {
    return { ...document, initialized: true, assignments };
  }
  requireGroup(document, groupId);
  return {
    ...document,
    initialized: true,
    assignments: [...assignments, { skillKey, groupId }],
  };
}

function requireGroupName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) {
    throw new SkillGroupMutationError("empty-name");
  }
  return trimmed;
}

function requireGroup(document: SkillGroupsDocument, groupId: string): SkillGroup {
  const group = document.groups.find((item) => item.id === groupId);
  if (!group) {
    throw new SkillGroupMutationError("missing-group");
  }
  return group;
}

function repositoryRef(owner: string, repo: string, ref?: string): GitHubRepositoryRef | null {
  if (!/^[\w.-]+$/u.test(owner) || !/^[\w.-]+$/u.test(repo)) {
    return null;
  }
  return {
    owner,
    repo,
    url: `https://github.com/${owner}/${repo}`,
    ...(ref ? { ref } : {}),
  };
}

function readGitHubRef(parts: readonly string[]): string | undefined {
  if ((parts[2] === "tree" || parts[2] === "commit") && parts[3]) {
    return decodeURIComponent(parts[3]);
  }
  return undefined;
}
