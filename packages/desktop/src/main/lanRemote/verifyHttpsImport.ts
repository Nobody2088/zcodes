/**
 * 验证：导入测试 ACME 证书目录 → 启动局域网 HTTPS 监听 → TLS 校验叶 CN。
 * 不打印私钥或完整 PEM。
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { X509Certificate } from "node:crypto";
import { importHttpsCertificateFromDirectory } from "./httpsCert.js";
import { createLanRemoteSecret } from "./secret.js";
import { startLanRemoteServer } from "./server.js";

const SOURCE =
  process.env.ZCODE_HTTPS_CERT_DIR?.trim() ||
  "/Users/jacky/Downloads/192.168.8.141/202609222016/zcode.hunas.cn";

async function main(): Promise<void> {
  const userData = await mkdtemp(join(tmpdir(), "zcode-https-verify-"));
  const { parsed, meta } = await importHttpsCertificateFromDirectory(userData, SOURCE);
  console.log(
    JSON.stringify({
      domain: parsed.domain,
      notAfter: meta.notAfter,
      fingerprintPrefix: parsed.fingerprint.slice(0, 12),
      storagePath: join(userData, "https-cert"),
    }),
  );

  let secret = await createLanRemoteSecret("verify");
  secret = {
    ...secret,
    certPem: parsed.certPem,
    keyPem: parsed.keyPem,
    fingerprint: parsed.fingerprint,
    enabled: true,
  };

  const server = await startLanRemoteServer({
    host: "127.0.0.1",
    port: 0,
    getSecret: () => secret,
    setSecret: async (next) => {
      secret = next;
    },
    onClient: () => undefined,
  });

  const port = server.port;
  const peer = await new Promise<{
    status?: number;
    subject: string;
    authorized: boolean;
    authorizationError?: string;
  }>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/lan/v1/info",
        method: "GET",
        servername: "zcode.hunas.cn",
        // 系统信任库 + 完整链：不应关闭 TLS 校验。
        rejectUnauthorized: true,
        headers: { host: "zcode.hunas.cn" },
      },
      (res) => {
        const cert = res.socket.getPeerCertificate();
        resolve({
          status: res.statusCode,
          subject: cert?.subject?.CN ?? "",
          authorized: (res.socket as { authorized?: boolean }).authorized === true,
          authorizationError: (res.socket as { authorizationError?: Error }).authorizationError
            ?.message,
        });
        res.resume();
      },
    );
    req.on("error", reject);
    req.end();
  });

  const leafPem =
    parsed.certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0] ?? "";
  const leaf = new X509Certificate(leafPem);

  console.log(
    JSON.stringify({
      boundPort: port,
      httpStatus: peer.status,
      peerSubjectCN: peer.subject,
      tlsAuthorized: peer.authorized,
      tlsAuthError: peer.authorizationError ?? null,
      leafSubject: leaf.subject,
      leafValidTo: leaf.validTo,
    }),
  );

  const { spawn } = await import("node:child_process");
  // 不能用 spawnSync：会卡住事件循环，TLS 握手无法完成。
  const curlHttpCode = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "curl",
      [
        "-sS",
        "--max-time",
        "8",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "--resolve",
        `zcode.hunas.cn:${port}:127.0.0.1`,
        `https://zcode.hunas.cn:${port}/lan/v1/info`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl exit ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
  console.log(JSON.stringify({ curlHttpCode }));

  await server.close();

  if (parsed.domain !== "zcode.hunas.cn") {
    throw new Error(`unexpected domain ${parsed.domain}`);
  }
  if (peer.subject !== "zcode.hunas.cn" && !leaf.subject.includes("CN=zcode.hunas.cn")) {
    throw new Error("leaf CN mismatch");
  }
  if (peer.status !== 200) {
    throw new Error(`unexpected status ${peer.status}`);
  }
  if (!peer.authorized) {
    throw new Error(`TLS not authorized: ${peer.authorizationError ?? "unknown"}`);
  }
  if (curlHttpCode !== "200") {
    throw new Error(`curl http code ${curlHttpCode}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
