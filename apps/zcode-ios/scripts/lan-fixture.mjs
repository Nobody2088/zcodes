import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { hostname, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startLanRemoteAdvertisement } from "../../../packages/desktop/src/main/lanRemote/advertise.ts";
import { createLanRemoteSecret } from "../../../packages/desktop/src/main/lanRemote/secret.ts";
import { startLanRemoteServer } from "../../../packages/desktop/src/main/lanRemote/server.ts";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/web/dist");
if (!existsSync(join(webRoot, "index.html"))) {
  throw new Error(`缺少 Web UI：${webRoot}。先执行 pnpm --dir packages/web build`);
}

let secret = await createLanRemoteSecret("ZCode Fixture");
const server = await startLanRemoteServer({
  host: "0.0.0.0",
  port: 0,
  webRoot,
  getSecret: () => secret,
  setSecret: async (next) => {
    secret = next;
  },
  onClient: () => undefined,
});

function lanHost() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && entry.address.startsWith("192.168.")) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

const host = lanHost();
const instanceName =
  hostname()
    .replace(/[^A-Za-z0-9-]/g, "-")
    .slice(0, 40) || "zcode-fixture";

const stopAdvertisement = await startLanRemoteAdvertisement({
  instanceName,
  hostname: instanceName,
  port: server.port,
  addresses: [host],
  deviceId: secret.deviceId,
  fingerprint: secret.fingerprint,
});

const fixture = {
  host,
  port: server.port,
  password: secret.password,
  fingerprint: secret.fingerprint,
  serviceName: instanceName,
};
await writeFile("/tmp/zcode-lan-fixture.json", JSON.stringify(fixture));
console.log(JSON.stringify(fixture));

const shutdown = async () => {
  stopAdvertisement();
  await server.close().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
setInterval(() => {}, 1 << 30);
