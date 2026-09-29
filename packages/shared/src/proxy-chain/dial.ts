import net from "node:net";
import type { Socks5ProxyHop } from "../socks5ProxyChain.js";

const SOCKS_VERSION = 0x05;
const METHOD_NO_AUTH = 0x00;
const METHOD_USERPASS = 0x02;
const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;
const AUTH_VERSION = 0x01;
const HOP_TIMEOUT_MS = 15_000;

export interface SocksDialTarget {
  host: string;
  port: number;
}

export async function dialThroughSocks5Chain(
  hops: readonly Socks5ProxyHop[],
  destination: SocksDialTarget,
): Promise<net.Socket> {
  const firstHop = hops[0];
  if (!firstHop) {
    throw new Error("SOCKS5 proxy chain is empty");
  }
  const socket = await connectTcp(firstHop.host, firstHop.port);
  const reader = new ByteReader(socket);
  try {
    for (let index = 0; index < hops.length; index += 1) {
      const hop = hops[index];
      if (!hop) {
        throw new Error("SOCKS5 proxy chain hop is missing");
      }
      const following = hops[index + 1];
      const next =
        index === hops.length - 1
          ? destination
          : following
            ? { host: following.host, port: following.port }
            : undefined;
      if (!next) {
        throw new Error("SOCKS5 proxy chain hop is missing");
      }
      await handshake(socket, reader, hop, next);
    }
    reader.detach();
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function connectTcp(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(HOP_TIMEOUT_MS, () => {
      fail(new Error(`SOCKS5 proxy timed out: ${host}:${port}`));
    });
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.setTimeout(0);
      socket.removeListener("error", fail);
      resolve(socket);
    });
  });
}

async function handshake(
  socket: net.Socket,
  reader: ByteReader,
  hop: Socks5ProxyHop,
  destination: SocksDialTarget,
): Promise<void> {
  if (hop.protocol === "http") {
    await handshakeHttp(socket, reader, hop, destination);
    return;
  }
  const userpass = Boolean(hop.username || hop.password);
  socket.write(
    Buffer.from([SOCKS_VERSION, 0x01, userpass ? METHOD_USERPASS : METHOD_NO_AUTH]),
  );
  const method = await reader.read(2);
  if (method[0] !== SOCKS_VERSION || method[1] === 0xff) {
    throw new Error("SOCKS5 proxy rejected authentication methods");
  }
  if (method[1] === METHOD_USERPASS) {
    const username = Buffer.from(hop.username ?? "");
    const password = Buffer.from(hop.password ?? "");
    if (username.length > 255 || password.length > 255) {
      throw new Error("SOCKS5 username or password is too long");
    }
    socket.write(
      Buffer.concat([
        Buffer.from([AUTH_VERSION, username.length]),
        username,
        Buffer.from([password.length]),
        password,
      ]),
    );
    const auth = await reader.read(2);
    if (auth[1] !== 0x00) {
      throw new Error("SOCKS5 proxy authentication failed");
    }
  } else if (method[1] !== METHOD_NO_AUTH) {
    throw new Error("SOCKS5 proxy selected an unsupported authentication method");
  }

  socket.write(encodeConnect(destination));
  const replyHead = await reader.read(4);
  if (replyHead[0] !== SOCKS_VERSION || replyHead[1] !== 0x00) {
    throw new Error(`SOCKS5 connect failed with reply ${replyHead[1]}`);
  }
  await readAddress(reader, replyHead[3] ?? 0);
}

async function handshakeHttp(
  socket: net.Socket,
  reader: ByteReader,
  hop: Socks5ProxyHop,
  destination: SocksDialTarget,
): Promise<void> {
  const lines = [
    `CONNECT ${destination.host}:${destination.port} HTTP/1.1`,
    `Host: ${destination.host}:${destination.port}`,
  ];
  if (hop.username || hop.password) {
    const token = Buffer.from(`${hop.username ?? ""}:${hop.password ?? ""}`).toString("base64");
    lines.push(`Proxy-Authorization: Basic ${token}`);
  }
  socket.write(`${lines.join("\r\n")}\r\n\r\n`);
  const status = await readHttpStatus(reader);
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP proxy connect failed with status ${status}`);
  }
  await readHttpHeaders(reader);
}

async function readHttpStatus(reader: ByteReader): Promise<number> {
  const line = await readLine(reader);
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d+)/.exec(line);
  return match ? Number(match[1]) : 0;
}

async function readHttpHeaders(reader: ByteReader): Promise<void> {
  while (true) {
    const line = await readLine(reader);
    if (line.length === 0) return;
  }
}

async function readLine(reader: ByteReader): Promise<string> {
  const bytes: number[] = [];
  while (bytes.length < 8192) {
    const chunk = await reader.read(1);
    const value = chunk[0] ?? 0;
    if (value === 0x0a) {
      if (bytes[bytes.length - 1] === 0x0d) bytes.pop();
      return Buffer.from(bytes).toString("utf8");
    }
    bytes.push(value);
  }
  throw new Error("HTTP proxy header is too long");
}

function encodeConnect(destination: SocksDialTarget): Buffer {
  const port = Buffer.alloc(2);
  port.writeUInt16BE(destination.port);
  if (net.isIP(destination.host) === 4) {
    return Buffer.concat([
      Buffer.from([SOCKS_VERSION, CMD_CONNECT, 0x00, ATYP_IPV4]),
      net.isIP(destination.host) ? Buffer.from(destination.host.split(".").map((part) => Number(part))) : Buffer.alloc(0),
      port,
    ]);
  }
  if (net.isIP(destination.host) === 6) {
    return Buffer.concat([
      Buffer.from([SOCKS_VERSION, CMD_CONNECT, 0x00, ATYP_IPV6]),
      Buffer.from(net.isIP(destination.host) ? expandIpv6(destination.host) : []),
      port,
    ]);
  }
  const host = Buffer.from(destination.host);
  if (host.length > 255) {
    throw new Error("SOCKS5 destination host is too long");
  }
  return Buffer.concat([
    Buffer.from([SOCKS_VERSION, CMD_CONNECT, 0x00, ATYP_DOMAIN, host.length]),
    host,
    port,
  ]);
}

function expandIpv6(host: string): Buffer {
  const address = host.includes("%") ? host.slice(0, host.indexOf("%")) : host;
  return Buffer.from(new URL(`http://[${address}]`).hostname ? ipv6ToBytes(address) : []);
}

function ipv6ToBytes(address: string): Uint8Array {
  const bytes = new Uint8Array(16);
  const [head, tail] = address.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array.from({ length: Math.max(missing, 0) }, () => "0"), ...tailParts];
  parts.slice(0, 8).forEach((part, index) => {
    const value = Number.parseInt(part, 16);
    bytes[index * 2] = (value >> 8) & 0xff;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

async function readAddress(reader: ByteReader, atyp: number): Promise<void> {
  if (atyp === ATYP_IPV4) {
    await reader.read(4 + 2);
    return;
  }
  if (atyp === ATYP_IPV6) {
    await reader.read(16 + 2);
    return;
  }
  if (atyp === ATYP_DOMAIN) {
    const length = await reader.read(1);
    await reader.read((length[0] ?? 0) + 2);
    return;
  }
  throw new Error("SOCKS5 reply address type is unsupported");
}

export class ByteReader {
  private chunks: Buffer[] = [];
  private waiters: Array<{
    length: number;
    resolve: (buffer: Buffer) => void;
    reject: (error: Error) => void;
  }> = [];
  private failed: Error | undefined;
  private readonly onData: (chunk: Buffer) => void;
  private readonly onError: (error: Error) => void;
  private readonly onClose: () => void;

  constructor(private readonly socket: net.Socket) {
    this.onData = (chunk) => {
      this.chunks.push(chunk);
      this.flush();
    };
    this.onError = (error) => this.fail(error);
    this.onClose = () => this.fail(new Error("SOCKS5 proxy closed the connection"));
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  read(length: number): Promise<Buffer> {
    if (length === 0) return Promise.resolve(Buffer.alloc(0));
    return new Promise((resolve, reject) => {
      if (this.failed) {
        reject(this.failed);
        return;
      }
      this.waiters.push({ length, resolve, reject });
      this.flush();
    });
  }

  detach(): void {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
    const pending = Buffer.concat(this.chunks);
    this.chunks = [];
    if (pending.length > 0) this.socket.unshift(pending);
  }

  private fail(error: Error): void {
    if (this.failed) return;
    this.failed = error;
    for (const waiter of this.waiters) waiter.reject(error);
    this.waiters = [];
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0];
      if (!waiter) return;
      const available = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (available < waiter.length) return;
      const buffer = Buffer.concat(this.chunks);
      this.chunks = buffer.length > waiter.length ? [buffer.subarray(waiter.length)] : [];
      this.waiters.shift();
      waiter.resolve(buffer.subarray(0, waiter.length));
    }
  }
}
