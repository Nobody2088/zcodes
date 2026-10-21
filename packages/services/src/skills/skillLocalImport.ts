import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  isPredominantlyChinese,
  mergeInstalledSkillAssignments,
  validateActivationKeywords,
  type LocalSkillCandidate,
  type LocalSkillInstallResult,
  type LocalSkillPreview,
  type SkillGroupScope,
  type SkillSummary,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { installSkillTree } from "./skillGitHubInstall.js";
import {
  loadSkillGroupsDocument,
  readSkillGroupsDocument,
  resolveSkillGroupsFile,
  withSkillGroupsFileLock,
  writeSkillGroupsDocument,
} from "./skillGroupStore.js";
import { adaptSkillMarkdown } from "./skillMarkdownAdapt.js";
import {
  translateSkillDescriptionBatch,
  writeSkillDescriptionZh,
} from "./skillDescriptionTranslate.js";
import { walkSkillMarkdownPaths } from "./skillDiscoveryWalk.js";

const logger = createServiceLogger("skills.local-import");

/** 扫描用户选出的文件夹，列出其中每个带 SKILL.md 的技能目录。 */
export async function previewLocalSkillDirectory(rootPath: string): Promise<LocalSkillPreview> {
  const root = await resolveSkillRoot(rootPath);
  const skills: LocalSkillCandidate[] = [];
  const seen = new Set<string>();
  for await (const skillFile of walkSkillMarkdownPaths(root)) {
    const directory = await realpath(dirname(skillFile)).catch(() => resolve(dirname(skillFile)));
    if (!isInside(root, directory) || seen.has(directory)) continue;
    seen.add(directory);
    let adapted;
    try {
      adapted = adaptSkillMarkdown(await readFile(skillFile, "utf8"), basename(directory));
    } catch {
      continue;
    }
    skills.push({
      directory,
      name: adapted.name,
      description: adapted.description,
    });
  }
  skills.sort((left, right) => left.name.localeCompare(right.name));
  return { rootPath: root, skills };
}

/** 把勾选目录收成真实路径，并确认它们都在本次选择的根目录里。 */
export async function resolveSelectedSkillDirectories(
  rootPath: string,
  directories: readonly string[],
): Promise<{ root: string; selected: Set<string> }> {
  if (directories.length === 0) {
    throw new Error("skill-install:none-selected");
  }
  const root = await resolveSkillRoot(rootPath);
  const selected = new Set<string>();
  for (const directory of directories) {
    const trimmed = directory.trim();
    if (!trimmed || !isAbsolute(trimmed)) {
      throw new Error("skill-install:outside-root");
    }
    let canonical: string;
    try {
      canonical = await realpath(trimmed);
    } catch {
      throw new Error("skill-install:outside-root");
    }
    if (!isInside(root, canonical)) {
      throw new Error("skill-install:outside-root");
    }
    selected.add(canonical);
  }
  return { root, selected };
}

async function resolveSkillRoot(rootPath: string): Promise<string> {
  const trimmed = rootPath.trim();
  if (!trimmed || !isAbsolute(trimmed)) {
    throw new Error("skill-install:not-a-directory");
  }
  let root: string;
  try {
    root = await realpath(trimmed);
  } catch {
    throw new Error("skill-install:not-a-directory");
  }
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error("skill-install:not-a-directory");
  }
  return root;
}

export async function installSelectedLocalSkills(
  params: {
    workspacePath: string;
    workspaceIdentity?: string;
    scope: SkillGroupScope;
    userHomeDir?: string;
    rootPath: string;
    directories: readonly string[];
    groupId: string;
    activationKeywords?: readonly string[];
  },
  resolveUserHomeDir: () => string = defaultUserHomeDir,
): Promise<LocalSkillInstallResult> {
  const { root, selected } = await resolveSelectedSkillDirectories(
    params.rootPath,
    params.directories,
  );
  const userHomeDir = params.userHomeDir ?? resolveUserHomeDir();
  const groupsFilePath = resolveSkillGroupsFile({
    scope: params.scope,
    workspacePath: params.workspacePath,
    userHomeDir,
  });
  const groups = await readSkillGroupsDocument(groupsFilePath, params.scope);
  const group = params.groupId ? groups.groups.find((item) => item.id === params.groupId) : undefined;
  if (params.groupId && !group) {
    throw new Error("skill-install:missing-group");
  }
  let activationKeywords = params.activationKeywords;
  if (activationKeywords !== undefined) {
    const parsed = validateActivationKeywords(activationKeywords);
    if (!parsed.ok) {
      throw new Error(`skill-install:activation-keywords-${parsed.code}`);
    }
    activationKeywords = parsed.keywords;
  }
  const groupName = group?.name ?? "未分组";
  const targetRoot =
    params.scope === "workspace"
      ? join(params.workspacePath, ".zcode", "skills")
      : join(userHomeDir, ".zcode", "skills");
  logger.info(undefined, "installing skills from a local directory", {
    count: selected.size,
    scope: params.scope,
    workspaceIdentity: params.workspaceIdentity?.trim() || params.workspacePath,
  });
  const result = await installSkillTree({
    extractedRoot: root,
    targetRoot,
    scope: params.scope,
    groupId: group?.id ?? "",
    groupName,
    groups,
    selectedDirectories: selected,
    ...(activationKeywords !== undefined ? { activationKeywords } : {}),
  });
  if (group) {
    await withSkillGroupsFileLock(groupsFilePath, async () => {
      const loaded = await loadSkillGroupsDocument(groupsFilePath, params.scope);
      if (!loaded.persistable) {
        throw new Error("skill-groups:invalid-file");
      }
      const merged = mergeInstalledSkillAssignments({
        document: loaded.document,
        scope: params.scope,
        groupId: group.id,
        skillNames: result.installed.map((skill) => skill.name),
      });
      if (merged !== loaded.document) {
        await writeSkillGroupsDocument(groupsFilePath, merged);
      }
    });
  }
  await translateInstalledDescriptions({
    installed: result.installed,
    targetRoot,
    scope: params.scope,
    workspacePath: params.workspacePath,
    userHomeDir,
  });
  return {
    installed: result.installed.map((skill) => skill.name),
    skipped: result.skipped,
    groupId: group?.id ?? "",
  };
}

async function translateInstalledDescriptions(input: {
  installed: Array<{ name: string; directoryName: string; descriptionZh: string }>;
  targetRoot: string;
  scope: SkillGroupScope;
  workspacePath: string;
  userHomeDir: string;
}): Promise<void> {
  const skills: SkillSummary[] = [];
  const assignmentScope = input.scope === "workspace" ? "workspace" : "user";
  for (const installed of input.installed) {
    const skillPath = join(input.targetRoot, installed.directoryName, "SKILL.md");
    const raw = await readFile(skillPath, "utf8").catch(() => "");
    const match = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(raw);
    const descriptionLine = match ? /^description:\s*(.*)$/m.exec(match[1] ?? "") : null;
    const description = (descriptionLine?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
    if (!description || isPredominantlyChinese(description)) continue;
    skills.push({
      id: skillPath,
      name: installed.name,
      description,
      body: "",
      path: skillPath,
      scope: assignmentScope,
      enabled: true,
      metadata: { descriptionZh: installed.descriptionZh },
    });
  }
  if (skills.length === 0) return;
  await translateSkillDescriptionBatch({
    skills,
    persistDescriptionZh: (skill, descriptionZh) =>
      writeSkillDescriptionZh({
        skill,
        descriptionZh,
        workspacePath: input.workspacePath,
        userHomeDir: input.userHomeDir,
      }),
  });
}

function defaultUserHomeDir(): string {
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
}
