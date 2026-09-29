import assert from "node:assert/strict";
import test from "node:test";
import { SocketProtocol, VSBuffer, type ISocket } from "@zcode/rpc";
import {
  bridgeLanSocketToHostPort,
  type LanRpcPort,
  type LanRpcSocket,
} from "./socketBridge.js";

function encodeFrame(payload: Uint8Array): Uint8Array {
  let written: Uint8Array | undefined;
  const socket: ISocket = {
    onData: () => ({ dispose() {} }),
    onClose: () => ({ dispose() {} }),
    onEnd: () => ({ dispose() {} }),
    write(buffer) {
      written = buffer.buffer;
    },
    end() {},
    drain: () => Promise.resolve(),
    dispose() {},
  };
  const protocol = new SocketProtocol(socket);
  protocol.send(VSBuffer.wrap(payload));
  protocol.dispose();
  if (!written) throw new Error("frame was not written");
  return written;
}

function decodeFrame(frame: Uint8Array): Uint8Array {
  let message: Uint8Array | undefined;
  let push: ((data: VSBuffer) => void) | undefined;
  const socket: ISocket = {
    onData: (listener) => {
      push = listener;
      return { dispose() {} };
    },
    onClose: () => ({ dispose() {} }),
    onEnd: () => ({ dispose() {} }),
    write() {},
    end() {},
    drain: () => Promise.resolve(),
    dispose() {},
  };
  const protocol = new SocketProtocol(socket);
  const subscription = protocol.onMessage((buffer) => {
    message = buffer.buffer;
  });
  push?.(VSBuffer.wrap(frame));
  subscription.dispose();
  protocol.dispose();
  if (!message) throw new Error("frame was not decoded");
  return message;
}

function createPair(): {
  socket: LanRpcSocket;
  port: LanRpcPort;
  posted: Uint8Array[];
  sent: Array<Uint8Array | string>;
  emitSocket: (data: Uint8Array, isBinary: boolean) => void;
  emitPort: (data: unknown) => void;
} {
  const posted: Uint8Array[] = [];
  const sent: Array<Uint8Array | string> = [];
  let emitSocket: (data: Uint8Array, isBinary: boolean) => void = () => {};
  let emitPort: (data: unknown) => void = () => {};
  const socket: LanRpcSocket = {
    send(data) {
      sent.push(data);
    },
    close() {},
    on(event, listener) {
      if (event === "message") emitSocket = listener;
    },
  };
  const port: LanRpcPort = {
    start() {},
    close() {},
    postMessage(message) {
      posted.push(message);
    },
    on(event, listener) {
      if (event === "message") {
        emitPort = (data) => listener({ data });
      }
    },
  };
  bridgeLanSocketToHostPort(socket, port);
  return { socket, port, posted, sent, emitSocket, emitPort };
}

test("phone SocketProtocol frames are delivered to the host port", () => {
  const { posted, emitSocket } = createPair();
  const payload = new TextEncoder().encode("model-selection.getView");
  emitSocket(encodeFrame(payload), true);
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0], payload);
});

test("text frames are not delivered to the host port", () => {
  const { posted, emitSocket } = createPair();
  emitSocket(new TextEncoder().encode('{"type":"auth","ok":true}'), false);
  assert.equal(posted.length, 0);
});

test("host bytes are framed back onto the phone socket", () => {
  const { sent, emitPort } = createPair();
  const payload = new TextEncoder().encode("model-selection-view");
  emitPort(payload);
  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof Uint8Array);
  assert.deepEqual(decodeFrame(sent[0]), payload);
});

test("host flow-control objects are not written to the phone socket", () => {
  const { sent, emitPort } = createPair();
  emitPort({ __zcodeRpcControl: "connection-flow-v1", state: "saturated" });
  assert.equal(sent.length, 0);
});
