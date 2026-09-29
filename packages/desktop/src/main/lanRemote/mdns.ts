import { LAN_REMOTE_PROTOCOL_VERSION, LAN_REMOTE_SERVICE_TYPE } from "@zcode/shared";

const MDNS_PORT = 5353;
const MDNS_ADDRESS = "224.0.0.251";

export interface LanRemoteAnnouncement {
  instanceName: string;
  hostname: string;
  port: number;
  addresses: string[];
  deviceId: string;
  fingerprint: string;
}

function encodeName(name: string): Buffer {
  const labels = name.split(".").filter((label) => label.length > 0);
  return Buffer.concat([
    ...labels.map((label) =>
      Buffer.concat([Buffer.from([Buffer.byteLength(label)]), Buffer.from(label)]),
    ),
    Buffer.from([0]),
  ]);
}

function encodeTxt(entries: string[]): Buffer {
  return Buffer.concat(
    entries.map((entry) =>
      Buffer.concat([Buffer.from([Buffer.byteLength(entry)]), Buffer.from(entry)]),
    ),
  );
}

function encodeRecord(name: string, type: number, data: Buffer, ttl = 120): Buffer {
  const nameBytes = encodeName(name);
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(0x8001, 2);
  header.writeUInt32BE(ttl, 4);
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([nameBytes, header, data]);
}

export function serviceInstanceName(announcement: LanRemoteAnnouncement): string {
  return `${announcement.instanceName}.${LAN_REMOTE_SERVICE_TYPE}.local`;
}

export function buildLanRemoteAnnouncement(announcement: LanRemoteAnnouncement): Buffer {
  const instance = serviceInstanceName(announcement);
  const host = `${announcement.hostname}.local`;
  const service = `${LAN_REMOTE_SERVICE_TYPE}.local`;
  const ptrData = encodeName(instance);
  const srvData = Buffer.alloc(6);
  srvData.writeUInt16BE(0, 0);
  srvData.writeUInt16BE(0, 2);
  srvData.writeUInt16BE(announcement.port, 4);
  const srv = Buffer.concat([srvData, encodeName(host)]);
  const txt = encodeTxt([
    `id=${announcement.deviceId}`,
    `ver=${LAN_REMOTE_PROTOCOL_VERSION}`,
    `fp=${announcement.fingerprint}`,
  ]);
  const records = [
    encodeRecord(service, 12, ptrData),
    encodeRecord(instance, 33, srv),
    encodeRecord(instance, 16, txt),
    ...announcement.addresses.map((address) => {
      const parts = address.split(".").map((part) => Number(part));
      return encodeRecord(host, 1, Buffer.from(parts));
    }),
  ];
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(records.length, 6);
  return Buffer.concat([header, ...records]);
}

function decodeDnsName(packet: Buffer, offset: number): string {
  const labels: string[] = [];
  const seen = new Set<number>();
  let cursor = offset;
  while (cursor < packet.length && labels.length < 16) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const length = packet[cursor] ?? 0;
    if (length === 0) break;
    if ((length & 0xc0) === 0xc0) {
      cursor = ((length & 0x3f) << 8) | (packet[cursor + 1] ?? 0);
      continue;
    }
    cursor += 1;
    labels.push(packet.subarray(cursor, cursor + length).toString("utf8"));
    cursor += length;
  }
  return labels.join(".");
}

export function announcementAnswersQuery(
  packet: Buffer,
  announcement: LanRemoteAnnouncement,
): boolean {
  if (packet.length < 12) return false;
  const flags = packet.readUInt16BE(2);
  if ((flags & 0x8000) !== 0) return false;
  const questions = packet.readUInt16BE(4);
  if (questions < 1) return false;
  const question = decodeDnsName(packet, 12);
  const service = `${LAN_REMOTE_SERVICE_TYPE}.local`;
  return (
    question === service ||
    question.endsWith(`.${service}`) ||
    question === serviceInstanceName(announcement)
  );
}

export function buildLanRemoteQueryResponse(
  query: Buffer,
  announcement: LanRemoteAnnouncement,
): Buffer {
  const announcementPacket = buildLanRemoteAnnouncement(announcement);
  const response = Buffer.from(announcementPacket);
  response.writeUInt16BE(query.readUInt16BE(0), 0);
  return response;
}

export interface LanRemoteMdnsSocket {
  send(packet: Buffer, port: number, address: string): void;
  close(): void;
  onMessage(listener: (packet: Buffer) => void): void;
}

export function publishLanRemoteMdns(
  socket: LanRemoteMdnsSocket,
  announcement: LanRemoteAnnouncement,
): () => void {
  const sendAnnouncement = () => {
    socket.send(buildLanRemoteAnnouncement(announcement), MDNS_PORT, MDNS_ADDRESS);
  };
  sendAnnouncement();
  const timer = setInterval(sendAnnouncement, 20_000);
  timer.unref?.();
  const onMessage = (packet: Buffer) => {
    if (!announcementAnswersQuery(packet, announcement)) return;
    socket.send(buildLanRemoteQueryResponse(packet, announcement), MDNS_PORT, MDNS_ADDRESS);
  };
  socket.onMessage(onMessage);
  return () => {
    clearInterval(timer);
    socket.close();
  };
}

export { MDNS_ADDRESS, MDNS_PORT };
