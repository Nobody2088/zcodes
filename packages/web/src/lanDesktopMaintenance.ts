import {
  DesktopCommandIds,
  LAN_REMOTE_CLEANUP_PATH,
  LAN_REMOTE_RELAUNCH_PATH,
  type DesktopCommandId,
  type IPlatformService,
} from "@zcode/shared";
import type { LanRemoteBrowserSession } from "./lanPairing.js";

async function postLan(session: LanRemoteBrowserSession, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${session.origin}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`desktop request failed (${response.status})`);
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : {};
}

/** 手机设置页的清理和重启交给已配对的桌面 Main，网页本身不删文件。 */
export function applyLanDesktopMaintenance(
  platform: IPlatformService,
  session: LanRemoteBrowserSession,
): void {
  platform.resetDisposableUserData = async (categories) => {
    const result = (await postLan(session, LAN_REMOTE_CLEANUP_PATH, categories)) as {
      removed?: number;
    };
    return { removed: typeof result.removed === "number" ? result.removed : 0 };
  };
  const executeDesktopCommand = platform.executeDesktopCommand.bind(platform);
  platform.executeDesktopCommand = (command: DesktopCommandId) => {
    if (command === DesktopCommandIds.RelaunchApp) {
      return postLan(session, LAN_REMOTE_RELAUNCH_PATH);
    }
    return executeDesktopCommand(command);
  };
}
