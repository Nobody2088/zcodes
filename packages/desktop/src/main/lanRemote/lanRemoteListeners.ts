import { createSocket, type Socket } from "node:dgram";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { logger as desktopLogger } from "../logger.js";
import { startLanRemoteAdvertisement } from "./advertise.js";
import {
  httpsCertStorageDir,
  loadHttpsCertMeta,
  parseHttpsCertificatePem,
  type HttpsCertMeta,
} from "./httpsCert.js";
import { MDNS_ADDRESS, MDNS_PORT, type LanRemoteMdnsSocket } from "./mdns.js";
import {
  LAN_REMOTE_BIND_HOST,
  listPrivateLanIPv4,
  startLanRemoteServer,
  type LanRemoteClient,
  type LanRemoteServer,
  type LanRemoteTlsMaterial,
} from "./server.js";
import { resolveLanWebRoot } from "./resolveLanWebRoot.js";
import {
  regenerateLanSelfSignedCertificate,
  type LanRemoteSecret,
} from "./secret.js";

export interface LanRemoteListenerBundle {
  servers: LanRemoteServer[];
  stopMdns: (() => void) | undefined;
}

export function emptyListenerBundle(): LanRemoteListenerBundle {
  return { servers: [], stopMdns: undefined };
}

export async function closeServers(servers: readonly LanRemoteServer[]): Promise<void> {
  await Promise.all(servers.map((server) => server.close().catch(() => undefined)));
}

/**
 * 若 secret 指纹与已导入公网证书相同，说明历史版本把公网材料写进了局域网 secret，
 * 必须重新生成自签，恢复指纹 pin / Bonjour。
 */
export async function ensureLanSelfSignedSecret(
  userDataDir: string,
  secret: LanRemoteSecret,
): Promise<{ secret: LanRemoteSecret; regenerated: boolean }> {
  const meta = await loadHttpsCertMeta(userDataDir);
  if (!meta || secret.fingerprint !== meta.fingerprint) {
    return { secret, regenerated: false };
  }
  const next = regenerateLanSelfSignedCertificate(secret);
  desktopLogger.info("[lan-remote] regenerated LAN self-signed cert after public-cert overwrite", {
    previousFingerprintPrefix: secret.fingerprint.slice(0, 12),
    fingerprintPrefix: next.fingerprint.slice(0, 12),
  });
  return { secret: next, regenerated: true };
}

export async function loadPublicTlsMaterial(
  userDataDir: string,
): Promise<(LanRemoteTlsMaterial & { meta: HttpsCertMeta }) | null> {
  const meta = await loadHttpsCertMeta(userDataDir);
  if (!meta) return null;
  try {
    const dir = httpsCertStorageDir(userDataDir);
    const certPem = await readFile(join(dir, "fullchain.pem"), "utf8");
    const keyPem = await readFile(join(dir, "privkey.pem"), "utf8");
    const parsed = parseHttpsCertificatePem(certPem, keyPem);
    return {
      certPem: parsed.certPem,
      keyPem: parsed.keyPem,
      domain: parsed.domain,
      meta,
    };
  } catch (error) {
    desktopLogger.warn("[lan-remote] failed to load public https material", error);
    return null;
  }
}

export function openMdnsSocket(): Promise<LanRemoteMdnsSocket> {
  const udp: Socket = createSocket({ type: "udp4", reuseAddr: true });
  const listeners = new Set<(packet: Buffer) => void>();
  const socket: LanRemoteMdnsSocket = {
    send(packet, port, address) {
      try {
        udp.send(packet, port, address);
      } catch {
        // 通告失败不影响已经配对的连接。
      }
    },
    close() {
      udp.close();
    },
    onMessage(listener) {
      listeners.add(listener);
    },
  };
  udp.on("message", (packet) => {
    for (const listener of listeners) listener(packet);
  });
  return new Promise((resolve) => {
    udp.once("error", (error) => {
      desktopLogger.warn("[lan-remote] mdns socket error", error);
      resolve(socket);
    });
    udp.bind(MDNS_PORT, () => {
      try {
        udp.addMembership(MDNS_ADDRESS);
        udp.setMulticastTTL(255);
      } catch (error) {
        desktopLogger.warn("[lan-remote] mdns membership failed", error);
      }
      resolve(socket);
    });
  });
}

/**
 * 启动唯一远控端口（0.0.0.0 + HTTP/TLS peek）。不另开 443 / 第二端口。
 */
export async function startLanRemoteListeners(options: {
  userDataDir: string;
  secret: LanRemoteSecret;
  getSecret: () => LanRemoteSecret;
  setSecret: (secret: LanRemoteSecret) => Promise<void>;
  onClient: (client: LanRemoteClient) => void;
  onCleanup?: (categories: string[]) => Promise<{ removed: number }>;
  onRelaunch?: () => void | Promise<void>;
  previous: LanRemoteListenerBundle;
}): Promise<{ bundle: LanRemoteListenerBundle; secret: LanRemoteSecret }> {
  options.previous.stopMdns?.();
  await closeServers(options.previous.servers);

  let secret = options.secret;
  const ensured = await ensureLanSelfSignedSecret(options.userDataDir, secret);
  secret = ensured.secret;
  if (ensured.regenerated) {
    await options.setSecret(secret);
  }

  const addresses = listPrivateLanIPv4();
  const webRoot = resolveLanWebRoot();
  if (!webRoot) {
    desktopLogger.warn(
      "[lan-remote] lan-web UI missing; phone will not render workspace shell until prepare:lan-web",
    );
  }

  const loadedPublicTls = secret.publicHttpsEnabled
    ? await loadPublicTlsMaterial(options.userDataDir)
    : null;
  const advertisedFingerprint = loadedPublicTls?.meta.fingerprint ?? secret.fingerprint;
  const server = await startLanRemoteServer({
    host: LAN_REMOTE_BIND_HOST,
    port: secret.port > 0 ? secret.port : 0,
    coalesceHttpAndHttps: true,
    advertisedFingerprint,
    publicTls: loadedPublicTls
      ? {
          certPem: loadedPublicTls.certPem,
          keyPem: loadedPublicTls.keyPem,
          domain: loadedPublicTls.domain,
        }
      : null,
    webRoot,
    getSecret: options.getSecret,
    setSecret: options.setSecret,
    onClient: options.onClient,
    onCleanup: options.onCleanup,
    onRelaunch: options.onRelaunch,
  });

  const instanceName =
    hostname()
      .replace(/[^A-Za-z0-9-]/g, "-")
      .slice(0, 40) || "zcode";
  // Bonjour 通告同一端口；fp 仍是自签，局域网 https+pin 可用。
  const stopMdns = await startLanRemoteAdvertisement(
    {
      instanceName,
      hostname: instanceName,
      port: server.port,
      addresses: addresses.length > 0 ? addresses : ["127.0.0.1"],
      deviceId: secret.deviceId,
      fingerprint: advertisedFingerprint,
    },
    {
      openRawSocket: openMdnsSocket,
      onBonjourError: (error) => {
        desktopLogger.warn("[lan-remote] bonjour register failed", error);
      },
    },
  );

  secret = {
    ...secret,
    enabled: true,
    port: server.port,
    // 兼容旧字段：同一端口同时承载 HTTP 与 HTTPS，不再分端口。
    httpPort: server.port,
    publicHttpsPort: server.port,
    publicHttpsEnabled: loadedPublicTls !== null,
  };

  desktopLogger.info("[lan-remote] listening", {
    host: server.host,
    port: server.port,
    publicDomain: loadedPublicTls?.domain ?? null,
    fingerprintPrefix: secret.fingerprint.slice(0, 12),
  });

  return {
    bundle: { servers: [server], stopMdns },
    secret,
  };
}
