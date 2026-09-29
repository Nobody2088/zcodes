import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  isPredominantlyChinese,
  projectSkillGroupSections,
  skillGroupAssignmentKey,
  UNGROUPED_SKILL_GROUP_ID,
  type SkillGroupScope,
  type SkillGroupsDocument,
  type SkillSummary,
  type SkillTranslateDescriptionsResult,
  type SkillTranslateTarget,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { readSkillMetadataRecord, skillMetadataToRecord } from "./skillMetadataFile.js";
import {
  loadSkillGroupsDocument,
  resolveSkillGroupsFile,
  withSkillGroupsFileLock,
  writeSkillGroupsDocument,
} from "./skillGroupStore.js";

const logger = createServiceLogger("skills.translate");
const TRANSLATE_ENDPOINT =
  "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=";
const TRANSLATE_TIMEOUT_MS = 15_000;
const MAX_CONCURRENCY = 3;
const SKILL_META_FILE_NAME = "_meta.json";

export type TranslateFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export function parseGoogleTranslateResponse(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    return "";
  }
  const segments: string[] = [];
  for (const segment of payload[0]) {
    if (Array.isArray(segment) && typeof segment[0] === "string") {
      segments.push(segment[0]);
    }
  }
  return segments.join("").trim();
}

export async function translateTextToZhCN(
  text: string,
  fetchImpl: TranslateFetch = fetch,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("skill-translate:empty-source");
  }
  const response = await fetchImpl(`${TRANSLATE_ENDPOINT}${encodeURIComponent(trimmed)}`, {
    signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`skill-translate:http-${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  const translated = parseGoogleTranslateResponse(payload);
  if (!translated) {
    throw new Error("skill-translate:empty-result");
  }
  return translated;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

export type SkillDescriptionOutcome = "translated" | "skipped" | "failed";

export async function translateSkillDescriptionBatch(input: {
  skills: readonly SkillSummary[];
  persistDescriptionZh: (skill: SkillSummary, descriptionZh: string) => Promise<void>;
  fetchImpl?: TranslateFetch;
  concurrency?: number;
}): Promise<SkillTranslateDescriptionsResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const outcomes = await mapWithConcurrency(
    input.skills,
    input.concurrency ?? MAX_CONCURRENCY,
    async (skill): Promise<SkillDescriptionOutcome> => {
      const description = skill.description.trim();
      if (!description) {
        return "failed";
      }
      if (isPredominantlyChinese(description)) {
        try {
          if (skill.metadata?.descriptionZh?.trim() !== description) {
            await input.persistDescriptionZh(skill, description);
          }
          return "skipped";
        } catch (error) {
          logger.warn(undefined, "failed to persist chinese skill description", {
            skillName: skill.name,
            message: error instanceof Error ? error.message : String(error),
          });
          return "failed";
        }
      }
      try {
        const translated = await translateTextToZhCN(description, fetchImpl);
        await input.persistDescriptionZh(skill, translated);
        return "translated";
      } catch (error) {
        logger.warn(undefined, "skill description translation failed", {
          skillName: skill.name,
          message: error instanceof Error ? error.message : String(error),
        });
        return "failed";
      }
    },
  );
  return summarizeOutcomes(outcomes);
}

export function summarizeOutcomes(
  outcomes: readonly SkillDescriptionOutcome[],
): SkillTranslateDescriptionsResult {
  let translated = 0;
  let skipped = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome === "translated") translated += 1;
    else if (outcome === "skipped") skipped += 1;
    else failed += 1;
  }
  return { translated, skipped, failed };
}

export function selectSkillsForTranslateTarget(input: {
  skills: readonly SkillSummary[];
  viewScope: SkillGroupScope;
  userDocument: SkillGroupsDocument;
  workspaceDocument: SkillGroupsDocument;
  target: SkillTranslateTarget;
}): SkillSummary[] {
  const sections = projectSkillGroupSections({
    skills: input.skills,
    viewScope: input.viewScope,
    userDocument: input.userDocument,
    workspaceDocument: input.workspaceDocument,
    ungroupedLabel: UNGROUPED_SKILL_GROUP_ID,
  });
  if (input.target.mode === "all") {
    return sections.flatMap((section) => section.skills);
  }
  if (input.target.mode === "group") {
    const groupId = input.target.groupId;
    return sections
      .filter((section) => section.id === groupId)
      .flatMap((section) => section.skills);
  }
  const skillId = input.target.skillId;
  const skill = input.skills.find((item) => item.id === skillId);
  return skill ? [skill] : [];
}

export function mergeDescriptionZhOverlays(
  skills: readonly SkillSummary[],
  overlays: Record<string, string> | undefined,
): SkillSummary[] {
  if (!overlays || Object.keys(overlays).length === 0) {
    return [...skills];
  }
  return skills.map((skill) => {
    const key = skillGroupAssignmentKey(skill.scope, skill.name);
    const overlay = overlays[key]?.trim();
    if (!overlay) {
      return skill;
    }
    const existing = skill.metadata?.descriptionZh?.trim();
    // 可写目录的 _meta.json 优先；仅在缺少 descriptionZh 时套用 overlay。
    if (existing) {
      return skill;
    }
    return {
      ...skill,
      metadata: {
        ...skill.metadata,
        descriptionZh: overlay,
      },
    };
  });
}

export async function writeSkillDescriptionZh(input: {
  skill: SkillSummary;
  descriptionZh: string;
  workspacePath: string;
  userHomeDir: string;
}): Promise<void> {
  const descriptionZh = input.descriptionZh.trim();
  if (!descriptionZh) {
    throw new Error("skill-translate:empty-result");
  }
  if (input.skill.scope === "plugin") {
    await writePluginDescriptionZhOverlay({
      skill: input.skill,
      descriptionZh,
      workspacePath: input.workspacePath,
      userHomeDir: input.userHomeDir,
    });
    return;
  }
  await writeMetaDescriptionZh(input.skill, descriptionZh);
}

async function writeMetaDescriptionZh(skill: SkillSummary, descriptionZh: string): Promise<void> {
  // 已安装但尚无 _meta.json 的技能（仅 SKILL.md）也要能落盘；就地创建文件。
  // 必须合并进现有 JSON，保留 activationKeywords / source 及未知字段，不能整文件重写丢键。
  const metaPath = join(dirname(skill.sourcePath ?? skill.path), SKILL_META_FILE_NAME);
  const previous = await readRawMetadataObject(metaPath);
  const typed = readSkillMetadataRecord(previous) ?? {};
  const next = {
    ...previous,
    ...skillMetadataToRecord({
      ...typed,
      descriptionZh,
    }),
    descriptionZh,
  };
  await writeFile(metaPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function writePluginDescriptionZhOverlay(input: {
  skill: SkillSummary;
  descriptionZh: string;
  workspacePath: string;
  userHomeDir: string;
}): Promise<void> {
  const filePath = resolveSkillGroupsFile({
    scope: "user",
    workspacePath: input.workspacePath,
    userHomeDir: input.userHomeDir,
  });
  const skillKey = skillGroupAssignmentKey(input.skill.scope, input.skill.name);
  await withSkillGroupsFileLock(filePath, async () => {
    const loaded = await loadSkillGroupsDocument(filePath, "user");
    if (!loaded.persistable) {
      throw new Error("skill-groups:invalid-file");
    }
    const next: SkillGroupsDocument = {
      ...loaded.document,
      descriptionZhBySkillKey: {
        ...loaded.document.descriptionZhBySkillKey,
        [skillKey]: input.descriptionZh,
      },
    };
    await writeSkillGroupsDocument(filePath, next);
  });
}

async function readRawMetadataObject(metaPath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(metaPath, "utf8").catch(() => null);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
