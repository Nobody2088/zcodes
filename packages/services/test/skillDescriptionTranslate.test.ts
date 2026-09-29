import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isPredominantlyChinese } from "@zcode/shared";
import { createSkillsService } from "../src/skills/skillsService.js";
import {
  mapWithConcurrency,
  parseGoogleTranslateResponse,
  summarizeOutcomes,
  translateSkillDescriptionBatch,
  writeSkillDescriptionZh,
  type TranslateFetch,
} from "../src/skills/skillDescriptionTranslate.js";

describe("skill description translate", () => {
  it("parses nested google translate segments", () => {
    const payload = [
      [
        ["内部下游技能，用于 ctf-sandbox。", "Internal downstream skill for ctf-sandbox.", null, null, 10],
        ["继续第二段。", " Second segment.", null, null, 10],
      ],
      null,
      "en",
    ];
    assert.equal(
      parseGoogleTranslateResponse(payload),
      "内部下游技能，用于 ctf-sandbox。继续第二段。",
    );
  });

  it("treats empty or malformed payloads as empty translation", () => {
    assert.equal(parseGoogleTranslateResponse(null), "");
    assert.equal(parseGoogleTranslateResponse([]), "");
    assert.equal(parseGoogleTranslateResponse([[null]]), "");
  });

  it("skips predominantly chinese descriptions", () => {
    assert.equal(isPredominantlyChinese("记录已有结论"), true);
    assert.equal(isPredominantlyChinese("Internal downstream skill for ctf-sandbox."), false);
    assert.equal(isPredominantlyChinese("CTF 沙箱编排器的内部下游技能"), true);
    assert.equal(isPredominantlyChinese(""), false);
  });

  it("keeps successes when one item fails", async () => {
    const persisted: Array<{ name: string; descriptionZh: string }> = [];
    const fetchImpl: TranslateFetch = async (input) => {
      const url = String(input);
      if (url.includes(encodeURIComponent("will fail"))) {
        return new Response("error", { status: 500 });
      }
      if (url.includes(encodeURIComponent("already 中文"))) {
        return new Response("should not be called", { status: 500 });
      }
      const translated = url.includes(encodeURIComponent("alpha"))
        ? "阿尔法说明"
        : "贝塔说明";
      return new Response(JSON.stringify([[ [translated, "src"] ]]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await translateSkillDescriptionBatch({
      fetchImpl,
      concurrency: 3,
      skills: [
        {
          id: "1",
          name: "alpha",
          description: "alpha skill description",
          body: "",
          path: "/tmp/alpha/SKILL.md",
          scope: "user",
          enabled: true,
        },
        {
          id: "2",
          name: "broken",
          description: "will fail",
          body: "",
          path: "/tmp/broken/SKILL.md",
          scope: "user",
          enabled: true,
        },
        {
          id: "3",
          name: "notes",
          description: "already 中文说明足够多",
          body: "",
          path: "/tmp/notes/SKILL.md",
          scope: "user",
          enabled: true,
        },
        {
          id: "4",
          name: "beta",
          description: "beta skill description",
          body: "",
          path: "/tmp/beta/SKILL.md",
          scope: "workspace",
          enabled: true,
        },
      ],
      persistDescriptionZh: async (skill, descriptionZh) => {
        persisted.push({ name: skill.name, descriptionZh });
      },
    });

    assert.deepEqual(result, { translated: 2, skipped: 1, failed: 1 });
    assert.deepEqual(
      persisted.map((item) => item.name).sort(),
      ["alpha", "beta", "notes"],
    );
    assert.equal(persisted.find((item) => item.name === "alpha")?.descriptionZh, "阿尔法说明");
    assert.equal(
      persisted.find((item) => item.name === "notes")?.descriptionZh,
      "already 中文说明足够多",
    );
  });

  it("writes descriptionZh into a skill dir that only has SKILL.md and keeps other meta keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-skill-meta-zh-"));
    const skillDir = join(root, "legacy-notes");
    const skillPath = join(skillDir, "SKILL.md");
    try {
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        skillPath,
        ["---", "name: legacy-notes", "description: Capture prior conclusions", "---", "", "body", ""].join(
          "\n",
        ),
        "utf8",
      );
      // 先写一份已有元数据（无 descriptionZh），模拟安装前或旧版目录。
      await writeFile(
        join(skillDir, "_meta.json"),
        `${JSON.stringify(
          {
            activationKeywords: ["notes", "结论"],
            source: {
              provider: "github",
              owner: "example",
              repo: "skills",
              url: "https://github.com/example/skills",
              commit: "abc123",
            },
            customExtra: "keep-me",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await writeSkillDescriptionZh({
        skill: {
          id: "legacy",
          name: "legacy-notes",
          description: "Capture prior conclusions",
          body: "",
          path: skillPath,
          scope: "user",
          enabled: true,
        },
        descriptionZh: "记录已有结论",
        workspacePath: root,
        userHomeDir: root,
      });

      const meta = JSON.parse(await readFile(join(skillDir, "_meta.json"), "utf8")) as {
        descriptionZh: string;
        activationKeywords: string[];
        source: { commit: string };
        customExtra: string;
      };
      assert.equal(meta.descriptionZh, "记录已有结论");
      assert.deepEqual(meta.activationKeywords, ["notes", "结论"]);
      assert.equal(meta.source.commit, "abc123");
      assert.equal(meta.customExtra, "keep-me");

      // 仅有 SKILL.md、无 _meta.json 的存量技能：翻译后应创建文件。
      const bareDir = join(root, "bare-skill");
      const barePath = join(bareDir, "SKILL.md");
      await mkdir(bareDir, { recursive: true });
      await writeFile(
        barePath,
        ["---", "name: bare-skill", "description: English only description", "---", "", "x", ""].join(
          "\n",
        ),
        "utf8",
      );
      await writeSkillDescriptionZh({
        skill: {
          id: "bare",
          name: "bare-skill",
          description: "English only description",
          body: "",
          path: barePath,
          scope: "workspace",
          enabled: true,
        },
        descriptionZh: "仅有英文说明",
        workspacePath: root,
        userHomeDir: root,
      });
      const bareMeta = JSON.parse(await readFile(join(bareDir, "_meta.json"), "utf8")) as {
        descriptionZh: string;
      };
      assert.equal(bareMeta.descriptionZh, "仅有英文说明");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("translate-all includes already-installed agents skills and list reads descriptionZh back", async () => {
    const home = await mkdtemp(join(tmpdir(), "zcode-skill-translate-home-"));
    const workspace = await mkdtemp(join(tmpdir(), "zcode-skill-translate-ws-"));
    const originalFetch = globalThis.fetch;
    const previousHome = process.env.HOME;
    try {
      // discoverSkills 的用户根读 process HOME；userHomeDir 只覆盖分组/overlay 写入。
      process.env.HOME = home;
      const userAgentsDir = join(home, ".agents", "skills", "old-helper");
      const workspaceAgentsDir = join(workspace, ".agents", "skills", "ws-helper");
      for (const [dir, name, description] of [
        [userAgentsDir, "old-helper", "Help with legacy workflows already on disk"],
        [workspaceAgentsDir, "ws-helper", "Workspace helper already installed"],
      ] as const) {
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, "SKILL.md"),
          ["---", `name: ${name}`, `description: ${description}`, "---", "", "body", ""].join("\n"),
          "utf8",
        );
      }

      globalThis.fetch = (async (input: string | URL) => {
        const url = String(input);
        assert.match(url, /translate\.googleapis\.com/);
        const translated = url.includes(encodeURIComponent("Workspace helper"))
          ? "工作区已安装助手"
          : "协助处理磁盘上已有的旧工作流";
        return new Response(JSON.stringify([[[translated, "src"]]]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const service = createSkillsService({ isDesktopRuntime: true, userHomeDir: home });
      const before = await service.list({ workspacePath: workspace });
      const userSkill = before.skills.find((skill) => skill.name === "old-helper");
      const workspaceSkill = before.skills.find((skill) => skill.name === "ws-helper");
      assert.ok(userSkill, "already-installed ~/.agents/skills skill must be listed");
      assert.ok(workspaceSkill, "already-installed workspace .agents/skills skill must be listed");
      assert.equal(userSkill.metadata?.descriptionZh, undefined);
      assert.equal(workspaceSkill.metadata?.descriptionZh, undefined);

      const userResult = await service.translateSkillDescriptions({
        workspacePath: workspace,
        viewScope: "user",
        target: { mode: "skill", skillId: userSkill.id },
      });
      assert.deepEqual(userResult, { translated: 1, skipped: 0, failed: 0 });

      const workspaceResult = await service.translateSkillDescriptions({
        workspacePath: workspace,
        viewScope: "workspace",
        target: { mode: "skill", skillId: workspaceSkill.id },
      });
      assert.deepEqual(workspaceResult, { translated: 1, skipped: 0, failed: 0 });

      // translate-all 必须覆盖存量（含未分组），不能只翻本会话新装批次。
      const allResult = await service.translateSkillDescriptions({
        workspacePath: workspace,
        viewScope: "workspace",
        target: { mode: "all" },
      });
      assert.ok(allResult.translated + allResult.skipped >= 2);

      const userMeta = JSON.parse(await readFile(join(userAgentsDir, "_meta.json"), "utf8")) as {
        descriptionZh: string;
      };
      const workspaceMeta = JSON.parse(
        await readFile(join(workspaceAgentsDir, "_meta.json"), "utf8"),
      ) as { descriptionZh: string };
      assert.equal(userMeta.descriptionZh, "协助处理磁盘上已有的旧工作流");
      assert.equal(workspaceMeta.descriptionZh, "工作区已安装助手");

      const after = await service.list({ workspacePath: workspace });
      assert.equal(
        after.skills.find((skill) => skill.name === "old-helper")?.metadata?.descriptionZh,
        "协助处理磁盘上已有的旧工作流",
      );
      assert.equal(
        after.skills.find((skill) => skill.name === "ws-helper")?.metadata?.descriptionZh,
        "工作区已安装助手",
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("limits concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 3, async (value) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      started.push(value);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return value * 2;
    });
    assert.equal(maxInFlight, 3);
    assert.deepEqual(started.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });

  it("summarizes outcomes without dropping successes", () => {
    assert.deepEqual(summarizeOutcomes(["translated", "failed", "skipped", "translated"]), {
      translated: 2,
      skipped: 1,
      failed: 1,
    });
  });
});
