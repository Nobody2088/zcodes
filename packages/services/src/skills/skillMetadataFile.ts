import type { SkillInstallSource, SkillMetadata } from "@zcode/shared";
import { parseActivationKeywordsList } from "@zcode/shared";

export function readSkillMetadataRecord(value: unknown): SkillMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const metadata: SkillMetadata = {};
  if (isNonEmptyString(value.slug)) metadata.slug = value.slug.trim();
  if (isNonEmptyString(value.version)) metadata.version = value.version.trim();
  if (isNonEmptyString(value.ownerId)) metadata.ownerId = value.ownerId.trim();
  if (typeof value.publishedAt === "number" && Number.isFinite(value.publishedAt)) {
    metadata.publishedAt = value.publishedAt;
  }
  if (isNonEmptyString(value.descriptionZh)) metadata.descriptionZh = value.descriptionZh.trim();
  const activationKeywords = parseActivationKeywordsList(value.activationKeywords);
  if (activationKeywords.length > 0) metadata.activationKeywords = activationKeywords;
  const source = readInstallSource(value.source);
  if (source) metadata.source = source;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function skillMetadataToRecord(metadata: SkillMetadata): Record<string, unknown> {
  return {
    ...(metadata.slug ? { slug: metadata.slug } : {}),
    ...(metadata.version ? { version: metadata.version } : {}),
    ...(metadata.ownerId ? { ownerId: metadata.ownerId } : {}),
    ...(metadata.publishedAt !== undefined ? { publishedAt: metadata.publishedAt } : {}),
    ...(metadata.descriptionZh ? { descriptionZh: metadata.descriptionZh } : {}),
    ...(metadata.activationKeywords && metadata.activationKeywords.length > 0
      ? { activationKeywords: metadata.activationKeywords }
      : {}),
    ...(metadata.source ? { source: metadata.source } : {}),
  };
}

function readInstallSource(value: unknown): SkillInstallSource | undefined {
  if (!isRecord(value) || value.provider !== "github") {
    return undefined;
  }
  if (
    !isNonEmptyString(value.owner) ||
    !isNonEmptyString(value.repo) ||
    !isNonEmptyString(value.url) ||
    !isNonEmptyString(value.commit)
  ) {
    return undefined;
  }
  return {
    provider: "github",
    owner: value.owner.trim(),
    repo: value.repo.trim(),
    url: value.url.trim(),
    commit: value.commit.trim(),
    ...(isNonEmptyString(value.groupId) ? { groupId: value.groupId.trim() } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
