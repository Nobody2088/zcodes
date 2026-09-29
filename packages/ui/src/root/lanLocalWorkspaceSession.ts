import type { AppSettings } from "@zcode/shared";

const RECENT_PROJECT_LIMIT = 10;

export interface LanOpenedLocalWorkspace {
  workspacePath: string;
  workspacePurpose?: "project" | "conversation";
}

export interface LanLocalWorkspaceMergeResult {
  patch: Partial<AppSettings>;
  appended: LanOpenedLocalWorkspace[];
}

type PersistedSession = NonNullable<AppSettings["lastWorkspaceSession"]>[number];

function localWorkspaceKey(workspacePath: string): string {
  return `local:${workspacePath}`;
}

function persistedSessionKey(entry: PersistedSession): string {
  if (entry.kind === "local") {
    return localWorkspaceKey(entry.workspacePath);
  }
  const identity = entry.workspaceIdentity?.trim() || entry.workspacePath;
  return `remote:${identity}`;
}

/**
 * 手机只追加自己新打开的本地项目。
 * 整份替换会把桌面已打开、但手机还没恢复的本地项目和远程会话删掉。
 */
export function mergeLanLocalWorkspacesIntoSession(
  current: Pick<AppSettings, "lastWorkspaceSession" | "recentProjects">,
  opened: readonly LanOpenedLocalWorkspace[],
): LanLocalWorkspaceMergeResult | null {
  const existing = current.lastWorkspaceSession ?? [];
  const existingKeys = new Set(existing.map((entry) => persistedSessionKey(entry)));
  const appended: LanOpenedLocalWorkspace[] = [];
  for (const workspace of opened) {
    const workspacePath = workspace.workspacePath.trim();
    if (!workspacePath || existingKeys.has(localWorkspaceKey(workspacePath))) {
      continue;
    }
    existingKeys.add(localWorkspaceKey(workspacePath));
    appended.push({
      workspacePath,
      ...(workspace.workspacePurpose ? { workspacePurpose: workspace.workspacePurpose } : {}),
    });
  }
  if (appended.length === 0) {
    return null;
  }

  const projectPaths = appended.flatMap((workspace) =>
    workspace.workspacePurpose === "conversation" ? [] : [workspace.workspacePath],
  );
  const recentProjects =
    projectPaths.length === 0
      ? undefined
      : [...projectPaths, ...(current.recentProjects ?? []).filter((path) => !projectPaths.includes(path))].slice(
          0,
          RECENT_PROJECT_LIMIT,
        );

  return {
    appended,
    patch: {
      lastWorkspaceSession: [
        ...existing,
        ...appended.map((workspace) => ({
          kind: "local" as const,
          workspacePath: workspace.workspacePath,
          ...(workspace.workspacePurpose ? { workspacePurpose: workspace.workspacePurpose } : {}),
        })),
      ],
      ...(recentProjects ? { recentProjects } : {}),
    },
  };
}

export function unionPersistedWorkspaceSessions(
  left: Pick<AppSettings, "lastWorkspaceSession" | "recentProjects">,
  right: Pick<AppSettings, "lastWorkspaceSession" | "recentProjects">,
): Pick<AppSettings, "lastWorkspaceSession" | "recentProjects"> {
  const lastWorkspaceSession = [...(left.lastWorkspaceSession ?? [])];
  const seen = new Set(lastWorkspaceSession.map((entry) => persistedSessionKey(entry)));
  for (const entry of right.lastWorkspaceSession ?? []) {
    const key = persistedSessionKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    lastWorkspaceSession.push(entry);
  }
  const recentProjects = [
    ...(left.recentProjects ?? []),
    ...(right.recentProjects ?? []).filter((path) => !(left.recentProjects ?? []).includes(path)),
  ].slice(0, RECENT_PROJECT_LIMIT);
  return {
    lastWorkspaceSession,
    recentProjects,
  };
}
