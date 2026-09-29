const LAN_MOBILE_ACTIVE_WORKSPACE_KEY = "zcode:lan-mobile-active-workspace";
const LAN_MOBILE_ACTIVE_TASKS_KEY = "zcode:lan-mobile-active-tasks";

export interface LanMobileActiveWorkspace {
  workspacePath: string;
  workspaceIdentity?: string;
}

/** 与工作区身份规则一致：有 identity 用 identity，否则用路径。 */
export function lanMobileActiveWorkspaceKey(workspace: {
  workspacePath: string;
  workspaceIdentity?: string | null;
}): string {
  return workspace.workspaceIdentity?.trim() || workspace.workspacePath;
}

export function readLanMobileActiveWorkspaceKey(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(LAN_MOBILE_ACTIVE_WORKSPACE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LanMobileActiveWorkspace>;
    if (!parsed.workspacePath) {
      return null;
    }
    return lanMobileActiveWorkspaceKey({
      workspacePath: parsed.workspacePath,
      workspaceIdentity: parsed.workspaceIdentity,
    });
  } catch {
    return null;
  }
}

export function writeLanMobileActiveWorkspace(workspace: LanMobileActiveWorkspace): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const workspaceIdentity = workspace.workspaceIdentity?.trim();
  try {
    localStorage.setItem(
      LAN_MOBILE_ACTIVE_WORKSPACE_KEY,
      JSON.stringify({
        workspacePath: workspace.workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
      }),
    );
  } catch {
    // 隐私模式或配额满时不打断当前项目。
  }
}

function readLanMobileActiveTasksMap(): Record<string, string> {
  if (typeof localStorage === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(LAN_MOBILE_ACTIVE_TASKS_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === "string" && key && typeof value === "string" && value) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** 手机本机记下的「该项目上次查看的对话」；Host 上可能是桌面焦点，不能当手机真相。 */
export function readLanMobileActiveTaskId(workspace: {
  workspacePath: string;
  workspaceIdentity?: string | null;
}): string | null {
  const key = lanMobileActiveWorkspaceKey(workspace);
  return readLanMobileActiveTasksMap()[key] ?? null;
}

export function writeLanMobileActiveTask(workspace: {
  workspacePath: string;
  workspaceIdentity?: string | null;
  taskId: string;
}): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const taskId = workspace.taskId.trim();
  if (!taskId) {
    return;
  }
  const key = lanMobileActiveWorkspaceKey(workspace);
  try {
    const next = {
      ...readLanMobileActiveTasksMap(),
      [key]: taskId,
    };
    localStorage.setItem(LAN_MOBILE_ACTIVE_TASKS_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式或配额满时不打断当前对话。
  }
}

/**
 * 手机恢复对话：优先本机记下的 taskId（且仍在列表里），否则退回列表第一条。
 * 用以覆盖桌面焦点 / 空白草稿，而不是总是打开「最新」一条。
 */
export function resolveLanMobileRestoreTaskId(
  availableTaskIds: readonly string[],
  preferredTaskId: string | null | undefined,
): string | null {
  if (availableTaskIds.length === 0) {
    return null;
  }
  if (preferredTaskId && availableTaskIds.includes(preferredTaskId)) {
    return preferredTaskId;
  }
  return availableTaskIds[0] ?? null;
}

/** 手机恢复时优先上次自己打开的项目；对不上再退回桌面记下的下标。 */
export function resolveLanMobileRestoreIndex(
  keys: readonly string[],
  fallbackIndex: number,
  preferredKey: string | null | undefined,
): number {
  if (!preferredKey) {
    return fallbackIndex;
  }
  const index = keys.indexOf(preferredKey);
  return index >= 0 ? index : fallbackIndex;
}
