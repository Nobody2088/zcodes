/**
 * 技能激活关键词：安装解析、名称派生与自动调用计分。
 *
 * 硬限制（产品定稿）：最多 20 个用户关键词，每个 1–32 字符。
 * 超限拒绝整次安装，不静默截断。
 */

export const SKILL_ACTIVATION_KEYWORD_MAX_COUNT = 20;
export const SKILL_ACTIVATION_KEYWORD_MAX_LENGTH = 32;
export const SKILL_ACTIVATION_KEYWORD_MIN_LENGTH = 1;

const KEYWORD_SPLIT_PATTERN = /[\s,，]+/u;
const CJK_PATTERN = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/u;

export type ParseActivationKeywordsResult =
  | { ok: true; keywords: string[] }
  | { ok: false; code: "too-many" | "too-long" | "too-short"; keywords: string[] };

export interface SkillActivationCandidate {
  name: string;
  /** 安装时写入的用户/包级关键词（不含名称派生）。 */
  activationKeywords?: readonly string[];
}

export interface SkillActivationMatch {
  skillName: string;
  score: { longest: number; hits: number };
  matchedKeywords: string[];
}

/**
 * 解析用户输入的激活关键词。空白 / `,` / `，` 切分，trim，去空，大小写不敏感去重。
 * 超出数量或长度限制时返回 ok:false，调用方应拒绝安装。
 */
export function parseActivationKeywordsInput(raw: string | undefined | null): ParseActivationKeywordsResult {
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    return { ok: true, keywords: [] };
  }

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of raw.split(KEYWORD_SPLIT_PATTERN)) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length < SKILL_ACTIVATION_KEYWORD_MIN_LENGTH) {
      return { ok: false, code: "too-short", keywords };
    }
    if (trimmed.length > SKILL_ACTIVATION_KEYWORD_MAX_LENGTH) {
      return { ok: false, code: "too-long", keywords };
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(trimmed);
  }

  if (keywords.length > SKILL_ACTIVATION_KEYWORD_MAX_COUNT) {
    return { ok: false, code: "too-many", keywords };
  }

  return { ok: true, keywords };
}

/** 校验已切好的关键词数组（例如来自 API 的 string[]）。 */
export function validateActivationKeywords(
  keywords: readonly string[],
): ParseActivationKeywordsResult {
  return parseActivationKeywordsInput(keywords.join(" "));
}

/**
 * 从技能名派生关键词：按 `-` / `_` 拆分，丢弃空段，大小写不敏感去重。
 * 派生词不受用户 20 个上限约束；单段仍截到展示可用长度外则保留原段（匹配用完整段）。
 */
export function deriveSkillNameKeywords(skillName: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of skillName.split(/[-_]+/u)) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(trimmed);
  }
  return keywords;
}

/** frontmatter 标量：空格分隔（读取端也接受逗号）。 */
export function formatActivationKeywordsForFrontmatter(keywords: readonly string[]): string {
  return keywords.join(" ");
}

export function parseActivationKeywordsList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const parsed = parseActivationKeywordsInput(
      value.filter((item): item is string => typeof item === "string").join(" "),
    );
    return parsed.ok ? parsed.keywords : [];
  }
  if (typeof value === "string") {
    const parsed = parseActivationKeywordsInput(value);
    return parsed.ok ? parsed.keywords : [];
  }
  return [];
}

function messageContainsKeyword(message: string, keyword: string): boolean {
  const haystack = message.toLowerCase();
  const needle = keyword.toLowerCase();
  if (needle.length === 0) return false;
  if (CJK_PATTERN.test(keyword)) {
    return haystack.includes(needle);
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(message);
}

function collectMatchedKeywords(message: string, keywords: readonly string[]): string[] {
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    if (!messageContainsKeyword(message, keyword)) continue;
    seen.add(key);
    matched.push(keyword);
  }
  return matched;
}

function scoreMatches(matched: readonly string[]): { longest: number; hits: number } {
  let longest = 0;
  for (const keyword of matched) {
    if (keyword.length > longest) longest = keyword.length;
  }
  return { longest, hits: matched.length };
}

function compareScores(
  left: { longest: number; hits: number },
  right: { longest: number; hits: number },
): number {
  if (left.longest !== right.longest) return left.longest - right.longest;
  return left.hits - right.hits;
}

function keywordSet(keywords: readonly string[]): Set<string> {
  return new Set(keywords.map((keyword) => keyword.toLowerCase()));
}

function universalKeywords(skillKeywordSets: readonly Set<string>[]): Set<string> {
  if (skillKeywordSets.length < 2) return new Set();
  const [first, ...rest] = skillKeywordSets;
  if (!first) return new Set();
  const shared = new Set<string>();
  for (const keyword of first) {
    if (rest.every((set) => set.has(keyword))) {
      shared.add(keyword);
    }
  }
  return shared;
}

/**
 * 在用户消息中为已启用技能选出唯一自动调用胜者。
 * 无唯一胜者时返回 null（不强制 Skill 工具）。
 */
export function selectSkillActivationMatch(
  message: string,
  skills: readonly SkillActivationCandidate[],
): SkillActivationMatch | null {
  if (message.trim().length === 0 || skills.length === 0) return null;

  const enriched = skills.map((skill) => {
    const nameKeywords = deriveSkillNameKeywords(skill.name);
    const userKeywords = [...(skill.activationKeywords ?? [])];
    const allKeywords = (() => {
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const keyword of [...userKeywords, ...nameKeywords]) {
        const key = keyword.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(keyword);
      }
      return merged;
    })();
    return { skill, nameKeywords, allKeywords, allSet: keywordSet(allKeywords) };
  });

  const shared = universalKeywords(enriched.map((item) => item.allSet));

  const distinctiveCandidates: SkillActivationMatch[] = [];
  for (const item of enriched) {
    const matched = collectMatchedKeywords(message, item.allKeywords);
    if (matched.length === 0) continue;
    const distinctive = matched.filter((keyword) => !shared.has(keyword.toLowerCase()));
    if (distinctive.length === 0) continue;
    distinctiveCandidates.push({
      skillName: item.skill.name,
      score: scoreMatches(distinctive),
      matchedKeywords: distinctive,
    });
  }

  const distinctiveWinner = uniqueHighest(distinctiveCandidates);
  if (distinctiveWinner) return distinctiveWinner;

  const nameDerivedCandidates: SkillActivationMatch[] = [];
  for (const item of enriched) {
    const matched = collectMatchedKeywords(message, item.nameKeywords);
    if (matched.length === 0) continue;
    nameDerivedCandidates.push({
      skillName: item.skill.name,
      score: scoreMatches(matched),
      matchedKeywords: matched,
    });
  }

  return uniqueHighest(nameDerivedCandidates);
}

function uniqueHighest(candidates: readonly SkillActivationMatch[]): SkillActivationMatch | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let tied = false;
  for (let index = 1; index < candidates.length; index += 1) {
    const current = candidates[index]!;
    const cmp = compareScores(current.score, best.score);
    if (cmp > 0) {
      best = current;
      tied = false;
    } else if (cmp === 0) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/**
 * 与 `/skill` 强制路径相同的提示契约：先调 Skill 工具，再执行用户请求。
 */
export function buildForcedSkillToolPrompt(skillName: string, task: string): string {
  const trimmedTask = task.trim();
  const taskBlock =
    trimmedTask.length > 0
      ? `User request:\n${trimmedTask}`
      : "No additional user request was provided. Load the skill and respond according to its instructions.";

  return [
    `Use the skill named \`${skillName}\` for this turn.`,
    `First call the \`Skill\` tool with name \`${skillName}\` before doing the task.`,
    "After the skill content is loaded, follow its instructions and continue.",
    "",
    taskBlock,
  ].join("\n");
}
