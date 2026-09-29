import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import type { LanRemoteControlState, LanRemoteHttpsCertInfo } from "@zcode/shared";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface LanRemoteTrustedDevice {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  revoked: boolean;
}

export interface LanRemoteSecret {
  deviceId: string;
  displayName: string;
  enabled: boolean;
  /** 用户在设置里拨过开关后为 true。缺省且 enabled 为 false 时按默认开启。 */
  enabledChosen?: boolean;
  /** 局域网 HTTPS（自签）端口。 */
  port: number;
  /** 局域网明文 HTTP 端口。 */
  httpPort: number;
  /** 公网 HTTPS 是否开启（导入证书）。 */
  publicHttpsEnabled: boolean;
  /** 公网 HTTPS 端口；优先 443。 */
  publicHttpsPort: number;
  password: string;
  passwordSaltB64: string;
  passwordHashB64: string;
  /** 局域网自签证书材料；不得被公网导入覆盖。 */
  certPem: string;
  keyPem: string;
  fingerprint: string;
  devices: LanRemoteTrustedDevice[];
}

export function createLanPassword(): string {
  const bytes = randomBytes(8);
  let password = "";
  for (const byte of bytes) {
    password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  }
  return password;
}

export async function hashLanPassword(password: string, salt: Buffer): Promise<string> {
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, (error, derived) => (error ? reject(error) : resolve(derived)));
  });
  return hash.toString("base64url");
}

export async function verifyLanPassword(
  secret: LanRemoteSecret,
  password: string,
): Promise<boolean> {
  const actual = await hashLanPassword(password, Buffer.from(secret.passwordSaltB64, "base64url"));
  const expected = Buffer.from(secret.passwordHashB64, "base64url");
  const received = Buffer.from(actual, "base64url");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export function hashLanToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function findActiveDevice(
  secret: LanRemoteSecret,
  token: string,
): LanRemoteTrustedDevice | undefined {
  const hash = hashLanToken(token);
  const received = Buffer.from(hash);
  let found: LanRemoteTrustedDevice | undefined;
  for (const device of secret.devices) {
    const expected = Buffer.from(device.tokenHash);
    const matches =
      !device.revoked && expected.length === received.length && timingSafeEqual(expected, received);
    if (matches) found = device;
  }
  return found;
}

function createCertificate(): { certPem: string; keyPem: string; fingerprint: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  const serial = randomBytes(16);
  serial[0] = serial[0]! & 0x7f;
  cert.serialNumber = serial.toString("hex");
  const notBefore = new Date();
  const notAfter = new Date(notBefore);
  notAfter.setFullYear(notAfter.getFullYear() + 10);
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: "commonName", value: "zcode-lan.local" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: "zcode-lan.local" }] },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    fingerprint: createHash("sha256").update(der).digest("hex"),
  };
}

export async function createLanRemoteSecret(displayName = hostname()): Promise<LanRemoteSecret> {
  const password = createLanPassword();
  const salt = randomBytes(16);
  const certificate = createCertificate();
  return {
    deviceId: randomUUID(),
    displayName,
    enabled: true,
    port: 0,
    httpPort: 0,
    publicHttpsEnabled: false,
    publicHttpsPort: 0,
    password,
    passwordSaltB64: salt.toString("base64url"),
    passwordHashB64: await hashLanPassword(password, salt),
    certPem: certificate.certPem,
    keyPem: certificate.keyPem,
    fingerprint: certificate.fingerprint,
    devices: [],
  };
}

/** 重新生成局域网自签证书，不改密码/设备列表。用于修复曾被公网证书覆盖的 secret。 */
export function regenerateLanSelfSignedCertificate(secret: LanRemoteSecret): LanRemoteSecret {
  const certificate = createCertificate();
  return {
    ...secret,
    certPem: certificate.certPem,
    keyPem: certificate.keyPem,
    fingerprint: certificate.fingerprint,
  };
}

export async function rotateLanPassword(secret: LanRemoteSecret): Promise<LanRemoteSecret> {
  const password = createLanPassword();
  const salt = randomBytes(16);
  return {
    ...secret,
    password,
    passwordSaltB64: salt.toString("base64url"),
    passwordHashB64: await hashLanPassword(password, salt),
    devices: [],
  };
}

export function issueLanDeviceToken(
  secret: LanRemoteSecret,
  clientId: string,
  clientName: string,
): { secret: LanRemoteSecret; token: string; device: LanRemoteTrustedDevice } {
  const token = randomBytes(32).toString("base64url");
  const device: LanRemoteTrustedDevice = {
    id: clientId,
    name: clientName,
    tokenHash: hashLanToken(token),
    createdAt: Date.now(),
    revoked: false,
  };
  return {
    token,
    device,
    secret: {
      ...secret,
      devices: [...secret.devices.filter((entry) => entry.id !== clientId), device],
    },
  };
}

export function revokeLanDevice(secret: LanRemoteSecret, deviceId: string): LanRemoteSecret {
  return {
    ...secret,
    devices: secret.devices.map((device) =>
      device.id === deviceId ? { ...device, revoked: true } : device,
    ),
  };
}

/** 没被用户关过的局域网控制按默认开启。已经拨过开关的，保留最后一次。 */
export function preferDefaultLanRemoteEnabled(secret: LanRemoteSecret): LanRemoteSecret {
  if (secret.enabledChosen === true || secret.enabled === true) return secret;
  return { ...secret, enabled: true };
}

export function toLanRemoteControlState(
  secret: LanRemoteSecret,
  addresses: string[],
  httpsCert: LanRemoteHttpsCertInfo | null = null,
): LanRemoteControlState {
  return {
    enabled: secret.enabled,
    password: secret.password,
    fingerprint: secret.fingerprint,
    port: secret.enabled ? secret.port : 0,
    httpPort: secret.enabled ? secret.httpPort : 0,
    addresses,
    devices: secret.devices
      .filter((device) => !device.revoked)
      .map((device) => ({ id: device.id, name: device.name, createdAt: device.createdAt })),
    httpsCert,
  };
}

const SECRET_FILE = "lan-remote-control.json";

function normalizeSecret(parsed: LanRemoteSecret): LanRemoteSecret {
  return {
    ...parsed,
    devices: parsed.devices ?? [],
    httpPort: typeof parsed.httpPort === "number" ? parsed.httpPort : 0,
    publicHttpsEnabled: parsed.publicHttpsEnabled === true,
    publicHttpsPort: typeof parsed.publicHttpsPort === "number" ? parsed.publicHttpsPort : 0,
  };
}

export async function loadLanRemoteSecret(directory: string): Promise<LanRemoteSecret> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, SECRET_FILE);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as LanRemoteSecret;
    if (!parsed.deviceId || !parsed.passwordHashB64 || !parsed.certPem || !parsed.fingerprint) {
      throw new Error("incomplete lan remote secret");
    }
    return normalizeSecret(parsed);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // 缺失或损坏时重新生成。权限错误继续抛出，避免悄悄换掉用户已经记下的密码。
    if (code && code !== "ENOENT") throw error;
    const created = await createLanRemoteSecret();
    await saveLanRemoteSecret(directory, created);
    return created;
  }
}

export async function saveLanRemoteSecret(
  directory: string,
  secret: LanRemoteSecret,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, SECRET_FILE), JSON.stringify(secret), { mode: 0o600 });
}
