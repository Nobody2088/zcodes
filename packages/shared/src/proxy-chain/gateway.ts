import http from "node:http";
import net from "node:net";
import type { Socks5ProxyHop } from "../socks5ProxyChain.js";
import { ByteReader, dialThroughSocks5Chain } from "./dial.js";

export interface Socks5ProxyChainGateway {
  httpProxyUrl: string;
  socksProxyUrl: string;
  close(): Promise<void>;
}

const SOCKS_VERSION = 0x05;

export async function startSocks5ProxyChainGateway(
  hops: readonly Socks5ProxyHop[],
  ports?: { httpPort?: number; socksPort?: number },
): Promise<Socks5ProxyChainGateway> {
  if (hops.length === 0) {
    throw new Error("SOCKS5 proxy chain is empty");
  }
  const httpServer = http.createServer((request, response) => {
    void forwardAbsoluteHttp(request, response, hops).catch(() => {
      if (!response.headersSent) {
        response.writeHead(502);
        response.end();
        return;
      }
      response.destroy();
    });
  });
  const socksServer = net.createServer();

  httpServer.on("connect", (request, clientSocket, head) => {
    const target = parseConnectAuthority(request.url ?? "");
    if (!target) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    void dialThroughSocks5Chain(hops, target)
      .then((upstream) => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
        const closeBoth = () => {
          upstream.destroy();
          clientSocket.destroy();
        };
        upstream.on("error", closeBoth);
        clientSocket.on("error", closeBoth);
      })
      .catch(() => {
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      });
  });

  socksServer.on("connection", (clientSocket) => {
    void acceptSocksClient(clientSocket, hops).catch(() => {
      clientSocket.destroy();
    });
  });

  const httpPort = await listen(httpServer, ports?.httpPort ?? 0);
  const socksPort = await listen(socksServer, ports?.socksPort ?? 0);
  return {
    httpProxyUrl: `http://127.0.0.1:${httpPort}`,
    socksProxyUrl: `socks5://127.0.0.1:${socksPort}`,
    close() {
      return Promise.all([closeServer(httpServer), closeServer(socksServer)]).then(() => undefined);
    },
  };
}

async function forwardAbsoluteHttp(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  hops: readonly Socks5ProxyHop[],
): Promise<void> {
  const target = parseAbsoluteHttpUrl(request.url ?? "");
  if (!target) {
    response.writeHead(400);
    response.end();
    return;
  }
  const upstream = await dialThroughSocks5Chain(hops, {
    host: target.host,
    port: target.port,
  });
  const headerLines = [`${request.method ?? "GET"} ${target.path} HTTP/1.1`];
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name.toLowerCase() === "proxy-connection") continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) headerLines.push(`${name}: ${item}`);
  }
  upstream.write(`${headerLines.join("\r\n")}\r\n\r\n`);
  const reader = new ByteReader(upstream);
  try {
    const statusLine = await readHeaderLine(reader);
    const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d+)/.exec(statusLine);
    const headers: http.OutgoingHttpHeaders = {};
    while (true) {
      const line = await readHeaderLine(reader);
      if (line.length === 0) break;
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      const existing = headers[name];
      if (typeof existing === "string") headers[name] = [existing, value];
      else if (Array.isArray(existing)) existing.push(value);
      else headers[name] = value;
    }
    reader.detach();
    response.writeHead(statusMatch ? Number(statusMatch[1]) : 502, headers);
    request.pipe(upstream);
    upstream.pipe(response);
    const closeBoth = () => {
      upstream.destroy();
      response.destroy();
    };
    upstream.on("error", closeBoth);
    response.on("error", closeBoth);
  } catch (error) {
    upstream.destroy();
    throw error;
  }
}

function parseAbsoluteHttpUrl(
  value: string,
): { host: string; port: number; path: string } | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" || !url.hostname) return undefined;
  const port = Number(url.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { host: url.hostname, port, path: `${url.pathname}${url.search}` || "/" };
}

async function readHeaderLine(reader: ByteReader): Promise<string> {
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

function parseConnectAuthority(value: string): { host: string; port: number } | undefined {
  const separator = value.lastIndexOf(":");
  if (separator <= 0) return undefined;
  const host = value.slice(0, separator).replace(/^\[|\]$/g, "");
  const port = Number(value.slice(separator + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { host, port };
}

async function acceptSocksClient(
  socket: net.Socket,
  hops: readonly Socks5ProxyHop[],
): Promise<void> {
  const reader = new ByteReader(socket);
  const greeting = await reader.read(2);
  if (greeting[0] !== SOCKS_VERSION) {
    socket.destroy();
    return;
  }
  await reader.read(greeting[1] ?? 0);
  socket.write(Buffer.from([SOCKS_VERSION, 0x00]));
  const request = await reader.read(4);
  if (request[1] !== 0x01) {
    socket.write(Buffer.from([SOCKS_VERSION, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    socket.destroy();
    return;
  }
  const target = await readSocksTarget(reader, request[3] ?? 0);
  reader.detach();
  try {
    const upstream = await dialThroughSocks5Chain(hops, target);
    socket.write(Buffer.from([SOCKS_VERSION, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    upstream.pipe(socket);
    socket.pipe(upstream);
    const closeBoth = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", closeBoth);
    socket.on("error", closeBoth);
  } catch {
    socket.write(Buffer.from([SOCKS_VERSION, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    socket.destroy();
  }
}

async function readSocksTarget(
  reader: ByteReader,
  atyp: number,
): Promise<{ host: string; port: number }> {
  if (atyp === 0x01) {
    const raw = await reader.read(6);
    return {
      host: [...raw.subarray(0, 4)].join("."),
      port: raw.readUInt16BE(4),
    };
  }
  if (atyp === 0x03) {
    const length = await reader.read(1);
    const raw = await reader.read((length[0] ?? 0) + 2);
    return {
      host: raw.subarray(0, raw.length - 2).toString("utf8"),
      port: raw.readUInt16BE(raw.length - 2),
    };
  }
  if (atyp === 0x04) {
    const raw = await reader.read(18);
    const parts: string[] = [];
    for (let index = 0; index < 16; index += 2) {
      parts.push(raw.readUInt16BE(index).toString(16));
    }
    return { host: parts.join(":"), port: raw.readUInt16BE(16) };
  }
  throw new Error("Unsupported SOCKS5 address type");
}

function listen(server: net.Server | http.Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Proxy chain gateway did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: net.Server | http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

