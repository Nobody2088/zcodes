import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  createEmptySkillGroupsDocument,
  createSeededUserSkillGroupsDocument,
  type SkillGroupScope,
  type SkillGroupsDocument,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";

const logger = createServiceLogger("skills.groups");

const fileLocks = new Map<string, Promise<unknown>>();

export interface LoadedSkillGroups {
  document: SkillGroupsDocument;
  /** 文件损坏时为 false。调用方不得把空文档写回原路径。 */
  persistable: boolean;
}

export function resolveSkillGroupsFile(input: {
  scope: SkillGroupScope;
  workspacePath: string;
  userHomeDir?: string;
}): string {
  if (input.scope === "workspace") {
    return join(input.workspacePath, ".zcode", "skill-groups.json");
  }
  return join(input.userHomeDir ?? resolveUserHomeDir(), ".zcode", "cli", "skill-groups.json");
}

export function withSkillGroupsFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = fileLocks.get(filePath) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  fileLocks.set(
    filePath,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export async function loadSkillGroupsDocument(
  filePath: string,
  scope: SkillGroupScope,
): Promise<LoadedSkillGroups> {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (raw === null) {
    if (scope === "user") {
      const seeded = createSeededUserSkillGroupsDocument();
      await writeSkillGroupsDocument(filePath, seeded);
      return { document: seeded, persistable: true };
    }
    return { document: createEmptySkillGroupsDocument(), persistable: true };
  }
  const parsed = parseSkillGroupsDocument(raw);
  if (!parsed) {
    logger.warn(undefined, "skill groups file is invalid", { filePath });
    return { document: createEmptySkillGroupsDocument(), persistable: false };
  }
  return { document: parsed, persistable: true };
}

export async function readSkillGroupsDocument(
  filePath: string,
  scope: SkillGroupScope,
): Promise<SkillGroupsDocument> {
  return withSkillGroupsFileLock(filePath, async () => {
    const loaded = await loadSkillGroupsDocument(filePath, scope);
    return loaded.document;
  });
}

export async function writeSkillGroupsDocument(
  filePath: string,
  document: SkillGroupsDocument,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function parseSkillGroupsDocument(raw: string): SkillGroupsDocument | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.groups) || !Array.isArray(record.assignments)) return null;
    const groups = record.groups.flatMap((group) => {
      if (typeof group !== "object" || group === null) return [];
      const item = group as Record<string, unknown>;
      if (typeof item.id !== "string" || typeof item.name !== "string" || !item.name.trim()) {
        return [];
      }
      return [{ id: item.id, name: item.name.trim() }];
    });
    if (groups.length !== record.groups.length) return null;
    const groupIds = new Set(groups.map((group) => group.id));
    const assignments = record.assignments.flatMap((assignment) => {
      if (typeof assignment !== "object" || assignment === null) return [];
      const item = assignment as Record<string, unknown>;
      if (typeof item.skillKey !== "string" || typeof item.groupId !== "string") return [];
      if (!groupIds.has(item.groupId)) return [];
      return [{ skillKey: item.skillKey, groupId: item.groupId }];
    });
    const descriptionZhBySkillKey = readDescriptionZhBySkillKey(record.descriptionZhBySkillKey);
    return {
      groups,
      assignments,
      initialized: true,
      ...(descriptionZhBySkillKey ? { descriptionZhBySkillKey } : {}),
    };
  } catch {
    return null;
  }
}

function readDescriptionZhBySkillKey(
  value: unknown,
): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== "string" || !key.trim()) continue;
    if (typeof entry !== "string" || !entry.trim()) continue;
    result[key.trim()] = entry.trim();
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function resolveUserHomeDir(): string {
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}
