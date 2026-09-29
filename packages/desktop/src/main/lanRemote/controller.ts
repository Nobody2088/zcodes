import { randomUUID } from "node:crypto";
import { BrowserWindow, MessageChannelMain, dialog, ipcMain, type UtilityProcess } from "electron";
import type { WebSocket } from "ws";
import { HostMessageTypes, PlatformChannels, type LanRemoteControlState } from "@zcode/shared";
import { logger as desktopLogger } from "../logger.js";
import { httpsCertStorageDir, loadHttpsCertMeta, needsHttpsCertExpiryWarning, saveHttpsCertMeta, toLanRemoteHttpsCertInfo, type HttpsCertMeta } from "./httpsCert.js";
import { handleImportLanRemoteHttpsCert } from "./importHttpsCertHandler.js";
import {
  closeServers,
  emptyListenerBundle,
  startLanRemoteListeners,
  type LanRemoteListenerBundle,
} from "./lanRemoteListeners.js";
import { listPrivateLanIPv4 } from "./server.js";
import {
  loadLanRemoteSecret,
  preferDefaultLanRemoteEnabled,
  revokeLanDevice,
  rotateLanPassword,
  saveLanRemoteSecret,
  toLanRemoteControlState,
  type LanRemoteSecret,
} from "./secret.js";
import { bridgeLanSocketToHostPort, type LanRpcSocket } from "./socketBridge.js";

interface LanRemoteControllerOptions {
  userDataDir: string;
  resolveHost: () => UtilityProcess | undefined;
  onCleanup?: (categories: string[]) => Promise<{ removed: number }>;
  onRelaunch?: () => void | Promise<void>;
}

function adaptSocket(ws: WebSocket): LanRpcSocket {
  return {
    send(data) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close() {
      ws.close();
    },
    on(event, listener) {
      if (event === "message") {
        ws.on("message", (payload, isBinary) => {
          const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload as ArrayBuffer);
          listener(new Uint8Array(bytes), isBinary);
        });
        return;
      }
      ws.on("close", () => {
        (listener as () => void)();
      });
    },
  };
}

export function startDesktopLanRemoteControl(options: LanRemoteControllerOptions): {
  stop(): Promise<void>;
} {
  let secretPromise = loadLanRemoteSecret(options.userDataDir);
  let currentSecret: LanRemoteSecret | undefined;
  let httpsMetaPromise = loadHttpsCertMeta(options.userDataDir);
  let currentHttpsMeta: HttpsCertMeta | null | undefined;
  let listeners: LanRemoteListenerBundle = emptyListenerBundle();
  const clients = new Map<string, Set<WebSocket>>();

  async function readSecret(): Promise<LanRemoteSecret> {
    currentSecret = await secretPromise;
    return currentSecret;
  }

  async function readHttpsMeta(): Promise<HttpsCertMeta | null> {
    currentHttpsMeta = await httpsMetaPromise;
    return currentHttpsMeta;
  }

  async function updateSecret(next: LanRemoteSecret): Promise<void> {
    currentSecret = next;
    secretPromise = Promise.resolve(next);
    await saveLanRemoteSecret(options.userDataDir, next);
  }

  async function updateHttpsMeta(next: HttpsCertMeta | null): Promise<void> {
    currentHttpsMeta = next;
    httpsMetaPromise = Promise.resolve(next);
    if (next) {
      await saveHttpsCertMeta(options.userDataDir, next);
    }
  }

  function currentState(secret: LanRemoteSecret, meta: HttpsCertMeta | null): LanRemoteControlState {
    return toLanRemoteControlState(
      secret,
      listPrivateLanIPv4(),
      toLanRemoteHttpsCertInfo(options.userDataDir, meta, {
        enabled: secret.publicHttpsEnabled === true,
        port: secret.publicHttpsPort,
      }),
    );
  }

  function getSecret(): LanRemoteSecret {
    if (!currentSecret) throw new Error("LAN remote secret is not loaded");
    return currentSecret;
  }

  function closeDevice(deviceId: string): void {
    for (const socket of clients.get(deviceId) ?? []) socket.close(4003, "revoked");
    clients.delete(deviceId);
  }

  function closeAllClients(): void {
    for (const deviceId of clients.keys()) closeDevice(deviceId);
  }

  async function stopListening(): Promise<void> {
    listeners.stopMdns?.();
    listeners.stopMdns = undefined;
    closeAllClients();
    const running = listeners.servers;
    listeners = emptyListenerBundle();
    await closeServers(running);
  }

  function attachClient(ws: WebSocket, deviceId: string): void {
    const child = options.resolveHost();
    if (!child) {
      ws.close(1013, "host unavailable");
      return;
    }
    const { port1, port2 } = new MessageChannelMain();
    try {
      child.postMessage(
        {
          type: HostMessageTypes.AttachServicePort,
          requestId: randomUUID(),
          attachmentId: randomUUID(),
          clientMode: "web-remote-replayable",
          scope: { kind: "local" },
        },
        [port2],
      );
    } catch (error) {
      port1.close();
      port2.close();
      desktopLogger.warn("[lan-remote] attach failed", error);
      ws.close(1011, "attach failed");
      return;
    }
    const bucket = clients.get(deviceId) ?? new Set<WebSocket>();
    bucket.add(ws);
    clients.set(deviceId, bucket);
    ws.on("close", () => bucket.delete(ws));
    bridgeLanSocketToHostPort(adaptSocket(ws), port1);
  }

  async function maybeWarnHttpsCertExpiry(meta: HttpsCertMeta | null): Promise<HttpsCertMeta | null> {
    if (!needsHttpsCertExpiryWarning(meta)) {
      return meta;
    }
    const domain = meta!.domain;
    const notAfter = meta!.notAfter;
    const expired = Date.parse(notAfter) <= Date.now();
    desktopLogger.info("[lan-remote] https cert expiry warning", {
      domain,
      notAfter,
      fingerprintPrefix: meta!.fingerprint.slice(0, 12),
      storagePath: httpsCertStorageDir(options.userDataDir),
    });
    const focused = BrowserWindow.getFocusedWindow();
    const message = expired
      ? `公网 HTTPS 证书已过期 / Public HTTPS certificate expired\n\n域名 ${domain} 已于 ${notAfter} 过期。请续期后重新导入。局域网自签监听不受影响。\n\nDomain ${domain} expired on ${notAfter}. Renew and re-import. LAN self-signed listening is unchanged.`
      : `公网 HTTPS 证书即将过期 / Public HTTPS certificate expiring soon\n\n域名 ${domain} 将于 ${notAfter} 过期（15 天内）。请续期并重新导入。\n\nDomain ${domain} expires on ${notAfter} (within 15 days). Renew and re-import.`;
    const boxOptions = {
      type: "warning" as const,
      title: "Public HTTPS certificate / 公网 HTTPS 证书",
      message,
      detail: `存储路径 / Storage: ${httpsCertStorageDir(options.userDataDir)}`,
      buttons: ["OK"],
      defaultId: 0,
    };
    if (focused) {
      await dialog.showMessageBox(focused, boxOptions);
    } else {
      await dialog.showMessageBox(boxOptions);
    }
    const next: HttpsCertMeta = { ...meta!, lastWarnedNotAfter: notAfter };
    await updateHttpsMeta(next);
    return next;
  }

  async function startListening(secret: LanRemoteSecret): Promise<LanRemoteSecret> {
    currentSecret = secret;
    const started = await startLanRemoteListeners({
      userDataDir: options.userDataDir,
      secret,
      getSecret,
      setSecret: updateSecret,
      onClient: (client) => attachClient(client.socket, client.device.id),
      onCleanup: options.onCleanup,
      onRelaunch: options.onRelaunch,
      previous: listeners,
    });
    listeners = started.bundle;
    await updateSecret(started.secret);
    return started.secret;
  }

  /** 公网证书只改变同一端口上的 SNI 选证，不另开端口，也不关掉内网 HTTP。 */
  async function setPublicHttpsEnabled(enabled: boolean): Promise<LanRemoteSecret> {
    let secret = await readSecret();
    secret = { ...secret, publicHttpsEnabled: enabled === true };
    await updateSecret(secret);
    if (!secret.enabled) return secret;
    return startListening(secret);
  }

  ipcMain.handle(PlatformChannels.GetLanRemoteControlState, async () => {
    const secret = await readSecret();
    let meta = await readHttpsMeta();
    meta = await maybeWarnHttpsCertExpiry(meta);
    return currentState(secret, meta);
  });
  ipcMain.handle(PlatformChannels.SetLanRemoteControlEnabled, async (_event, enabled: unknown) => {
    const secret = await readSecret();
    if (enabled !== true) {
      await stopListening();
      const disabled = { ...secret, enabled: false, enabledChosen: true };
      await updateSecret(disabled);
      return currentState(disabled, await readHttpsMeta());
    }
    const meta = await maybeWarnHttpsCertExpiry(await readHttpsMeta());
    return currentState(await startListening({ ...secret, enabledChosen: true }), meta);
  });
  ipcMain.handle(PlatformChannels.SetLanRemotePublicHttpsEnabled, async (_event, enabled: unknown) => {
    const meta = await maybeWarnHttpsCertExpiry(await readHttpsMeta());
    return currentState(await setPublicHttpsEnabled(enabled === true), meta);
  });
  ipcMain.handle(PlatformChannels.RotateLanRemotePassword, async () => {
    await stopListening();
    const rotated = {
      ...(await rotateLanPassword(await readSecret())),
      enabled: false,
      enabledChosen: true,
      port: 0,
      httpPort: 0,
    };
    await updateSecret(rotated);
    return currentState(rotated, await readHttpsMeta());
  });
  ipcMain.handle(PlatformChannels.RevokeLanRemoteDevice, async (_event, deviceId: unknown) => {
    const secret = revokeLanDevice(await readSecret(), String(deviceId ?? ""));
    closeDevice(String(deviceId ?? ""));
    await updateSecret(secret);
    return currentState(secret, await readHttpsMeta());
  });
  ipcMain.handle(PlatformChannels.ImportLanRemoteHttpsCert, async (_event, rawRequest: unknown) => {
    return handleImportLanRemoteHttpsCert(rawRequest, {
      userDataDir: options.userDataDir,
      secret: await readSecret(),
      currentMeta: await readHttpsMeta(),
      currentState,
      updateSecret,
      updateHttpsMeta,
      restartPublicHttpsIfNeeded: async (secret) => {
        if (!secret.enabled || !secret.publicHttpsEnabled) return secret;
        return setPublicHttpsEnabled(true);
      },
    });
  });

  void Promise.all([readSecret(), readHttpsMeta()]).then(async ([loaded, meta]) => {
    const preferred = preferDefaultLanRemoteEnabled(loaded);
    if (preferred !== loaded) await updateSecret(preferred);
    const secret = preferred;
    if (secret.enabled) {
      try {
        await maybeWarnHttpsCertExpiry(meta);
        await startListening(secret);
      } catch (error) {
        desktopLogger.warn("[lan-remote] failed to resume listener", error);
      }
    } else {
      void maybeWarnHttpsCertExpiry(meta).catch(() => undefined);
    }
  });

  return {
    async stop() {
      ipcMain.removeHandler(PlatformChannels.GetLanRemoteControlState);
      ipcMain.removeHandler(PlatformChannels.SetLanRemoteControlEnabled);
      ipcMain.removeHandler(PlatformChannels.SetLanRemotePublicHttpsEnabled);
      ipcMain.removeHandler(PlatformChannels.RotateLanRemotePassword);
      ipcMain.removeHandler(PlatformChannels.RevokeLanRemoteDevice);
      ipcMain.removeHandler(PlatformChannels.ImportLanRemoteHttpsCert);
      await stopListening();
    },
  };
}

export function resolveFocusedWindowHost(
  hosts: ReadonlyMap<number, UtilityProcess>,
): UtilityProcess | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  const focusedHost = focused ? hosts.get(focused.webContents.id) : undefined;
  if (focusedHost) return focusedHost;
  return hosts.values().next().value;
}
