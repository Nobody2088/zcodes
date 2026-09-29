import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { X509Certificate } from "node:crypto";
import test from "node:test";
import forge from "node-forge";
import { importHttpsCertificateFromFiles, mapHttpsCertImportError } from "./httpsCert.js";
import { ensureLanSelfSignedSecret } from "./ensureLanSelfSigned.js";
import { normalizeImportRequest } from "./importHttpsCertRequest.js";
import { startLanRemoteServer } from "./server.js";
import {
  createLanRemoteSecret,
  regenerateLanSelfSignedCertificate,
} from "./secret.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function forgeCertAndKey(commonName: string, notAfter: Date): {
  certPem: string;
  keyPem: string;
  fingerprint: string;
} {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(notAfter.getTime() - 30 * MS_PER_DAY);
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: "commonName", value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: commonName }] },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    fingerprint: createHash("sha256").update(der).digest("hex"),
  };
}

function peerCn(port: number, host: string, servername?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host,
        port,
        path: "/lan/v1/info",
        method: "GET",
        servername,
        rejectUnauthorized: false,
      },
      (res) => {
        const cert = res.socket.getPeerCertificate();
        resolve(cert?.subject?.CN ?? "");
        res.resume();
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function httpStatus(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/lan/v1/info", method: "GET" },
      (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("importing public cert does not replace LAN secret fingerprint", async () => {
  const userData = await mkdtemp(join(tmpdir(), "zcode-coexist-"));
  let secret = await createLanRemoteSecret("Desk");
  const lanFingerprint = secret.fingerprint;
  const publicMaterial = forgeCertAndKey("zcode.hunas.cn", new Date("2026-12-21T11:16:22.000Z"));
  const source = await mkdtemp(join(tmpdir(), "zcode-public-"));
  await writeFile(join(source, "cert.pem"), publicMaterial.certPem);
  await writeFile(join(source, "key.pem"), publicMaterial.keyPem);

  await importHttpsCertificateFromFiles(userData, join(source, "cert.pem"), join(source, "key.pem"));
  // 模拟错误历史：曾把公网材料写进 secret。
  secret = {
    ...secret,
    certPem: publicMaterial.certPem,
    keyPem: publicMaterial.keyPem,
    fingerprint: publicMaterial.fingerprint,
  };
  const ensured = await ensureLanSelfSignedSecret(userData, secret);
  assert.equal(ensured.regenerated, true);
  assert.notEqual(ensured.secret.fingerprint, publicMaterial.fingerprint);
  assert.notEqual(ensured.secret.fingerprint, lanFingerprint); // 重新生成，新指纹
  assert.match(ensured.secret.certPem, /BEGIN CERTIFICATE/);
});

test("LAN https and public https can listen with different leaf CNs", async () => {
  let secret = await createLanRemoteSecret("Desk");
  const publicMaterial = forgeCertAndKey("zcode.hunas.cn", new Date("2026-12-21T11:16:22.000Z"));

  const lan = await startLanRemoteServer({
    host: "127.0.0.1",
    port: 0,
    protocol: "https",
    getSecret: () => secret,
    setSecret: async (next) => {
      secret = next;
    },
    onClient: () => undefined,
  });
  const pub = await startLanRemoteServer({
    host: "127.0.0.1",
    port: 0,
    protocol: "https",
    tlsMaterial: { certPem: publicMaterial.certPem, keyPem: publicMaterial.keyPem },
    getSecret: () => secret,
    setSecret: async (next) => {
      secret = next;
    },
    onClient: () => undefined,
  });
  const http = await startLanRemoteServer({
    host: "127.0.0.1",
    port: 0,
    protocol: "http",
    getSecret: () => secret,
    setSecret: async (next) => {
      secret = next;
    },
    onClient: () => undefined,
  });

  try {
    const lanCn = await peerCn(lan.port, "127.0.0.1");
    const pubCn = await peerCn(pub.port, "127.0.0.1", "zcode.hunas.cn");
    assert.equal(lanCn, "zcode-lan.local");
    assert.equal(pubCn, "zcode.hunas.cn");
    assert.notEqual(lan.port, pub.port);
    assert.equal(await httpStatus(http.port), 200);
    // 局域网指纹未被公网材料替换。
    assert.equal(secret.fingerprint.length, 64);
    assert.notEqual(secret.fingerprint, publicMaterial.fingerprint);
  } finally {
    await lan.close();
    await pub.close();
    await http.close();
  }
});

test("mapped port serves plaintext HTTP and public HTTPS on the same socket", async () => {
  let secret = await createLanRemoteSecret("Desk");
  const publicMaterial = forgeCertAndKey("zcode.hunas.cn", new Date("2026-12-21T11:16:22.000Z"));
  const server = await startLanRemoteServer({
    host: "127.0.0.1",
    port: 0,
    coalesceHttpAndHttps: true,
    publicTls: {
      certPem: publicMaterial.certPem,
      keyPem: publicMaterial.keyPem,
      domain: "zcode.hunas.cn",
    },
    getSecret: () => secret,
    setSecret: async (next) => {
      secret = next;
    },
    onClient: () => undefined,
  });
  try {
    assert.equal(await httpStatus(server.port), 200);
    assert.equal(await peerCn(server.port, "127.0.0.1", "zcode.hunas.cn"), "zcode.hunas.cn");
    // 内网按 IP 连接时 SNI 不是域名，也必须出示同一张公网证书，手机指纹才能对上。
    assert.equal(await peerCn(server.port, "127.0.0.1", "192.168.8.219"), "zcode.hunas.cn");
  } finally {
    await server.close();
  }
});

test("cancel import result stays quiet without Certificate import cancelled", () => {
  assert.deepEqual(normalizeImportRequest({ kind: "pickCertificate" }), {
    kind: "pickCertificate",
  });
  const result = { cancelled: true as const };
  assert.doesNotThrow(() => {
    if (result.cancelled) return;
    throw new Error("Certificate import cancelled");
  });
});

test("cert/key mismatch maps to clean errorCode", async () => {
  const matching = forgeCertAndKey("zcode.hunas.cn", new Date("2026-12-21T11:16:22.000Z"));
  const other = forgeCertAndKey("other.example", new Date("2026-12-21T11:16:22.000Z"));
  const source = await mkdtemp(join(tmpdir(), "zcode-mismatch-"));
  const userData = await mkdtemp(join(tmpdir(), "zcode-ud-"));
  const certPath = join(source, "cert.pem");
  const keyPath = join(source, "key.pem");
  await writeFile(certPath, matching.certPem);
  await writeFile(keyPath, other.keyPem);
  await assert.rejects(() => importHttpsCertificateFromFiles(userData, certPath, keyPath), /do not match/i);
  assert.equal(
    mapHttpsCertImportError(new Error("Certificate and private key do not match")),
    "mismatch",
  );
});

test("regenerateLanSelfSignedCertificate changes fingerprint only", async () => {
  const secret = await createLanRemoteSecret("Desk");
  const next = regenerateLanSelfSignedCertificate(secret);
  assert.equal(next.password, secret.password);
  assert.equal(next.deviceId, secret.deviceId);
  assert.notEqual(next.fingerprint, secret.fingerprint);
  const leaf = new X509Certificate(next.certPem);
  assert.match(leaf.subject, /CN=zcode-lan\.local/);
});
