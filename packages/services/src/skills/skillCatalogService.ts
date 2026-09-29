import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  applySkillGroupMutation,
  isPredominantlyChinese,
  mergeInstalledSkillAssignments,
  parseGitHubRepositoryUrl,
  skillSourceUpdateAvailable,
  SkillGroupMutationError,
  validateActivationKeywords,
  type SkillGitHubInstallResult,
  type SkillGroupMutation,
  type SkillGroupScope,
  type SkillGroupsDocument,
  type SkillSourceUpdate,
  type SkillSummary,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import {
  downloadGitHubTarGz,
  extractTarGz,
  fetchGitHubCommit,
  installSkillTree,
  listInstalledSources,
} from "./skillGitHubInstall.js";
import {
  loadSkillGroupsDocument,
  readSkillGroupsDocument,
  resolveSkillGroupsFile,
  withSkillGroupsFileLock,
  writeSkillGroupsDocument,
} from "./skillGroupStore.js";
import {
  translateSkillDescriptionBatch,
  writeSkillDescriptionZh,
} from "./skillDescriptionTranslate.js";

const logger = createServiceLogger("skills.catalog");

export interface SkillCatalogContext {
  workspacePath: string;
  workspaceIdentity?: string;
  scope: SkillGroupScope;
  userHomeDir?: string;
}

export function createSkillCatalogApi(resolveUserHomeDir: () => string = defaultUserHomeDir) {
  return {
    listSkillGroups(params: SkillCatalogContext): Promise<SkillGroupsDocument> {
      return readScopedGroups(params, resolveUserHomeDir);
    },
    async mutateSkillGroups(
      params: SkillCatalogContext & { mutation: SkillGroupMutation },
    ): Promise<SkillGroupsDocument> {
      const filePath = groupsFile(params, resolveUserHomeDir);
      return withSkillGroupsFileLock(filePath, async () => {
        const loaded = await loadSkillGroupsDocument(filePath, params.scope);
        if (!loaded.persistable) {
          throw new Error("skill-groups:invalid-file");
        }
        let next: SkillGroupsDocument;
        try {
          next = applySkillGroupMutation(loaded.document, params.mutation);
        } catch (error) {
          if (error instanceof SkillGroupMutationError) {
            throw new Error(`skill-groups:${error.code}`);
          }
          throw error;
        }
        await writeSkillGroupsDocument(filePath, next);
        return next;
      });
    },
    installSkillsFromGitHub(
      params: SkillCatalogContext & {
        url: string;
        groupId: string;
        activationKeywords?: readonly string[];
      },
    ): Promise<SkillGitHubInstallResult> {
      return installFromRepository(params, resolveUserHomeDir);
    },
    checkSkillSourceUpdates(params: SkillCatalogContext): Promise<SkillSourceUpdate[]> {
      return checkUpdates(params, resolveUserHomeDir);
    },
    updateSkillSource(
      params: SkillCatalogContext & { repo: string },
    ): Promise<SkillGitHubInstallResult> {
      return updateRepository(params, resolveUserHomeDir);
    },
  };
}

async function installFromRepository(
  params: SkillCatalogContext & {
    url: string;
    groupId: string;
    activationKeywords?: readonly string[];
  },
  resolveUserHomeDir: () => string,
): Promise<SkillGitHubInstallResult> {
  const repository = parseGitHubRepositoryUrl(params.url);
  if (!repository) {
    throw new Error("skill-install:invalid-url");
  }
  const groupsFilePath = groupsFile(params, resolveUserHomeDir);
  const groups = await readSkillGroupsDocument(groupsFilePath, params.scope);
  const group = groups.groups.find((item) => item.id === params.groupId);
  if (!group) {
    throw new Error("skill-install:missing-group");
  }
  let activationKeywords: readonly string[] | undefined = params.activationKeywords;
  if (activationKeywords !== undefined) {
    const parsed = validateActivationKeywords(activationKeywords);
    if (!parsed.ok) {
      throw new Error(`skill-install:activation-keywords-${parsed.code}`);
    }
    activationKeywords = parsed.keywords;
  }
  const commit = await fetchGitHubCommit(repository);
  return installCommit({
    params,
    resolveUserHomeDir,
    repositoryUrl: repository.url,
    owner: repository.owner,
    repo: repository.repo,
    ref: repository.ref,
    commit,
    groupId: group.id,
    groupName: group.name,
    groups,
    groupsFilePath,
    activationKeywords,
  });
}

async function updateRepository(
  params: SkillCatalogContext & { repo: string },
  resolveUserHomeDir: () => string,
): Promise<SkillGitHubInstallResult> {
  const sources = await listInstalledSources(skillRoot(params, resolveUserHomeDir));
  const source = sources.find((item) => `${item.owner}/${item.repo}` === params.repo);
  if (!source) {
    throw new Error("skill-install:source-not-found");
  }
  const groupsFilePath = groupsFile(params, resolveUserHomeDir);
  const groups = await readSkillGroupsDocument(groupsFilePath, params.scope);
  const group = groups.groups.find((item) => item.id === source.groupId);
  const commit = await fetchGitHubCommit({
    owner: source.owner,
    repo: source.repo,
    url: source.url,
  });
  return installCommit({
    params,
    resolveUserHomeDir,
    repositoryUrl: source.url,
    owner: source.owner,
    repo: source.repo,
    commit,
    groupId: group?.id ?? source.groupId ?? "",
    groupName: group?.name ?? "未分组",
    groups,
    groupsFilePath,
  });
}

async function installCommit(input: {
  params: SkillCatalogContext;
  resolveUserHomeDir: () => string;
  repositoryUrl: string;
  owner: string;
  repo: string;
  ref?: string;
  commit: string;
  groupId: string;
  groupName: string;
  groups: SkillGroupsDocument;
  groupsFilePath: string;
  activationKeywords?: readonly string[];
}): Promise<SkillGitHubInstallResult> {
  logger.info(undefined, "installing skills from github", {
    repo: `${input.owner}/${input.repo}`,
    commit: input.commit,
    scope: input.params.scope,
    workspaceIdentity: input.params.workspaceIdentity?.trim() || input.params.workspacePath,
  });
  const archivePath = await downloadGitHubTarGz(
    { owner: input.owner, repo: input.repo, url: input.repositoryUrl, ref: input.ref },
    input.commit,
  );
  const archiveDir = dirname(archivePath);
  let extractedRoot: string | undefined;
  try {
    extractedRoot = await extractTarGz(archivePath);
    const result = await installSkillTree({
      extractedRoot,
      targetRoot: skillRoot(input.params, input.resolveUserHomeDir),
      scope: input.params.scope,
      groupId: input.groupId,
      groupName: input.groupName,
      groups: input.groups,
      ...(input.activationKeywords !== undefined
        ? { activationKeywords: input.activationKeywords }
        : {}),
      source: {
        provider: "github",
        owner: input.owner,
        repo: input.repo,
        url: input.repositoryUrl,
        commit: input.commit,
        ...(input.groupId ? { groupId: input.groupId } : {}),
      },
    });
    await withSkillGroupsFileLock(input.groupsFilePath, async () => {
      const loaded = await loadSkillGroupsDocument(input.groupsFilePath, input.params.scope);
      if (!loaded.persistable) {
        throw new Error("skill-groups:invalid-file");
      }
      const merged = mergeInstalledSkillAssignments({
        document: loaded.document,
        scope: input.params.scope,
        groupId: input.groupId,
        skillNames: result.installed.map((skill) => skill.name),
      });
      if (merged !== loaded.document) {
        await writeSkillGroupsDocument(input.groupsFilePath, merged);
      }
    });
    await translateNewlyInstalledSkillDescriptions({
      installed: result.installed,
      targetRoot: skillRoot(input.params, input.resolveUserHomeDir),
      scope: input.params.scope,
      workspacePath: input.params.workspacePath,
      userHomeDir: input.params.userHomeDir ?? input.resolveUserHomeDir(),
      groupName: input.groupName,
    });
    return {
      repo: `${input.owner}/${input.repo}`,
      commit: input.commit,
      installed: result.installed.map((skill) => skill.name),
      skipped: result.skipped,
      groupId: input.groupId,
    };
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
    if (extractedRoot) {
      await rm(extractedRoot, { recursive: true, force: true });
    }
  }
}

async function checkUpdates(
  params: SkillCatalogContext,
  resolveUserHomeDir: () => string,
): Promise<SkillSourceUpdate[]> {
  const sources = await listInstalledSources(skillRoot(params, resolveUserHomeDir));
  const updates: SkillSourceUpdate[] = [];
  for (const source of sources) {
    try {
      const remoteCommit = await fetchGitHubCommit({
        owner: source.owner,
        repo: source.repo,
        url: source.url,
      });
      updates.push({
        repo: `${source.owner}/${source.repo}`,
        url: source.url,
        installedCommit: source.commits[0] ?? "",
        remoteCommit,
        updateAvailable: skillSourceUpdateAvailable(source.commits, remoteCommit),
      });
    } catch (error) {
      logger.warn(undefined, "skipped skill source update check", {
        repo: `${source.owner}/${source.repo}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return updates;
}

async function readScopedGroups(
  params: SkillCatalogContext,
  resolveUserHomeDir: () => string,
): Promise<SkillGroupsDocument> {
  return readSkillGroupsDocument(groupsFile(params, resolveUserHomeDir), params.scope);
}

function groupsFile(params: SkillCatalogContext, resolveUserHomeDir: () => string): string {
  return resolveSkillGroupsFile({
    scope: params.scope,
    workspacePath: params.workspacePath,
    userHomeDir: params.userHomeDir ?? resolveUserHomeDir(),
  });
}

function skillRoot(params: SkillCatalogContext, resolveUserHomeDir: () => string): string {
  if (params.scope === "workspace") {
    return join(params.workspacePath, ".zcode", "skills");
  }
  return join(params.userHomeDir ?? resolveUserHomeDir(), ".zcode", "skills");
}

async function translateNewlyInstalledSkillDescriptions(input: {
  installed: Array<{ name: string; directoryName: string; descriptionZh: string }>;
  targetRoot: string;
  scope: SkillGroupScope;
  workspacePath: string;
  userHomeDir: string;
  groupName: string;
}): Promise<void> {
  if (input.installed.length === 0) {
    return;
  }
  const assignmentScope = input.scope === "workspace" ? "workspace" : "user";
  const skills: SkillSummary[] = [];
  for (const installed of input.installed) {
    const skillPath = join(input.targetRoot, installed.directoryName, "SKILL.md");
    const description = await readInstalledSkillDescription(skillPath);
    if (!description.trim()) {
      continue;
    }
    // 只看原文 description：已是中文则跳过；英文（即便有占位 descriptionZh）仍走同一翻译函数。
    if (isPredominantlyChinese(description)) {
      continue;
    }
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
  if (skills.length === 0) {
    return;
  }
  const result = await translateSkillDescriptionBatch({
    skills,
    persistDescriptionZh: (skill, descriptionZh) =>
      writeSkillDescriptionZh({
        skill,
        descriptionZh,
        workspacePath: input.workspacePath,
        userHomeDir: input.userHomeDir,
      }),
  });
  // 翻译失败的条目保留 installSkillTree 写入的占位中文。
  if (result.failed > 0) {
    logger.warn(undefined, "some newly installed skill descriptions failed to translate", {
      failed: result.failed,
      translated: result.translated,
      groupName: input.groupName,
    });
  }
}

async function readInstalledSkillDescription(skillPath: string): Promise<string> {
  const raw = await readFile(skillPath, "utf8").catch(() => "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(raw);
  if (!match) {
    return "";
  }
  const descriptionLine = /^description:\s*(.*)$/m.exec(match[1] ?? "");
  if (!descriptionLine) {
    return "";
  }
  return (descriptionLine[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

function defaultUserHomeDir(): string {
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}
