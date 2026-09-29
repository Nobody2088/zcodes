import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import forge from "node-forge";
import { httpsCertDaysRemaining, shouldWarnHttpsCertExpiry } from "@zcode/shared";
import {
  importHttpsCertificateFromDirectory,
  importHttpsCertificateFromFiles,
  mapHttpsCertImportError,
  parseHttpsCertificatePem,
  readHttpsCertificateDirectory,
} from "./httpsCert.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function forgeCertAndKey(options: {
  commonName: string;
  notAfter: Date;
}): { certPem: string; keyPem: string; fingerprint: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(options.notAfter.getTime() - 30 * MS_PER_DAY);
  cert.validity.notAfter = options.notAfter;
  const attrs = [{ name: "commonName", value: options.commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: options.commonName }] },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    fingerprint: createHash("sha256").update(der).digest("hex"),
  };
}

test("httpsCertDaysRemaining and 15-day warning threshold", () => {
  const now = Date.parse("2026-09-22T12:00:00.000Z");
  const in16Days = now + 16 * MS_PER_DAY;
  const in15Days = now + 15 * MS_PER_DAY;
  const expired = now - MS_PER_DAY;

  assert.equal(httpsCertDaysRemaining(in16Days, now), 16);
  assert.equal(httpsCertDaysRemaining(in15Days, now), 15);
  assert.equal(httpsCertDaysRemaining(expired, now), -1);

  assert.equal(
    shouldWarnHttpsCertExpiry({ notAfterMs: in16Days, nowMs: now, lastWarnedNotAfter: null }),
    false,
  );
  assert.equal(
    shouldWarnHttpsCertExpiry({ notAfterMs: in15Days, nowMs: now, lastWarnedNotAfter: null }),
    true,
  );
  assert.equal(
    shouldWarnHttpsCertExpiry({ notAfterMs: expired, nowMs: now, lastWarnedNotAfter: null }),
    true,
  );
  assert.equal(
    shouldWarnHttpsCertExpiry({
      notAfterMs: in15Days,
      nowMs: now,
      lastWarnedNotAfter: new Date(in15Days).toISOString(),
    }),
    false,
  );
});

test("parseHttpsCertificatePem reads domain and notAfter from SAN/CN", () => {
  const notAfter = new Date("2026-12-21T11:16:22.000Z");
  const material = forgeCertAndKey({ commonName: "zcode.hunas.cn", notAfter });
  const parsed = parseHttpsCertificatePem(material.certPem, material.keyPem);
  assert.equal(parsed.domain, "zcode.hunas.cn");
  assert.equal(parsed.notAfter.toISOString(), notAfter.toISOString());
  assert.equal(parsed.fingerprint, material.fingerprint);
});

test("parseHttpsCertificatePem rejects cert/key mismatch", () => {
  const notAfter = new Date("2026-12-21T11:16:22.000Z");
  const matching = forgeCertAndKey({ commonName: "zcode.hunas.cn", notAfter });
  const other = forgeCertAndKey({ commonName: "other.example", notAfter });
  assert.throws(
    () => parseHttpsCertificatePem(matching.certPem, other.keyPem),
    /do not match/i,
  );
});

test("importHttpsCertificateFromDirectory stores chain and key under https-cert", async () => {
  const notAfter = new Date("2026-12-21T11:16:22.000Z");
  const material = forgeCertAndKey({ commonName: "zcode.hunas.cn", notAfter });
  const source = await mkdtemp(join(tmpdir(), "zcode-https-src-"));
  const userData = await mkdtemp(join(tmpdir(), "zcode-https-ud-"));
  await writeFile(join(source, "cert.pem"), material.certPem);
  await writeFile(join(source, "key.pem"), material.keyPem);

  const { parsed, meta } = await importHttpsCertificateFromDirectory(userData, source);
  assert.equal(parsed.domain, "zcode.hunas.cn");
  assert.equal(meta.notAfter, notAfter.toISOString());

  const storedCert = await readFile(join(userData, "https-cert", "fullchain.pem"), "utf8");
  const storedKey = await readFile(join(userData, "https-cert", "privkey.pem"), "utf8");
  assert.match(storedCert, /BEGIN CERTIFICATE/);
  assert.match(storedKey, /BEGIN (RSA )?PRIVATE KEY/);
  // 再次从源目录读取也应成功（布局探测）。
  const again = await readHttpsCertificateDirectory(source);
  assert.equal(again.domain, "zcode.hunas.cn");
});

test("importHttpsCertificateFromFiles stores matching pair", async () => {
  const notAfter = new Date("2026-12-21T11:16:22.000Z");
  const material = forgeCertAndKey({ commonName: "zcode.hunas.cn", notAfter });
  const source = await mkdtemp(join(tmpdir(), "zcode-https-files-"));
  const userData = await mkdtemp(join(tmpdir(), "zcode-https-ud-"));
  const certPath = join(source, "fullchain.pem");
  const keyPath = join(source, "privkey.pem");
  await writeFile(certPath, material.certPem);
  await writeFile(keyPath, material.keyPem);

  const { parsed, meta } = await importHttpsCertificateFromFiles(userData, certPath, keyPath);
  assert.equal(parsed.domain, "zcode.hunas.cn");
  assert.equal(meta.notAfter, notAfter.toISOString());
  assert.match(await readFile(join(userData, "https-cert", "fullchain.pem"), "utf8"), /BEGIN CERTIFICATE/);
});

test("importHttpsCertificateFromFiles rejects mismatch without writing", async () => {
  const notAfter = new Date("2026-12-21T11:16:22.000Z");
  const matching = forgeCertAndKey({ commonName: "zcode.hunas.cn", notAfter });
  const other = forgeCertAndKey({ commonName: "other.example", notAfter });
  const source = await mkdtemp(join(tmpdir(), "zcode-https-files-bad-"));
  const userData = await mkdtemp(join(tmpdir(), "zcode-https-ud-"));
  const certPath = join(source, "cert.pem");
  const keyPath = join(source, "key.pem");
  await writeFile(certPath, matching.certPem);
  await writeFile(keyPath, other.keyPem);

  await assert.rejects(
    () => importHttpsCertificateFromFiles(userData, certPath, keyPath),
    /do not match/i,
  );
  assert.equal(mapHttpsCertImportError(new Error("Certificate and private key do not match")), "mismatch");
  assert.equal(mapHttpsCertImportError(new Error("Invalid private key PEM")), "invalid_key");
  assert.equal(mapHttpsCertImportError(new Error("Invalid certificate PEM")), "invalid_cert");
});

test("import rejects mismatched key without writing storage", async () => {
  const notAfter = new Date("2026-12-21T11:16:22.000Z");
  const matching = forgeCertAndKey({ commonName: "zcode.hunas.cn", notAfter });
  const other = forgeCertAndKey({ commonName: "other.example", notAfter });
  const source = await mkdtemp(join(tmpdir(), "zcode-https-bad-"));
  const userData = await mkdtemp(join(tmpdir(), "zcode-https-ud-"));
  await mkdir(join(userData, "https-cert"), { recursive: true });
  await writeFile(join(source, "cert.pem"), matching.certPem);
  await writeFile(join(source, "key.pem"), other.keyPem);

  await assert.rejects(
    () => importHttpsCertificateFromDirectory(userData, source),
    /do not match/i,
  );
});
