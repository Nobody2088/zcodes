import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { formatActivationKeywordsForFrontmatter } from "@zcode/shared";

export interface AdaptedSkillMarkdown {
  markdown: string;
  name: string;
  description: string;
}

const SAFE_KEYS = [
  "name",
  "description",
  "when_to_use",
  "license",
  "metadata",
  "activation_keywords",
] as const;

export function adaptSkillMarkdown(
  raw: string,
  fallbackName: string,
  options?: { activationKeywords?: readonly string[] },
): AdaptedSkillMarkdown {
  const normalized = raw.replace(/\r\n|\r/g, "\n");
  const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  const parsed = frontmatterMatch ? parseFrontmatter(frontmatterMatch[1] ?? "") : {};
  const body = frontmatterMatch
    ? normalized.slice(frontmatterMatch[0].length).trim()
    : normalized.trim();
  const name = readString(parsed.name) || fallbackName;
  const description = readString(parsed.description) || name;
  const next: Record<string, unknown> = { name, description };
  for (const key of SAFE_KEYS) {
    if (key === "name" || key === "description" || key === "activation_keywords") continue;
    if (parsed[key] !== undefined) next[key] = parsed[key];
  }
  const keywords = options?.activationKeywords;
  if (keywords !== undefined) {
    if (keywords.length > 0) {
      next.activation_keywords = formatActivationKeywordsForFrontmatter(keywords);
    }
  } else if (typeof parsed.activation_keywords === "string" && parsed.activation_keywords.trim()) {
    next.activation_keywords = parsed.activation_keywords.trim();
  }
  const frontmatter = stringifyYaml(next).trim();
  return {
    name,
    description,
    markdown: `---\n${frontmatter}\n---\n${body ? `\n${body}\n` : ""}`,
  };
}

function parseFrontmatter(text: string): Record<string, unknown> {
  try {
    const parsed = parseYaml(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
