import type { ImportLanRemoteHttpsCertRequest } from "@zcode/shared";

/** 兼容旧调用：字符串视为 directoryPath；缺省为主路径 files。 */
export function normalizeImportRequest(raw: unknown): ImportLanRemoteHttpsCertRequest {
  if (typeof raw === "string") {
    const directoryPath = raw.trim();
    return directoryPath.length > 0
      ? { kind: "directory", directoryPath }
      : { kind: "directory" };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const kind = obj.kind;
    if (kind === "pickCertificate" || kind === "pickPrivateKey" || kind === "pickDirectory") {
      return { kind };
    }
    if (kind === "directory") {
      return {
        kind: "directory",
        directoryPath: typeof obj.directoryPath === "string" ? obj.directoryPath : undefined,
      };
    }
    return {
      kind: "files",
      certPath: typeof obj.certPath === "string" ? obj.certPath : undefined,
      keyPath: typeof obj.keyPath === "string" ? obj.keyPath : undefined,
    };
  }
  return { kind: "files" };
}
