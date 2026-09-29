import { rm, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export const USER_DATA_CLEANUP_CATEGORIES = [
  "conversations",
  "memory",
  "caches",
  "logs",
  "backups",
] as const;

export type UserDataCleanupCategory = (typeof USER_DATA_CLEANUP_CATEGORIES)[number];

const DIRECTORIES: Record<UserDataCleanupCategory, string[]> = {
  conversations: ["v2/sessions", "v2/checkpoints", "v2/session-bindings", "cli/sessions", "cli/agents"],
  memory: ["cli/memories"],
  caches: ["cli/artifacts", "cli/exec", "cli/image-cache", "cli/pdf-cache", "clipboard", "tmp", "cache"],
  logs: [
    "cli/debug",
    "cli/rollout",
    "cli/log",
    "v2/dev",
    "v2/acp-traffic-proxy",
    "v2/acp-stream-diagnostics",
    "v2/logs",
    "v2/perf",
    "logs",
  ],
  backups: ["cli/db/backup", "cli/db/backups", "v2/backup", "v2/migrations", "backup", "export-log", "export-log-stage", "feedback"],
};

const CONVERSATION_FILES = [
  "cli/db/db.sqlite",
  "cli/db/db.sqlite-wal",
  "cli/db/db.sqlite-shm",
  "v2/tasks-index.sqlite",
  "v2/tasks-index.sqlite-wal",
  "v2/tasks-index.sqlite-shm",
];

export function parseCleanupCategories(value: unknown): UserDataCleanupCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UserDataCleanupCategory =>
    USER_DATA_CLEANUP_CATEGORIES.includes(item as UserDataCleanupCategory),
  );
}

export async function resetDisposableUserData(
  zcodeRoot: string,
  categories: readonly UserDataCleanupCategory[],
): Promise<number> {
  const selected = new Set(categories);
  let removed = 0;
  for (const category of selected) {
    for (const relative of DIRECTORIES[category]) {
      removed += await removePath(join(zcodeRoot, relative));
    }
  }
  if (selected.has("conversations")) {
    for (const relative of CONVERSATION_FILES) {
      removed += await removePath(join(zcodeRoot, relative));
    }
  }
  if (selected.has("logs")) {
    removed += await removeCrashReports(join(zcodeRoot, "v2/crash"));
  }
  if (selected.has("conversations") || selected.has("memory")) {
    await clearSessionPointers(join(zcodeRoot, "v2/setting.json"), selected);
  }
  return removed;
}

export function resolveZcodeRoots(dataBaseDir: string | undefined): string[] {
  const homeRoot = join(process.env.HOME?.trim() || homedir(), ".zcode");
  const custom = dataBaseDir?.trim();
  const roots = [homeRoot];
  if (custom) {
    const customRoot = join(custom, ".zcode");
    if (customRoot !== homeRoot) roots.push(customRoot);
  }
  return roots;
}

async function removePath(target: string): Promise<number> {
  try {
    await rm(target, { recursive: true, force: true });
    return 1;
  } catch {
    return 0;
  }
}

async function removeCrashReports(crashDir: string): Promise<number> {
  let removed = 0;
  let names: string[] = [];
  try {
    names = await readdir(crashDir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (name === "live") continue;
    removed += await removePath(join(crashDir, name));
  }
  return removed;
}

async function clearSessionPointers(
  settingsFile: string,
  selected: ReadonlySet<UserDataCleanupCategory>,
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(settingsFile, "utf8");
  } catch {
    return;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  if (selected.has("memory")) {
    const projects = Array.isArray(parsed.recentProjects) ? parsed.recentProjects : [];
    for (const project of projects) {
      if (typeof project !== "string" || !project.trim()) continue;
      await removePath(join(project, "MEMORY.md"));
      await removePath(join(project, ".zcode", "memories"));
    }
  }
  if (selected.has("conversations")) {
    parsed.lastWorkspaceSession = [];
    parsed.lastActiveTabIndex = 0;
    delete parsed.lastActiveTaskByWorkspace;
  }
  await writeFile(settingsFile, JSON.stringify(parsed, null, 2));
}
