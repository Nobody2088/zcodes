import {
  DesktopCommandIds,
  LAN_REMOTE_CLEANUP_PATH,
  LAN_REMOTE_RELAUNCH_PATH,
  type IPlatformService,
} from "@zcode/shared";

const LAN_SESSION_KEY = "zcode:lan-remote-session";

export interface LanDesktopSession {
  origin: string;
  token: string;
}

/** 手机配对信息在进页面之前就写进 sessionStorage。清理按钮只认这个，不认桌面 IPC。 */
export function readLanDesktopSession(): LanDesktopSession | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(LAN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LanDesktopSession>;
    if (!parsed.origin || !parsed.token) return null;
    return { origin: parsed.origin.replace(/\/$/, ""), token: parsed.token };
  } catch {
    return null;
  }
}

export function canRunDisposableCleanup(options: {
  hasPlatformCleanup: boolean;
  hasLanSession: boolean;
}): boolean {
  return options.hasPlatformCleanup || options.hasLanSession;
}

async function postLan(session: LanDesktopSession, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${session.origin}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`desktop request failed (${response.status})`);
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : {};
}

export async function runDisposableCleanup(
  platform: IPlatformService | undefined,
  categories: string[],
): Promise<{ removed: number }> {
  const session = readLanDesktopSession();
  if (session) {
    const result = (await postLan(session, LAN_REMOTE_CLEANUP_PATH, categories)) as {
      removed?: number;
    };
    return { removed: typeof result.removed === "number" ? result.removed : 0 };
  }
  if (platform?.resetDisposableUserData) {
    return platform.resetDisposableUserData(categories);
  }
  throw new Error("cleanup unavailable");
}

export async function requestDesktopRelaunch(platform: IPlatformService | undefined): Promise<void> {
  const session = readLanDesktopSession();
  if (session) {
    await postLan(session, LAN_REMOTE_RELAUNCH_PATH);
    return;
  }
  await platform?.executeDesktopCommand(DesktopCommandIds.RelaunchApp);
}
