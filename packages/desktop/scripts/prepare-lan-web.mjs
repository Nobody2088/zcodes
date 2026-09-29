#!/usr/bin/env node
/**
 * 构建 packages/web 并把产物拷到 packages/desktop/resources/lan-web，
 * 供局域网 TLS 服务器向手机提供完整 UI。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../../../scripts/spawn-command.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const webDist = resolve(workspaceRoot, "packages/web/dist");
const lanWebRoot = resolve(desktopRoot, "resources/lan-web");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

runCommand(pnpmCommand, ["--filter", "@zcode/web", "build"], {
  cwd: workspaceRoot,
  env: process.env,
});

if (!existsSync(resolve(webDist, "index.html"))) {
  throw new Error(`[prepare:lan-web] missing ${webDist}/index.html after web build`);
}

rmSync(lanWebRoot, { recursive: true, force: true });
mkdirSync(dirname(lanWebRoot), { recursive: true });
cpSync(webDist, lanWebRoot, { recursive: true });
console.log(`[prepare:lan-web] copied web dist -> ${lanWebRoot}`);
