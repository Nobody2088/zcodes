import { createSocket, type Socket } from "node:dgram";
import { logger as desktopLogger } from "../logger.js";
import { MDNS_ADDRESS, MDNS_PORT, type LanRemoteMdnsSocket } from "./mdns.js";

export function openMdnsSocket(): Promise<LanRemoteMdnsSocket> {
  const udp: Socket = createSocket({ type: "udp4", reuseAddr: true });
  const listeners = new Set<(packet: Buffer) => void>();
  const socket: LanRemoteMdnsSocket = {
    send(packet, port, address) {
      try {
        udp.send(packet, port, address);
      } catch {
        // 通告失败不影响已经配对的连接。
      }
    },
    close() {
      udp.close();
    },
    onMessage(listener) {
      listeners.add(listener);
    },
  };
  udp.on("message", (packet) => {
    for (const listener of listeners) listener(packet);
  });
  return new Promise((resolve) => {
    udp.once("error", (error) => {
      desktopLogger.warn("[lan-remote] mdns socket error", error);
      resolve(socket);
    });
    udp.bind(MDNS_PORT, () => {
      try {
        udp.addMembership(MDNS_ADDRESS);
        udp.setMulticastTTL(255);
      } catch (error) {
        desktopLogger.warn("[lan-remote] mdns membership failed", error);
      }
      resolve(socket);
    });
  });
}
