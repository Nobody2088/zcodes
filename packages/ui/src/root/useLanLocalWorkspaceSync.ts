import { useEffect, useRef } from "react";
import type { AppSettings } from "@zcode/shared";
import type { IBroadcastService, ISettingService } from "@zcode/services";
import { logger } from "@/logger.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab, type WindowTabState } from "@/store/tabStore.js";
import {
  mergeLanLocalWorkspacesIntoSession,
  unionPersistedWorkspaceSessions,
  type LanOpenedLocalWorkspace,
} from "@/root/lanLocalWorkspaceSession.js";

export const LAN_LOCAL_WORKSPACES_APPENDED_CHANNEL = "lan:local-workspaces-appended";

const PUBLISH_DEBOUNCE_MS = 300;

function listOpenedLocalWorkspaces(tabs: readonly WindowTabState[]): LanOpenedLocalWorkspace[] {
  const seen = new Set<string>();
  const opened: LanOpenedLocalWorkspace[] = [];
  for (const tab of tabs) {
    if (!isWorkspaceTab(tab) || tab.remoteSessionId || tab.remoteTarget) continue;
    const workspacePath = tab.workspacePath.trim();
    if (!workspacePath || seen.has(workspacePath)) continue;
    seen.add(workspacePath);
    opened.push({
      workspacePath,
      ...(tab.workspacePurpose ? { workspacePurpose: tab.workspacePurpose } : {}),
    });
  }
  return opened;
}

function readAppendedWorkspaces(payload: unknown): LanOpenedLocalWorkspace[] {
  if (!payload || typeof payload !== "object") return [];
  const workspaces = (payload as { workspaces?: unknown }).workspaces;
  if (!Array.isArray(workspaces)) return [];
  return workspaces.flatMap((item): LanOpenedLocalWorkspace[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as { workspacePath?: unknown; workspacePurpose?: unknown };
    if (typeof record.workspacePath !== "string") return [];
    const workspacePath = record.workspacePath.trim();
    if (!workspacePath) return [];
    const workspacePurpose =
      record.workspacePurpose === "project" || record.workspacePurpose === "conversation"
        ? record.workspacePurpose
        : undefined;
    return [
      {
        workspacePath,
        ...(workspacePurpose ? { workspacePurpose } : {}),
      },
    ];
  });
}

function sessionStillContains(
  before: Pick<AppSettings, "lastWorkspaceSession">,
  after: Pick<AppSettings, "lastWorkspaceSession">,
): boolean {
  const afterKeys = new Set(
    (after.lastWorkspaceSession ?? []).map((entry) =>
      entry.kind === "local"
        ? `local:${entry.workspacePath}`
        : `remote:${entry.workspaceIdentity?.trim() || entry.workspacePath}`,
    ),
  );
  return (before.lastWorkspaceSession ?? []).every((entry) =>
    afterKeys.has(
      entry.kind === "local"
        ? `local:${entry.workspacePath}`
        : `remote:${entry.workspaceIdentity?.trim() || entry.workspacePath}`,
    ),
  );
}

function ensureOpenedLocalWorkspaces(
  store: ReturnType<typeof useTabStoreApi>,
  workspaces: readonly LanOpenedLocalWorkspace[],
  closedByThisWindow: Set<string>,
): void {
  for (const workspace of workspaces) {
    if (closedByThisWindow.has(workspace.workspacePath)) continue;
    const alreadyOpen = store.getState().tabs.some(
      (tab) =>
        isWorkspaceTab(tab) &&
        !tab.remoteSessionId &&
        !tab.remoteTarget &&
        tab.workspacePath === workspace.workspacePath,
    );
    if (alreadyOpen) continue;
    store.getState().ensureWorkspaceTab(
      workspace.workspacePath,
      workspace.workspacePurpose ? { workspacePurpose: workspace.workspacePurpose } : undefined,
    );
  }
}

/**
 * 手机追加本地项目。空标签不写，避免还没恢复完的列表盖掉桌面会话。
 */
export function usePublishLanOpenedLocalWorkspaces({
  enabled,
  settingService,
  broadcastService,
}: {
  enabled: boolean;
  settingService?: ISettingService;
  broadcastService?: IBroadcastService;
}): void {
  const store = useTabStoreApi();

  useEffect(() => {
    if (!enabled || !settingService || !broadcastService) return;

    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const publish = () => {
      const currentGeneration = ++generation;
      const opened = listOpenedLocalWorkspaces(store.getState().tabs);
      if (opened.length === 0) return;

      void (async () => {
        let basis: Pick<AppSettings, "lastWorkspaceSession" | "recentProjects"> =
          await settingService.get();
        if (currentGeneration !== generation) return;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const merged = mergeLanLocalWorkspacesIntoSession(basis, opened);
          if (!merged) return;
          if (attempt === 0) {
            await broadcastService.send({
              channel: LAN_LOCAL_WORKSPACES_APPENDED_CHANNEL,
              payload: { workspaces: merged.appended },
            });
          }
          await settingService.update(merged.patch);
          if (currentGeneration !== generation) return;
          const after = await settingService.get();
          if (currentGeneration !== generation) return;
          const appendedPresent = merged.appended.every((workspace) =>
            (after.lastWorkspaceSession ?? []).some(
              (entry) => entry.kind === "local" && entry.workspacePath === workspace.workspacePath,
            ),
          );
          if (sessionStillContains(basis, after) && appendedPresent) {
            return;
          }
          // 写入排队期间桌面可能先落了另一份快照。把两边并起来再追加，避免后写覆盖掉远程会话。
          basis = unionPersistedWorkspaceSessions(basis, after);
        }
        logger.warn("[lan-remote] 追加本地项目时未能保留桌面已有会话");
      })().catch((error) => {
        logger.warn("[lan-remote] 追加本地项目失败", { error });
      });
    };

    const unsubscribe = store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(publish, PUBLISH_DEBOUNCE_MS);
    });

    return () => {
      generation += 1;
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [broadcastService, enabled, settingService, store]);
}

/**
 * 桌面补上手机新打开的本地项目，不激活，也不把本窗口刚关掉的项目加回来。
 */
export function useApplyLanOpenedLocalWorkspaces({
  enabled,
  settingService,
  broadcastService,
  ready,
}: {
  enabled: boolean;
  settingService?: ISettingService;
  broadcastService?: IBroadcastService;
  ready: boolean;
}): void {
  const store = useTabStoreApi();
  const closedByThisWindowRef = useRef(new Set<string>());
  const seenSettingsPathsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    let previous = store.getState().tabs;
    return store.subscribe((state) => {
      const nextPaths = new Set(listOpenedLocalWorkspaces(state.tabs).map((item) => item.workspacePath));
      for (const workspace of listOpenedLocalWorkspaces(previous)) {
        if (!nextPaths.has(workspace.workspacePath)) {
          closedByThisWindowRef.current.add(workspace.workspacePath);
        }
      }
      for (const workspacePath of nextPaths) {
        closedByThisWindowRef.current.delete(workspacePath);
      }
      previous = state.tabs;
    });
  }, [store]);

  useEffect(() => {
    if (!enabled || !ready || !settingService || !broadcastService) return;

    const applyFromSettings = () => {
      void settingService
        .get()
        .then((settings) => {
          const opened = (settings.lastWorkspaceSession ?? []).flatMap((entry) =>
            entry.kind === "local"
              ? [
                  {
                    workspacePath: entry.workspacePath,
                    ...(entry.workspacePurpose ? { workspacePurpose: entry.workspacePurpose } : {}),
                  },
                ]
              : [],
          );
          const currentPaths = new Set(opened.map((workspace) => workspace.workspacePath));
          const seen = seenSettingsPathsRef.current;
          if (seen) {
            const newlyAdded = opened.filter((workspace) => !seen.has(workspace.workspacePath));
            for (const workspace of newlyAdded) {
              closedByThisWindowRef.current.delete(workspace.workspacePath);
            }
            seenSettingsPathsRef.current = currentPaths;
            ensureOpenedLocalWorkspaces(store, newlyAdded, closedByThisWindowRef.current);
            return;
          }
          seenSettingsPathsRef.current = currentPaths;
          ensureOpenedLocalWorkspaces(store, opened, closedByThisWindowRef.current);
        })
        .catch((error) => {
          logger.warn("[lan-remote] 读取手机追加的本地项目失败", { error });
        });
    };

    applyFromSettings();

    const disposable = broadcastService.onMessage((message) => {
      if (message.channel !== LAN_LOCAL_WORKSPACES_APPENDED_CHANNEL) return;
      const opened = readAppendedWorkspaces(message.payload);
      for (const workspace of opened) {
        closedByThisWindowRef.current.delete(workspace.workspacePath);
      }
      ensureOpenedLocalWorkspaces(store, opened, closedByThisWindowRef.current);
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") applyFromSettings();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", applyFromSettings);

    return () => {
      disposable.dispose();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", applyFromSettings);
    };
  }, [broadcastService, enabled, ready, settingService, store]);
}
