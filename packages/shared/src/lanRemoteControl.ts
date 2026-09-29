import { z } from "zod";

/** 局域网远控协议版本。通告与 /lan/v1/info 必须一致。 */
export const LAN_REMOTE_PROTOCOL_VERSION = 1;

/** DNS-SD 服务类型，不含 .local。 */
export const LAN_REMOTE_SERVICE_TYPE = "_zcode._tcp";

export const LAN_REMOTE_INFO_PATH = "/lan/v1/info";
export const LAN_REMOTE_PAIR_PATH = "/lan/v1/pair";
export const LAN_REMOTE_WS_PATH = "/lan/v1/ws";
/** 已配对手机请求桌面执行垃圾清理。必须带设备 token。 */
export const LAN_REMOTE_CLEANUP_PATH = "/lan/v1/cleanup";
/** 已配对手机请求桌面重启。必须带设备 token。 */
export const LAN_REMOTE_RELAUNCH_PATH = "/lan/v1/relaunch";

/** 同一来源连续密码失败次数。 */
export const LAN_REMOTE_PAIR_FAILURE_LIMIT = 5;

/** 密码失败锁定时长。 */
export const LAN_REMOTE_PAIR_LOCK_MS = 60_000;

export interface LanRemoteControlDevice {
  id: string;
  name: string;
  createdAt: number;
}

/** 用户导入的公网 HTTPS 证书在设置中的只读摘要。不含私钥或完整 PEM。 */
export interface LanRemoteHttpsCertInfo {
  /** 证书与私钥已落在 userData/https-cert/。 */
  present: boolean;
  /** 公网 HTTPS 监听是否开启。 */
  enabled: boolean;
  /** 公网 HTTPS 绑定端口；未监听时为 0。默认尝试 443。 */
  port: number;
  /** 展示用主域名（DNS SAN 优先，否则 CN）。 */
  domain: string;
  /** 叶证书 notAfter，ISO-8601。 */
  notAfter: string;
  /** 距过期剩余整天数；已过期为负数。 */
  daysRemaining: number;
  expired: boolean;
  /** 绝对存储目录，例如 …/ZCode/https-cert。 */
  storagePath: string;
  /** 叶证书 SHA-256 指纹的前 12 位 hex，便于核对。 */
  fingerprintPrefix: string;
}

export interface LanRemoteControlState {
  enabled: boolean;
  password: string;
  /** 局域网自签证书指纹（Bonjour / 手机 pin）。 */
  fingerprint: string;
  /** 局域网 HTTPS（自签）端口。 */
  port: number;
  /** 局域网明文 HTTP 端口；与 HTTPS 分 socket。 */
  httpPort: number;
  addresses: string[];
  devices: LanRemoteControlDevice[];
  /** 已导入公网证书时非 null；公网监听另由 enabled/port 表示。 */
  httpsCert: LanRemoteHttpsCertInfo | null;
}

/** 公网 HTTPS 默认尝试绑定的端口。 */
export const LAN_REMOTE_PUBLIC_HTTPS_DEFAULT_PORT = 443;

/**
 * 导入 HTTPS 证书请求。主路径为分别指定证书与私钥文件；
 * 次要路径为 ACME 目录。省略路径时由 Main 弹出对应对话框。
 */
export type ImportLanRemoteHttpsCertRequest =
  | {
      /** 主路径：分别选择证书与私钥文件。 */
      kind?: "files";
      certPath?: string;
      keyPath?: string;
    }
  | {
      /** 次要路径：从目录识别 fullchain + privkey。 */
      kind: "directory";
      directoryPath?: string;
    }
  | {
      /** 仅弹出选择对话框并返回路径，不导入。 */
      kind: "pickCertificate" | "pickPrivateKey" | "pickDirectory";
    };

/** 导入失败时设置页用 i18n 映射的机器可读错误码。 */
export type ImportLanRemoteHttpsCertErrorCode =
  | "missing_cert"
  | "missing_key"
  | "invalid_cert"
  | "invalid_key"
  | "mismatch"
  | "not_found"
  | "unknown";

/**
 * 导入 HTTPS 证书结果。取消对话框时 cancelled=true 且不改写存储；
 * 校验失败时带 errorCode，不抛 remote-method 异常。
 */
export interface ImportLanRemoteHttpsCertResult {
  state: LanRemoteControlState;
  /** 用户取消了文件/目录对话框；存储未改。 */
  cancelled?: boolean;
  /** 仅 pick* 动作成功时为所选绝对路径。 */
  pickedPath?: string;
  /** 校验/读写失败；与 cancelled 互斥。 */
  errorCode?: ImportLanRemoteHttpsCertErrorCode;
}

/** 距过期 ≤ 该天数（含已过期）时提醒续期。 */
export const LAN_REMOTE_HTTPS_CERT_WARN_DAYS = 15;

/** userData 下存放导入证书的子目录名。 */
export const LAN_REMOTE_HTTPS_CERT_DIR = "https-cert";

/**
 * 是否应弹出续期提醒。同一 notAfter 只提醒一次，直到证书被替换。
 * 16 天及以上不提醒；15 天及以内（含已过期）提醒。
 */
export function shouldWarnHttpsCertExpiry(options: {
  notAfterMs: number;
  nowMs: number;
  lastWarnedNotAfter: string | null | undefined;
}): boolean {
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.floor((options.notAfterMs - options.nowMs) / msPerDay);
  if (daysRemaining > LAN_REMOTE_HTTPS_CERT_WARN_DAYS) {
    return false;
  }
  const notAfterIso = new Date(options.notAfterMs).toISOString();
  return options.lastWarnedNotAfter !== notAfterIso;
}

/** 由 notAfter 与当前时间计算剩余整天数（已过期为负）。 */
export function httpsCertDaysRemaining(notAfterMs: number, nowMs: number): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((notAfterMs - nowMs) / msPerDay);
}

export const lanRemoteInfoSchema = z
  .object({
    protocolVersion: z.literal(LAN_REMOTE_PROTOCOL_VERSION),
    deviceId: z.string().min(1),
    displayName: z.string().min(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    authRequired: z.literal(true),
  })
  .strict();

export type LanRemoteInfo = z.infer<typeof lanRemoteInfoSchema>;

export const lanRemotePairRequestSchema = z
  .object({
    password: z.string().max(200),
    clientId: z.string().min(1).max(128),
    clientName: z.string().min(1).max(80),
  })
  .strict();

export type LanRemotePairRequest = z.infer<typeof lanRemotePairRequestSchema>;

export const lanRemoteAuthMessageSchema = z
  .object({
    type: z.literal("auth"),
    token: z.string().min(1).max(512),
  })
  .strict();

export function normalizeRemoteAddress(address: string | undefined): string {
  if (!address) return "";
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

/** 内网私网地址允许空密码配对。回环和公网仍要密码。 */
export function isLanPasswordlessPair(remoteAddress: string | undefined): boolean {
  return isPrivateLanIPv4(normalizeRemoteAddress(remoteAddress));
}

export function isPrivateLanIPv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  return false;
}

/** 单层目录名。拒绝路径分隔符，避免一次调用写出多级或逃出父目录。 */
export function isHostFolderName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed !== "." &&
    trimmed !== ".." &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    !trimmed.includes("\0")
  );
}
