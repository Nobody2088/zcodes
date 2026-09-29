import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type {
  ImportLanRemoteHttpsCertResult,
  LanRemoteControlState,
} from "@zcode/shared";
import { logger as desktopLogger } from "../logger.js";
import {
  httpsCertStorageDir,
  importHttpsCertificateFromDirectory,
  importHttpsCertificateFromFiles,
  mapHttpsCertImportError,
  type HttpsCertMeta,
  type ParsedHttpsCertificate,
} from "./httpsCert.js";
import { normalizeImportRequest } from "./importHttpsCertRequest.js";
import type { LanRemoteSecret } from "./secret.js";

async function showOpen(options: OpenDialogOptions): Promise<string | null> {
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showOpenDialog(focused, options)
    : await dialog.showOpenDialog(options);
  // 取消对话框：安静返回，不抛 Certificate import cancelled。
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0] ?? null;
}

const CERT_FILTERS: OpenDialogOptions["filters"] = [
  { name: "Certificate", extensions: ["pem", "crt", "cer"] },
  { name: "All Files", extensions: ["*"] },
];

const KEY_FILTERS: OpenDialogOptions["filters"] = [
  { name: "Private Key", extensions: ["pem", "key"] },
  { name: "All Files", extensions: ["*"] },
];

export interface HandleImportHttpsCertDeps {
  userDataDir: string;
  secret: LanRemoteSecret;
  currentMeta: HttpsCertMeta | null;
  currentState: (secret: LanRemoteSecret, meta: HttpsCertMeta | null) => LanRemoteControlState;
  updateHttpsMeta: (meta: HttpsCertMeta) => Promise<void>;
  /** 远控已开启时热重载同一端口上的 SNI 材料，不改端口、不关 HTTP。 */
  reloadListenersIfNeeded: (secret: LanRemoteSecret) => Promise<LanRemoteSecret>;
}

/**
 * 处理导入 HTTPS 证书 IPC。取消任一对话框返回 cancelled，不抛错、不改写存储。
 * 成功只写入 https-cert/，不替换局域网自签 secret。
 */
export async function handleImportLanRemoteHttpsCert(
  rawRequest: unknown,
  deps: HandleImportHttpsCertDeps,
): Promise<ImportLanRemoteHttpsCertResult> {
  const unchanged = (): ImportLanRemoteHttpsCertResult => ({
    state: deps.currentState(deps.secret, deps.currentMeta),
  });
  const request = normalizeImportRequest(rawRequest);

  if (request.kind === "pickCertificate") {
    const pickedPath = await showOpen({
      properties: ["openFile"],
      title: "Select HTTPS certificate / 选择 HTTPS 证书",
      filters: CERT_FILTERS,
    });
    if (!pickedPath) return { ...unchanged(), cancelled: true };
    return { ...unchanged(), pickedPath };
  }

  if (request.kind === "pickPrivateKey") {
    const pickedPath = await showOpen({
      properties: ["openFile"],
      title: "Select private key / 选择私钥",
      filters: KEY_FILTERS,
    });
    if (!pickedPath) return { ...unchanged(), cancelled: true };
    return { ...unchanged(), pickedPath };
  }

  if (request.kind === "pickDirectory") {
    const pickedPath = await showOpen({
      properties: ["openDirectory"],
      title: "Select HTTPS certificate directory / 选择证书目录",
    });
    if (!pickedPath) return { ...unchanged(), cancelled: true };
    return { ...unchanged(), pickedPath };
  }

  try {
    let parsed: ParsedHttpsCertificate;
    let meta: HttpsCertMeta;

    if (request.kind === "directory") {
      let source = request.directoryPath?.trim() ?? "";
      if (!source) {
        const picked = await showOpen({
          properties: ["openDirectory"],
          title: "Select HTTPS certificate directory / 选择证书目录",
        });
        if (!picked) return { ...unchanged(), cancelled: true };
        source = picked;
      }
      ({ parsed, meta } = await importHttpsCertificateFromDirectory(deps.userDataDir, source));
    } else {
      let certPath = request.certPath?.trim() ?? "";
      let keyPath = request.keyPath?.trim() ?? "";
      if (!certPath) {
        const picked = await showOpen({
          properties: ["openFile"],
          title: "Select HTTPS certificate / 选择 HTTPS 证书",
          filters: CERT_FILTERS,
        });
        if (!picked) return { ...unchanged(), cancelled: true };
        certPath = picked;
      }
      if (!keyPath) {
        const picked = await showOpen({
          properties: ["openFile"],
          title: "Select private key / 选择私钥",
          filters: KEY_FILTERS,
        });
        if (!picked) return { ...unchanged(), cancelled: true };
        keyPath = picked;
      }
      if (!certPath) return { ...unchanged(), errorCode: "missing_cert" };
      if (!keyPath) return { ...unchanged(), errorCode: "missing_key" };
      ({ parsed, meta } = await importHttpsCertificateFromFiles(
        deps.userDataDir,
        certPath,
        keyPath,
      ));
    }

    desktopLogger.info("[lan-remote] imported public https certificate", {
      domain: parsed.domain,
      notAfter: parsed.notAfter.toISOString(),
      fingerprintPrefix: parsed.fingerprint.slice(0, 12),
      storagePath: httpsCertStorageDir(deps.userDataDir),
      lanFingerprintPrefix: deps.secret.fingerprint.slice(0, 12),
    });
    // 只落盘公网材料；局域网 secret.certPem / fingerprint 保持自签。
    await deps.updateHttpsMeta(meta);
    const nextSecret = await deps.reloadListenersIfNeeded(deps.secret);
    return { state: deps.currentState(nextSecret, meta) };
  } catch (error) {
    desktopLogger.warn("[lan-remote] https certificate import failed", {
      errorCode: mapHttpsCertImportError(error),
    });
    return { ...unchanged(), errorCode: mapHttpsCertImportError(error) };
  }
}
