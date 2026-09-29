import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import forge from "node-forge";
import {
  LAN_REMOTE_HTTPS_CERT_DIR,
  httpsCertDaysRemaining,
  shouldWarnHttpsCertExpiry,
  type ImportLanRemoteHttpsCertErrorCode,
  type LanRemoteHttpsCertInfo,
} from "@zcode/shared";

export interface ParsedHttpsCertificate {
  /** 完整证书链 PEM（叶在前）。 */
  certPem: string;
  keyPem: string;
  domain: string;
  notAfter: Date;
  /** 叶证书 SHA-256 hex。 */
  fingerprint: string;
}

export interface HttpsCertMeta {
  domain: string;
  notAfter: string;
  fingerprint: string;
  lastWarnedNotAfter?: string | null;
}

const FULLCHAIN_NAME = "fullchain.pem";
const PRIVKEY_NAME = "privkey.pem";
const META_NAME = "meta.json";

const CERT_CANDIDATES = ["fullchain.pem", "fullchain.cer", "cert.pem", "cert.cer"];
const KEY_CANDIDATES = ["privkey.pem", "key.pem"];

export function httpsCertStorageDir(userDataDir: string): string {
  return join(userDataDir, LAN_REMOTE_HTTPS_CERT_DIR);
}

function leafPemFromChain(chainPem: string): string {
  const match = chainPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  if (!match) {
    throw new Error("Certificate PEM has no leaf certificate");
  }
  return match[0];
}

function fingerprintOfCert(cert: forge.pki.Certificate): string {
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
  return createHash("sha256").update(der).digest("hex");
}

function primaryDomainFromCert(cert: forge.pki.Certificate): string {
  const sans: string[] = [];
  const ext = cert.getExtension("subjectAltName") as
    | { altNames?: Array<{ type?: number; value?: string }> }
    | null
    | undefined;
  for (const alt of ext?.altNames ?? []) {
    if (alt.type === 2 && typeof alt.value === "string" && alt.value.trim()) {
      sans.push(alt.value.trim());
    }
  }
  if (sans.length > 0) {
    return sans[0]!;
  }
  const cn = cert.subject.getField("CN");
  const value = typeof cn?.value === "string" ? cn.value.trim() : "";
  if (!value) {
    throw new Error("Certificate has no DNS SAN or CN");
  }
  return value;
}

function publicKeysMatch(
  cert: forge.pki.Certificate,
  privateKey: forge.pki.PrivateKey,
): boolean {
  const certPem = forge.pki.publicKeyToPem(cert.publicKey);
  const fromPrivate = forge.pki.publicKeyToPem(
    forge.pki.rsa.setPublicKey(
      (privateKey as forge.pki.rsa.PrivateKey).n,
      (privateKey as forge.pki.rsa.PrivateKey).e,
    ),
  );
  return certPem === fromPrivate;
}

/** 解析证书链 + 私钥 PEM；不匹配或无效时抛错。 */
export function parseHttpsCertificatePem(certPem: string, keyPem: string): ParsedHttpsCertificate {
  let privateKey: forge.pki.PrivateKey;
  try {
    privateKey = forge.pki.privateKeyFromPem(keyPem);
  } catch {
    throw new Error("Invalid private key PEM");
  }
  let leaf: forge.pki.Certificate;
  try {
    leaf = forge.pki.certificateFromPem(leafPemFromChain(certPem));
  } catch {
    throw new Error("Invalid certificate PEM");
  }
  if (!publicKeysMatch(leaf, privateKey)) {
    throw new Error("Certificate and private key do not match");
  }
  return {
    certPem: certPem.trim() + "\n",
    keyPem: keyPem.trim() + "\n",
    domain: primaryDomainFromCert(leaf),
    notAfter: leaf.validity.notAfter,
    fingerprint: fingerprintOfCert(leaf),
  };
}

async function pickFile(directory: string, preferred: string[], fallback: (name: string) => boolean): Promise<string> {
  const names = await readdir(directory);
  for (const name of preferred) {
    if (names.includes(name)) {
      return join(directory, name);
    }
  }
  const match = names.find(fallback);
  if (!match) {
    throw new Error("Certificate or private key file not found in directory");
  }
  return join(directory, match);
}

/** 从 ACME/常见布局目录读取证书与私钥。 */
export async function readHttpsCertificateDirectory(directory: string): Promise<ParsedHttpsCertificate> {
  const certPath = await pickFile(directory, CERT_CANDIDATES, (name) => {
    const lower = name.toLowerCase();
    return (
      (lower.endsWith(".pem") || lower.endsWith(".cer") || lower.endsWith(".crt")) &&
      !lower.includes("key") &&
      !lower.includes("priv")
    );
  });
  const keyPath = await pickFile(directory, KEY_CANDIDATES, (name) => {
    const lower = name.toLowerCase();
    return lower.endsWith(".key") || lower === "privkey.pem" || lower.includes("key");
  });
  const certPem = await readFile(certPath, "utf8");
  const keyPem = await readFile(keyPath, "utf8");
  return parseHttpsCertificatePem(certPem, keyPem);
}

export async function loadHttpsCertMeta(userDataDir: string): Promise<HttpsCertMeta | null> {
  try {
    const raw = await readFile(join(httpsCertStorageDir(userDataDir), META_NAME), "utf8");
    const parsed = JSON.parse(raw) as HttpsCertMeta;
    if (!parsed.domain || !parsed.notAfter || !parsed.fingerprint) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveHttpsCertMeta(userDataDir: string, meta: HttpsCertMeta): Promise<void> {
  const dir = httpsCertStorageDir(userDataDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, META_NAME), JSON.stringify(meta, null, 2), { mode: 0o600 });
}

/**
 * 把解析后的证书写入 userData/https-cert/，覆盖旧文件。
 * 私钥 mode 0600。不记录私钥或完整 PEM。
 */
export async function storeImportedHttpsCertificate(
  userDataDir: string,
  parsed: ParsedHttpsCertificate,
  previousMeta?: HttpsCertMeta | null,
): Promise<HttpsCertMeta> {
  const dir = httpsCertStorageDir(userDataDir);
  await mkdir(dir, { recursive: true });
  const fullchainPath = join(dir, FULLCHAIN_NAME);
  const privkeyPath = join(dir, PRIVKEY_NAME);
  await writeFile(fullchainPath, parsed.certPem, { mode: 0o600 });
  await writeFile(privkeyPath, parsed.keyPem, { mode: 0o600 });
  await chmod(privkeyPath, 0o600);
  const notAfterIso = parsed.notAfter.toISOString();
  const meta: HttpsCertMeta = {
    domain: parsed.domain,
    notAfter: notAfterIso,
    fingerprint: parsed.fingerprint,
    // 新证书重置提醒；同一 notAfter 保留上次提醒记录。
    lastWarnedNotAfter:
      previousMeta?.notAfter === notAfterIso ? (previousMeta.lastWarnedNotAfter ?? null) : null,
  };
  await saveHttpsCertMeta(userDataDir, meta);
  return meta;
}

/** 从指定证书与私钥文件导入并落盘。 */
export async function importHttpsCertificateFromFiles(
  userDataDir: string,
  certPath: string,
  keyPath: string,
): Promise<{ parsed: ParsedHttpsCertificate; meta: HttpsCertMeta }> {
  const certPem = await readFile(certPath, "utf8");
  const keyPem = await readFile(keyPath, "utf8");
  const parsed = parseHttpsCertificatePem(certPem, keyPem);
  const previous = await loadHttpsCertMeta(userDataDir);
  const meta = await storeImportedHttpsCertificate(userDataDir, parsed, previous);
  return { parsed, meta };
}

export async function importHttpsCertificateFromDirectory(
  userDataDir: string,
  sourceDirectory: string,
): Promise<{ parsed: ParsedHttpsCertificate; meta: HttpsCertMeta }> {
  const parsed = await readHttpsCertificateDirectory(sourceDirectory);
  const previous = await loadHttpsCertMeta(userDataDir);
  const meta = await storeImportedHttpsCertificate(userDataDir, parsed, previous);
  return { parsed, meta };
}

/** 将解析/读写错误映射为设置页 i18n 错误码；不暴露 PEM。 */
export function mapHttpsCertImportError(error: unknown): ImportLanRemoteHttpsCertErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/Certificate and private key do not match/i.test(message)) return "mismatch";
  if (/Invalid private key PEM/i.test(message)) return "invalid_key";
  if (/Invalid certificate PEM/i.test(message)) return "invalid_cert";
  if (/Certificate PEM has no leaf/i.test(message)) return "invalid_cert";
  if (/Certificate has no DNS SAN or CN/i.test(message)) return "invalid_cert";
  if (/not found in directory/i.test(message)) return "not_found";
  if (/ENOENT|no such file/i.test(message)) return "not_found";
  return "unknown";
}

export function toLanRemoteHttpsCertInfo(
  userDataDir: string,
  meta: HttpsCertMeta | null,
  options: { enabled?: boolean; port?: number; nowMs?: number } = {},
): LanRemoteHttpsCertInfo | null {
  if (!meta) return null;
  const nowMs = options.nowMs ?? Date.now();
  const notAfterMs = Date.parse(meta.notAfter);
  if (!Number.isFinite(notAfterMs)) return null;
  const daysRemaining = httpsCertDaysRemaining(notAfterMs, nowMs);
  return {
    present: true,
    enabled: options.enabled === true,
    port: options.enabled === true ? (options.port ?? 0) : 0,
    domain: meta.domain,
    notAfter: meta.notAfter,
    daysRemaining,
    expired: daysRemaining < 0,
    storagePath: httpsCertStorageDir(userDataDir),
    fingerprintPrefix: meta.fingerprint.slice(0, 12),
  };
}

export function needsHttpsCertExpiryWarning(
  meta: HttpsCertMeta | null,
  nowMs = Date.now(),
): boolean {
  if (!meta) return false;
  const notAfterMs = Date.parse(meta.notAfter);
  if (!Number.isFinite(notAfterMs)) return false;
  return shouldWarnHttpsCertExpiry({
    notAfterMs,
    nowMs,
    lastWarnedNotAfter: meta.lastWarnedNotAfter,
  });
}
