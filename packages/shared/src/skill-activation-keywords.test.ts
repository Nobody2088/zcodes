import assert from "node:assert/strict";
import test from "node:test";
import {
  SKILL_ACTIVATION_KEYWORD_MAX_COUNT,
  SKILL_ACTIVATION_KEYWORD_MAX_LENGTH,
  buildForcedSkillToolPrompt,
  deriveSkillNameKeywords,
  parseActivationKeywordsInput,
  selectSkillActivationMatch,
  validateActivationKeywords,
} from "./skill-activation-keywords.js";

test("parseActivationKeywordsInput splits on whitespace, comma, and Chinese comma", () => {
  const parsed = parseActivationKeywordsInput(" reverse , 调试，debug  Reverse ");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.keywords, ["reverse", "调试", "debug"]);
});

test("parseActivationKeywordsInput rejects overflow count without truncating", () => {
  const keywords = Array.from({ length: SKILL_ACTIVATION_KEYWORD_MAX_COUNT + 1 }, (_, i) => `k${i}`);
  const parsed = parseActivationKeywordsInput(keywords.join(" "));
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.code, "too-many");
  assert.equal(parsed.keywords.length, SKILL_ACTIVATION_KEYWORD_MAX_COUNT + 1);
});

test("parseActivationKeywordsInput rejects keyword longer than 32 chars", () => {
  const tooLong = "a".repeat(SKILL_ACTIVATION_KEYWORD_MAX_LENGTH + 1);
  const parsed = parseActivationKeywordsInput(`ok ${tooLong}`);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.code, "too-long");
});

test("validateActivationKeywords rejects corrupt non-string members via join path", () => {
  const parsed = validateActivationKeywords(["good", "x".repeat(40)]);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.code, "too-long");
});

test("deriveSkillNameKeywords splits on hyphen and underscore", () => {
  assert.deepEqual(deriveSkillNameKeywords("control-browser"), ["control", "browser"]);
  assert.deepEqual(deriveSkillNameKeywords("my_skill-pack"), ["my", "skill", "pack"]);
  assert.deepEqual(deriveSkillNameKeywords("Router"), ["Router"]);
});

test("shared pack keyword alone does not activate all skills", () => {
  const match = selectSkillActivationMatch("please use reverse tooling", [
    { name: "a-tool", activationKeywords: ["reverse"] },
    { name: "b-tool", activationKeywords: ["reverse"] },
  ]);
  assert.equal(match, null);
});

test("unique pack keyword activates one skill", () => {
  const match = selectSkillActivationMatch("need 调试 notes", [
    { name: "notes", activationKeywords: ["调试", "pack"] },
    { name: "router", activationKeywords: ["pack"] },
  ]);
  assert.ok(match);
  assert.equal(match?.skillName, "notes");
});

test("name-derived keyword can uniquely activate when pack keywords are shared", () => {
  const match = selectSkillActivationMatch("open the browser panel", [
    { name: "control-browser", activationKeywords: ["pack"] },
    { name: "doc-writer", activationKeywords: ["pack"] },
  ]);
  assert.ok(match);
  assert.equal(match?.skillName, "control-browser");
});

test("ASCII keywords require word boundaries", () => {
  const match = selectSkillActivationMatch("unreversed data", [
    { name: "reverse-skill", activationKeywords: ["reverse"] },
  ]);
  assert.equal(match, null);
});

test("CJK keywords match as substrings", () => {
  const match = selectSkillActivationMatch("请帮我做逆向分析", [
    { name: "re", activationKeywords: ["逆向"] },
  ]);
  assert.ok(match);
  assert.equal(match?.skillName, "re");
});

test("tied distinctive scores do not force a skill", () => {
  const match = selectSkillActivationMatch("alpha gamma together", [
    { name: "one", activationKeywords: ["alpha"] },
    { name: "two", activationKeywords: ["gamma"] },
  ]);
  assert.equal(match, null);
});

test("buildForcedSkillToolPrompt matches /skill contract", () => {
  const prompt = buildForcedSkillToolPrompt("notes", "summarize this");
  assert.match(prompt, /Skill` tool with name `notes`/);
  assert.match(prompt, /User request:\nsummarize this/);
});
