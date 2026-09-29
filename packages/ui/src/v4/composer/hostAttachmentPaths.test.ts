import assert from "node:assert/strict";
import test from "node:test";
import { canGoUp } from "./hostAttachmentPaths.js";

test("unknown home still allows leaving the workspace until the filesystem root", () => {
  assert.equal(canGoUp("/work/app", ""), true);
  assert.equal(canGoUp("/work", ""), true);
  assert.equal(canGoUp("/", ""), false);
});

test("known home stops at the home directory", () => {
  assert.equal(canGoUp("/Users/a/proj", "/Users/a"), true);
  assert.equal(canGoUp("/Users/a", "/Users/a"), false);
});

test("a workspace outside home can still move up and is not treated as home", () => {
  assert.equal(canGoUp("/Volumes/Disk/proj", "/Users/a"), true);
  assert.equal(canGoUp("/Volumes/Disk", "/Users/a"), true);
});
