import { spawn, type ChildProcess } from "node:child_process";
import { LAN_REMOTE_PROTOCOL_VERSION, LAN_REMOTE_SERVICE_TYPE } from "@zcode/shared";
import type { LanRemoteAnnouncement } from "./mdns.js";

export function buildLanRemoteDnsSdRegisterArgs(announcement: LanRemoteAnnouncement): string[] {
  return [
    "-R",
    announcement.instanceName,
    LAN_REMOTE_SERVICE_TYPE,
    "local",
    String(announcement.port),
    `id=${announcement.deviceId}`,
    `ver=${LAN_REMOTE_PROTOCOL_VERSION}`,
    `fp=${announcement.fingerprint}`,
  ];
}

/**
 * 通过 macOS `dns-sd -R` 向系统 mDNSResponder 注册服务。
 * iOS Simulator 与本机 NetServiceBrowser 都依赖这条路径，raw UDP 多播不够。
 */
export function registerLanRemoteBonjour(
  announcement: LanRemoteAnnouncement,
  options?: {
    dnsSdPath?: string;
    spawnImpl?: typeof spawn;
    onError?: (error: unknown) => void;
  },
): () => void {
  const spawnImpl = options?.spawnImpl ?? spawn;
  const dnsSdPath = options?.dnsSdPath ?? "dns-sd";
  let child: ChildProcess | undefined;
  let stopped = false;
  try {
    child = spawnImpl(dnsSdPath, buildLanRemoteDnsSdRegisterArgs(announcement), {
      // ignore 避免管道缓冲；错误靠 exit/error 事件上报。
      stdio: ["ignore", "ignore", "ignore"],
      detached: false,
    });
  } catch (error) {
    options?.onError?.(error);
    return () => undefined;
  }

  child.on("error", (error) => {
    options?.onError?.(error);
  });
  child.on("exit", (code, signal) => {
    if (!stopped && code !== 0 && code !== null) {
      options?.onError?.(new Error(`dns-sd exited code=${code} signal=${signal ?? ""}`.trim()));
    }
  });

  return () => {
    if (stopped) return;
    stopped = true;
    if (!child || child.killed) return;
    try {
      child.kill("SIGTERM");
    } catch (error) {
      options?.onError?.(error);
    }
  };
}

export function canUseSystemBonjour(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}
