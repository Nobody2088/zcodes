#!/usr/bin/env node
/**
 * 把当前工作区里的桌面客户端和手机端源码推到已登录 GitHub 账号下的新仓库。
 *
 * 包含：
 * - 桌面客户端 packages/desktop，以及它和手机 Web 端实际引用的 workspace 包
 * - 手机 Web 端 packages/web
 * - 手机原生端 apps/zcode-ios
 *
 * 不包含：apps/zcode-cli、node_modules、dist/out、DMG/EXE、DerivedData、mock-cdn、下载缓存。
 *
 * 用法（仓库根目录）：
 *   node scripts/push-zcode-plus.mjs
 *   node scripts/push-zcode-plus.mjs --public
 *
 * 默认私有仓库。仓库名固定为 zcode+。已存在则只推送 main，不强制覆盖历史。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const repoName = "zcode+";
const isPublic = process.argv.includes("--public");

const includeDirs = [
  "packages/desktop",
  "packages/web",
  "packages/ui",
  "packages/shared",
  "packages/client",
  "packages/rpc",
  "packages/services",
  "packages/server",
  "packages/provider",
  "packages/provider-node",
  "packages/zcode-cua",
  "packages/model-option-map",
  "apps/zcode-ios",
];

const includeFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  ".npmrc",
  "mise.toml",
  "LICENSE",
];

const rsyncExcludes = [
  "node_modules",
  "dist",
  "dist-*",
  "out",
  "DerivedData",
  "mock-cdn",
  "bundled-resources",
  "bundled-agents",
  "bundled-tools",
  ".turbo",
  "coverage",
  ".cache",
  ".e2e-artifacts",
  ".e2e-cache",
  ".e2e-network-capture",
  "xcuserdata",
  "lan-web",
  "macos-window-bounds",
  ".DS_Store",
  "*.tsbuildinfo",
  "*.map",
  "*.dmg",
  "*.exe",
  "*.blockmap",
  "*.zip",
  "*.app",
  "*.ipa",
  "*.dSYM",
  ".env",
  ".env.*",
  "*.pem",
  "*.p12",
  "*.mobileprovision",
  "schedulerProtocol.js",
  "schedulerProtocol.d.ts",
  "schedulerProtocol.js.map",
  "schedulerProtocol.d.ts.map",
  "__pycache__",
  "*.pyc",
];

const snapshotGitignore = `# 推送脚本拒绝编译产物和缓存。这里再挡一层，避免以后误加。
node_modules/
dist/
dist-*/
out/
DerivedData/
mock-cdn/
bundled-resources/
bundled-agents/
bundled-tools/
.turbo/
coverage/
.cache/
*.tsbuildinfo
*.map
*.dmg
*.exe
*.blockmap
*.zip
*.app
*.ipa
*.dSYM
.env
.env.*
*.pem
*.p12
*.mobileprovision
.DS_Store
xcuserdata/
packages/desktop/resources/lan-web/
packages/desktop/resources/macos-window-bounds/
packages/desktop/src/scheduler/schedulerProtocol.js
packages/desktop/src/scheduler/schedulerProtocol.d.ts
`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    cwd: options.cwd,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFail) {
    const detail = `${result.stderr || ""}${result.stdout || ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${detail}`);
  }
  return result;
}

function githubLogin() {
  const result = run("gh", ["api", "user", "--jq", ".login"]);
  const login = result.stdout.trim();
  if (!login) {
    throw new Error("gh 没有返回已登录用户");
  }
  return login;
}

function copyTree(staging) {
  for (const relativeDir of includeDirs) {
    const source = path.join(repoRoot, relativeDir);
    if (!fs.existsSync(source)) {
      throw new Error(`缺少目录 ${relativeDir}`);
    }
    const destination = path.join(staging, relativeDir);
    fs.mkdirSync(destination, { recursive: true });
    run("rsync", [
      "-a",
      ...rsyncExcludes.flatMap((pattern) => ["--exclude", pattern]),
      `${source}/`,
      `${destination}/`,
    ]);
  }

  for (const relativeFile of includeFiles) {
    const source = path.join(repoRoot, relativeFile);
    if (!fs.existsSync(source)) {
      throw new Error(`缺少文件 ${relativeFile}`);
    }
    const destination = path.join(staging, relativeFile);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  const workspacePath = path.join(staging, "pnpm-workspace.yaml");
  const workspace = fs.readFileSync(workspacePath, "utf8");
  const rewritten = workspace.replace(/^packages:\n(?:  - .*\n)*/m, "packages:\n  - packages/*\n");
  if (rewritten === workspace || rewritten.includes("apps/zcode-cli")) {
    throw new Error("没能把 pnpm-workspace.yaml 收成只含 packages/*");
  }
  fs.writeFileSync(workspacePath, rewritten);

  fs.mkdirSync(path.join(staging, "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "scripts/push-zcode-plus.mjs"),
    path.join(staging, "scripts/push-zcode-plus.mjs"),
  );
  fs.writeFileSync(path.join(staging, ".gitignore"), snapshotGitignore);
}

function assertNoArtifacts(staging) {
  const forbidden = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(staging, fullPath);
      if (
        entry.name === "node_modules" ||
        entry.name === "DerivedData" ||
        entry.name === "mock-cdn" ||
        entry.name === "out" ||
        entry.name === "dist" ||
        entry.name.endsWith(".dmg") ||
        entry.name.endsWith(".exe")
      ) {
        forbidden.push(relative);
        continue;
      }
      if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  };
  walk(staging);
  if (forbidden.length > 0) {
    throw new Error(`快照里仍有产物或缓存:\n${forbidden.join("\n")}`);
  }
}

function assertNoSecrets(staging) {
  const patterns = [
    "gho_" + "[A-Za-z0-9]",
    "ghp_" + "[A-Za-z0-9]",
    "github_pat_" + "[A-Za-z0-9]",
    "sk-" + "ant-",
    "AKIA" + "[0-9A-Z]{16}",
    "BEGIN " + "(RSA |OPENSSH )?PRIVATE KEY",
  ];
  const result = run(
    "rg",
    [
      "-n",
      "--hidden",
      "-g",
      "!pnpm-lock.yaml",
      "-g",
      "!package.json",
      "-g",
      "!scripts/**",
      ...patterns.flatMap((pattern) => ["-e", pattern]),
      staging,
    ],
    { allowFail: true },
  );
  if (result.status === 0 && result.stdout.trim()) {
    throw new Error(`快照里有疑似凭据，已停止推送:\n${result.stdout}`);
  }
}

function publish(staging, owner) {
  run("git", ["init", "-b", "main"], { cwd: staging });
  run("git", ["add", "-A"], { cwd: staging });
  const status = run("git", ["status", "--short"], { cwd: staging });
  if (!status.stdout.trim()) {
    throw new Error("没有可提交的源码");
  }
  run(
    "git",
    [
      "commit",
      "-m",
      "Publish ZCode+ desktop client and mobile client source.\n\nExclude the agent CLI, build outputs, and local caches.",
    ],
    { cwd: staging },
  );

  const fullName = `${owner}/${repoName}`;
  const view = run("gh", ["repo", "view", fullName, "--json", "url"], { allowFail: true });
  if (view.status !== 0) {
    run("gh", [
      "repo",
      "create",
      fullName,
      isPublic ? "--public" : "--private",
      "--description",
      "ZCode+ desktop client and mobile client source",
      "--source",
      staging,
      "--remote",
      "origin",
      "--push",
    ]);
    return;
  }

  run("git", ["remote", "remove", "origin"], { cwd: staging, allowFail: true });
  run("git", ["remote", "add", "origin", `https://github.com/${owner}/${encodeURIComponent(repoName)}.git`], {
    cwd: staging,
  });
  run("git", ["push", "-u", "origin", "main"], { cwd: staging });
}

const owner = githubLogin();
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-plus-"));
try {
  copyTree(staging);
  assertNoArtifacts(staging);
  assertNoSecrets(staging);
  publish(staging, owner);
  const url = run("gh", ["repo", "view", `${owner}/${repoName}`, "--json", "url", "--jq", ".url"], {
    cwd: staging,
  });
  process.stdout.write(`${url.stdout.trim()}\n`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
