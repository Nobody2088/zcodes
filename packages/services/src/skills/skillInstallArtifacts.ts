import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillInstallSource, SkillMetadata } from "@zcode/shared";
import { adaptSkillMarkdown } from "./skillMarkdownAdapt.js";
import { skillMetadataToRecord } from "./skillMetadataFile.js";

/** 写入安装暂存目录中的 _meta.json 与 SKILL.md（含激活关键词双写）。 */
export async function writeInstalledSkillArtifacts(input: {
  stagingDir: string;
  adaptedMarkdown: string;
  adaptedName: string;
  descriptionZh: string;
  previous: SkillMetadata | undefined;
  source: SkillInstallSource;
  activationKeywords: readonly string[];
  activationKeywordsProvided: boolean;
}): Promise<void> {
  const { activationKeywords: _previousKeywords, ...previousRest } = input.previous ?? {};
  await writeFile(
    join(input.stagingDir, "_meta.json"),
    `${JSON.stringify(
      skillMetadataToRecord({
        ...previousRest,
        descriptionZh: input.descriptionZh,
        ...(input.activationKeywords.length > 0
          ? { activationKeywords: [...input.activationKeywords] }
          : {}),
        source: input.source,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
  // 更新且未提交新关键词时，仍要把已有关键词写回 frontmatter，供 CLI 读取。
  const markdownForDisk = input.activationKeywordsProvided
    ? input.adaptedMarkdown
    : adaptSkillMarkdown(
        input.adaptedMarkdown,
        input.adaptedName,
        input.activationKeywords.length > 0
          ? { activationKeywords: input.activationKeywords }
          : undefined,
      ).markdown;
  await writeFile(join(input.stagingDir, "SKILL.md"), markdownForDisk, "utf8");
}
