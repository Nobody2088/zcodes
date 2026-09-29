import { logger as desktopLogger } from "../logger.js";
import { loadHttpsCertMeta } from "./httpsCert.js";
import {
  regenerateLanSelfSignedCertificate,
  type LanRemoteSecret,
} from "./secret.js";

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
