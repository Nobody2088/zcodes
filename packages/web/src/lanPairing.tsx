import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LAN_REMOTE_INFO_PATH, LAN_REMOTE_PAIR_PATH, lanRemoteInfoSchema } from "@zcode/shared";

const LAN_SESSION_KEY = "zcode:lan-remote-session";
const LAN_CLIENT_KEY = "zcode:lan-remote-client";

export interface LanRemoteBrowserSession {
  origin: string;
  token: string;
  clientId: string;
}

function browserCopy(zh: string, en: string): string {
  return /^zh\b/i.test(navigator.language) ? zh : en;
}

export function clearLanRemoteBrowserSession(): void {
  sessionStorage.removeItem(LAN_SESSION_KEY);
}

export function readLanRemoteBrowserSession(): LanRemoteBrowserSession | null {
  const raw = sessionStorage.getItem(LAN_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LanRemoteBrowserSession;
    if (!parsed.origin || !parsed.token || !parsed.clientId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clientId(): string {
  const existing = localStorage.getItem(LAN_CLIENT_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(LAN_CLIENT_KEY, created);
  return created;
}

export function promptLanRemoteBrowserSession(
  root: ReturnType<typeof createRoot>,
): Promise<LanRemoteBrowserSession> {
  return new Promise((resolve) => {
    root.render(<LanPairingForm onConnected={resolve} />);
  });
}

function LanPairingForm({
  onConnected,
}: {
  onConnected: (session: LanRemoteBrowserSession) => void;
}) {
  const [origin, setOrigin] = useState("https://");
  const [password, setPassword] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function connect() {
    const base = origin.trim().replace(/\/$/, "");
    setPending(true);
    setError("");
    try {
      const infoResponse = await fetch(`${base}${LAN_REMOTE_INFO_PATH}`, { cache: "no-store" });
      if (!infoResponse.ok)
        throw new Error(browserCopy("无法读取客户端信息", "Could not read the client"));
      const info = lanRemoteInfoSchema.parse(await infoResponse.json());
      setFingerprint(info.fingerprint);
      const id = clientId();
      const pairResponse = await fetch(`${base}${LAN_REMOTE_PAIR_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password,
          clientId: id,
          clientName: browserCopy("iPhone", "iPhone"),
        }),
      });
      if (pairResponse.status === 401) {
        throw new Error(browserCopy("密码不正确", "Incorrect password"));
      }
      if (pairResponse.status === 429) {
        throw new Error(
          browserCopy("尝试次数过多，请稍后再试", "Too many attempts. Try again shortly."),
        );
      }
      if (!pairResponse.ok) throw new Error(browserCopy("配对失败", "Pairing failed"));
      const body = (await pairResponse.json()) as { token?: string };
      if (!body.token) throw new Error(browserCopy("配对失败", "Pairing failed"));
      const session = { origin: base, token: body.token, clientId: id };
      sessionStorage.setItem(LAN_SESSION_KEY, JSON.stringify(session));
      onConnected(session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-dvh min-h-dvh w-screen flex-col overflow-y-auto bg-background pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(1rem,env(safe-area-inset-left))] text-foreground">
      <form
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-8"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <header className="flex flex-col gap-2">
          <h1 className="text-ui-xl font-semibold">
            {browserCopy("连接局域网里的 ZCode", "Connect to a ZCode client")}
          </h1>
          <p className="text-ui-base text-foreground-subtle">
            {browserCopy(
              "输入电脑上显示的地址和密码。证书指纹应与桌面设置里的一致。",
              "Enter the address and password shown on the computer. The certificate fingerprint should match desktop settings.",
            )}
          </p>
        </header>
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-ui-sm font-medium text-foreground-subtle">
              {browserCopy("地址", "Address")}
            </span>
            <input
              className="text-mobile-input-safe h-11 rounded-lg border border-input-border bg-input px-3 outline-none focus:border-input-border-focused"
              value={origin}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setOrigin(event.target.value)}
              aria-label={browserCopy("地址", "Address")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-ui-sm font-medium text-foreground-subtle">
              {browserCopy("密码", "Password")}
            </span>
            <input
              className="text-mobile-input-safe h-11 rounded-lg border border-input-border bg-input px-3 outline-none focus:border-input-border-focused"
              value={password}
              type="password"
              onChange={(event) => setPassword(event.target.value)}
              aria-label={browserCopy("密码", "Password")}
            />
          </label>
          {fingerprint ? (
            <p className="break-all rounded-lg bg-background px-3 py-2 font-mono text-ui-xs text-foreground-subtle">
              {fingerprint}
            </p>
          ) : null}
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-base text-destructive"
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="h-11 rounded-lg bg-brand px-4 text-ui-base font-medium text-foreground-inverse transition-opacity active:opacity-80 disabled:opacity-50"
          disabled={
            pending || password.trim().length === 0 || !origin.trim().startsWith("https://")
          }
        >
          {pending ? browserCopy("连接中…", "Connecting…") : browserCopy("连接", "Connect")}
        </button>
      </form>
    </div>
  );
}
