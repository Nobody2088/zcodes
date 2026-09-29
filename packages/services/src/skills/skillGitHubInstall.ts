import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  applySkillGroupMutation,
  buildSkillDescriptionZh,
  SKILL_FILE_NAME,
  shouldWalkSkillDirectoryEntry,
  skillGroupAssignmentKey,
  skillInstallDirectoryName,
  type GitHubRepositoryRef,
  type SkillGroupScope,
  type SkillGroupsDocument,
  type SkillInstallSource,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { adaptSkillMarkdown } from "./skillMarkdownAdapt.js";
import { readSkillMetadataRecord } from "./skillMetadataFile.js";
import { writeInstalledSkillArtifacts } from "./skillInstallArtifacts.js";

const execFileAsync = promisify(execFile);
const logger = createServiceLogger("skills.install");
const INSTALLER_USER_AGENT = "zcode-skill-installer";
const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;
const MAX_SCAN_DEPTH = 8;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const COMMIT_TIMEOUT_MS = 30_000;

export interface InstalledSkillRecord {
  name: string;
  directoryName: string;
  descriptionZh: string;
}

export interface InstalledRepositorySource {
  owner: string;
  repo: string;
  url: string;
  groupId?: string;
  commits: string[];
}

export interface SkillTreeInstallResult {
  installed: InstalledSkillRecord[];
  skipped: Array<{ name: string; reason: string }>;
  assignments: SkillGroupsDocument;
}

export async function fetchGitHubCommit(repository: GitHubRepositoryRef): Promise<string> {
  const ref = repository.ref ?? "HEAD";
  const response = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/commits/${encodeURIComponent(ref)}`,
    { headers: githubHeaders(), signal: AbortSignal.timeout(COMMIT_TIMEOUT_MS) },
  );
  if (!response.ok) {
    throw new Error(`skill-install:commit-${response.status}`);
  }
  const payload = (await response.json()) as { sha?: unknown };
  if (typeof payload.sha !== "string" || payload.sha.length === 0) {
    throw new Error("skill-install:commit-missing");
  }
  return payload.sha;
}

export async function downloadGitHubTarGz(
  repository: GitHubRepositoryRef,
  commit: string,
): Promise<string> {
  const destination = await mkdtemp(join(tmpdir(), "zcode-skill-archive-"));
  const archivePath = join(destination, "source.tar.gz");
  try {
    const response = await fetch(
      `https://codeload.github.com/${repository.owner}/${repository.repo}/tar.gz/${commit}`,
      {
        headers: { "User-Agent": INSTALLER_USER_AGENT },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      },
    );
    if (!response.ok || !response.body) {
      throw new Error(`skill-install:download-${response.status}`);
    }
    const bytes = await readBoundedBody(response);
    await writeFile(archivePath, bytes);
    return archivePath;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export async function extractTarGz(archivePath: string): Promise<string> {
  const destination = await mkdtemp(join(tmpdir(), "zcode-skill-extract-"));
  try {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destination], { windowsHide: true });
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    logger.error(undefined, "failed to extract skill archive", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw new Error("skill-install:extract-failed");
  }
  return destination;
}

export async function installSkillTree(input: {
  extractedRoot: string;
  targetRoot: string;
  scope: SkillGroupScope;
  groupId: string;
  groupName: string;
  source: SkillInstallSource;
  groups: SkillGroupsDocument;
  activationKeywords?: readonly string[];
}): Promise<SkillTreeInstallResult> {
  const skillFiles = await collectSkillFiles(input.extractedRoot);
  const installed: InstalledSkillRecord[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const usedDirectories = new Set<string>();
  let groups = input.groups;

  for (const skillFile of skillFiles) {
    const sourceDir = dirname(skillFile);
    const fallbackName =
      sourceDir === input.extractedRoot ? input.source.repo : relativeName(sourceDir);
    let adapted;
    try {
      adapted = adaptSkillMarkdown(
        await readFile(skillFile, "utf8"),
        fallbackName,
        input.activationKeywords !== undefined
          ? { activationKeywords: input.activationKeywords }
          : undefined,
      );
    } catch {
      skipped.push({ name: fallbackName, reason: "invalid-skill" });
      continue;
    }
    const directoryName = uniqueDirectoryName(
      skillInstallDirectoryName(adapted.name),
      usedDirectories,
    );
    const targetDir = resolve(input.targetRoot, directoryName);
    if (!isInside(input.targetRoot, targetDir)) {
      skipped.push({ name: adapted.name, reason: "invalid-path" });
      continue;
    }
    const previous = await readMetadata(targetDir);
    const existingSkill = await isFile(join(targetDir, SKILL_FILE_NAME));
    if (
      existingSkill &&
      (!previous?.source || sourceKey(previous.source) !== sourceKey(input.source))
    ) {
      skipped.push({ name: adapted.name, reason: "name-taken" });
      continue;
    }
    const descriptionZh = buildSkillDescriptionZh({
      name: adapted.name,
      description: adapted.description,
      groupName: input.groupName,
    });
    const activationKeywords =
      input.activationKeywords !== undefined
        ? [...input.activationKeywords]
        : (previous?.activationKeywords ?? []);
    try {
      await replaceDirectory(targetDir, async (stagingDir) => {
        await copySkillDirectory(sourceDir, stagingDir, input.extractedRoot);
        await writeInstalledSkillArtifacts({
          stagingDir,
          adaptedMarkdown: adapted.markdown,
          adaptedName: adapted.name,
          descriptionZh,
          previous,
          source: input.source,
          activationKeywords,
          activationKeywordsProvided: input.activationKeywords !== undefined,
        });
      });
      usedDirectories.add(directoryName);
      const skillKey = skillGroupAssignmentKey(
        input.scope === "workspace" ? "workspace" : "user",
        adapted.name,
      );
      const alreadyAssigned = groups.assignments.some(
        (assignment) => assignment.skillKey === skillKey,
      );
      if (!alreadyAssigned && groups.groups.some((group) => group.id === input.groupId)) {
        groups = applySkillGroupMutation(groups, {
          type: "assign",
          skillKey,
          groupId: input.groupId,
        });
      }
      installed.push({ name: adapted.name, directoryName, descriptionZh });
    } catch (error) {
      logger.warn(undefined, "skipped skill install", {
        name: adapted.name,
        message: error instanceof Error ? error.message : String(error),
      });
      skipped.push({ name: adapted.name, reason: "copy-failed" });
    }
  }

  return { installed, skipped, assignments: groups };
}

export async function listInstalledSources(
  targetRoot: string,
): Promise<InstalledRepositorySource[]> {
  const sources = new Map<string, InstalledRepositorySource>();
  const skillFiles = await collectSkillFiles(targetRoot).catch(() => []);
  for (const skillFile of skillFiles) {
    const source = await readExistingSource(dirname(skillFile));
    if (!source) continue;
    const key = sourceKey(source);
    const current = sources.get(key);
    if (!current) {
      sources.set(key, {
        owner: source.owner,
        repo: source.repo,
        url: source.url,
        ...(source.groupId ? { groupId: source.groupId } : {}),
        commits: [source.commit],
      });
      continue;
    }
    if (!current.commits.includes(source.commit)) {
      current.commits.push(source.commit);
    }
  }
  return [...sources.values()];
}

export async function replaceDirectory(
  targetDir: string,
  populate: (stagingDir: string) => Promise<void>,
): Promise<void> {
  const parent = dirname(targetDir);
  const stagingDir = join(parent, `.${basename(targetDir)}.installing`);
  const backupDir = join(parent, `.${basename(targetDir)}.backup`);
  await mkdir(parent, { recursive: true });
  await rm(stagingDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
  try {
    await populate(stagingDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
  let movedOriginal = false;
  try {
    if (await pathExists(targetDir)) {
      await rename(targetDir, backupDir);
      movedOriginal = true;
    }
    await rename(stagingDir, targetDir);
  } catch (error) {
    if (movedOriginal) {
      await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
      await rename(backupDir, targetDir).catch(() => undefined);
    }
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  await rm(backupDir, { recursive: true, force: true });
}

async function collectSkillFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  await walk(root, 0, found);
  return found.sort((left, right) => right.split(sep).length - left.split(sep).length);
}

async function walk(directory: string, depth: number, found: string[]): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) return;
  const skillFile = join(directory, SKILL_FILE_NAME);
  if (await isFile(skillFile)) found.push(skillFile);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (!shouldWalkSkillDirectoryEntry(entry.name)) continue;
    await walk(join(directory, entry.name), depth + 1, found);
  }
}

async function copySkillDirectory(
  sourceDir: string,
  targetDir: string,
  extractedRoot: string,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === "_meta.json") continue;
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (!isInside(extractedRoot, sourcePath) || !isInside(dirname(targetDir), targetPath)) continue;
    if (entry.isDirectory()) {
      if (await isFile(join(sourcePath, SKILL_FILE_NAME))) continue;
      if (!shouldWalkSkillDirectoryEntry(entry.name)) continue;
      await copySkillDirectory(sourcePath, targetPath, extractedRoot);
      continue;
    }
    if (!entry.isFile() || entry.name === SKILL_FILE_NAME) continue;
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await readFile(sourcePath));
  }
}

async function readExistingSource(targetDir: string): Promise<SkillInstallSource | undefined> {
  return (await readMetadata(targetDir))?.source;
}

async function readMetadata(targetDir: string) {
  const raw = await readFile(join(targetDir, "_meta.json"), "utf8").catch(() => null);
  if (!raw) return undefined;
  try {
    return readSkillMetadataRecord(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
    throw new Error("skill-install:archive-too-large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("skill-install:download-empty");
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    received += next.value.byteLength;
    if (received > MAX_ARCHIVE_BYTES) {
      throw new Error("skill-install:archive-too-large");
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function uniqueDirectoryName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  let index = 2;
  while (used.has(`${name}-${index}`)) index += 1;
  return `${name}-${index}`;
}

function relativeName(directory: string): string {
  return directory.split(sep).filter(Boolean).at(-1) || "skill";
}

function sourceKey(source: SkillInstallSource): string {
  return `${source.owner}/${source.repo}`;
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
}

async function isFile(path: string): Promise<boolean> {
  const stat = await lstat(path).catch(() => null);
  return Boolean(stat?.isFile());
}

async function pathExists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

function githubHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": INSTALLER_USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
