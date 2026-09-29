import { Emitter, SocketProtocol, VSBuffer, type ISocket } from "@zcode/rpc";

export interface LanRpcPort {
  start(): void;
  close(): void;
  postMessage(message: Uint8Array): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  on(event: "close", listener: () => void): void;
}

export interface LanRpcSocket {
  send(data: Uint8Array | string): void;
  close(): void;
  on(event: "message", listener: (data: Uint8Array, isBinary: boolean) => void): void;
  on(event: "close", listener: () => void): void;
}

/**
 * 手机 WebSocket 使用 SocketProtocol 分帧；窗口 Host 的 MessagePort 直接收 RPC 字节。
 * Main 只做这两种帧的转发，不解析任务或快照。
 */
export function bridgeLanSocketToHostPort(socket: LanRpcSocket, port: LanRpcPort): () => void {
  const data = new Emitter<VSBuffer>();
  const close = new Emitter<void>();
  const transport: ISocket = {
    onData: data.event,
    onClose: close.event,
    onEnd: close.event,
    write(buffer) {
      socket.send(buffer.buffer);
    },
    end() {
      socket.close();
    },
    drain() {
      return Promise.resolve();
    },
    dispose() {
      socket.close();
    },
  };
  const protocol = new SocketProtocol(transport);
  // SocketProtocol 只在 onMessage 上交出完整 RPC 消息。不订阅的话，手机请求会被拆帧后丢掉，
  // Host 永远看不到 getView，手机壳会停在模型配置加载失败。
  const toHost = protocol.onMessage((message) => {
    port.postMessage(message.buffer);
  });
  const onSocketMessage = (payload: Uint8Array, isBinary: boolean) => {
    if (!isBinary) return;
    data.fire(VSBuffer.wrap(payload));
  };
  const onPortMessage = (event: { data: unknown }) => {
    if (event.data instanceof Uint8Array) {
      protocol.send(VSBuffer.wrap(event.data));
    }
  };
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    close.fire();
    toHost.dispose();
    protocol.dispose();
    data.dispose();
    close.dispose();
    port.close();
    socket.close();
  };
  socket.on("message", onSocketMessage);
  socket.on("close", finish);
  port.on("message", onPortMessage);
  port.on("close", finish);
  port.start();
  return finish;
}
