# SOCKS5 代理链（最多 5 跳）

## 行为

设置页可以保存 1 到 5 个代理。没写协议的 `host:port` 是 `http://`；SOCKS 必须写成 `socks5://`。

- **只有一跳**（HTTP 或 SOCKS5）：可控出口直接使用这一跳的 URL。不启动本机网关，也不把流量改到 `127.0.0.1:47821`。一跳 SOCKS5 若再套 HTTP 网关，模型请求会整批失败。
- **两跳及以上**：先进入本机网关，再按顺序连接。Host 与 Agent 只使用 Main 成功监听后写入的 `ZCODE_LOCAL_PROXY_GATEWAY_*`。这两个变量不存在时 `gatewayMissing`，不得假设 `47821` 上一定有人在听。

链为空时，继续使用原来的单个 `httpProxy`。

这不是系统 TUN。ZCode 以外的程序不走这条链。

## Owner

- 跳板列表的持久化所有者是 AppSettings.`proxyChain`。
- 网关实现在 `packages/shared/src/proxy-chain`，由 `@zcode/shared/proxy-chain` 导出。桌面、Host 和 CLI 共用这一份拨号。
- 本机网关的进程所有者：
  - 桌面：Main 在启动 Chromium 策略之前监听 `127.0.0.1`，并把 HTTP / SOCKS 入口写入 `ZCODE_LOCAL_PROXY_GATEWAY_HTTP` 与 `ZCODE_LOCAL_PROXY_GATEWAY_SOCKS`。Host 与 Agent 只读这两个地址。
  - 纯 CLI：CLI 进程在读取到 `network.proxyChain` 后自己启动网关，并把本次运行配置里的 `httpProxy` / `allProxy` 改成本机入口。
  - 远端 Agent：远端 server 用 `ZCODE_REMOTE_PROXY_CHAIN` 在自己的机器上启动网关。不得把桌面的 `127.0.0.1` 入口写给远端。

## 不变量

- 链长 0–5。第 6 条拒绝保存。
- 每一条必须带主机和显式端口，协议是 `http://` 或 `socks5://`，可以带用户名和密码。
- 网关只绑定 `127.0.0.1`。出站用原始 TCP 拨号，不读取 `HTTP_PROXY`，避免回环。
- 命中「不使用代理的地址」的请求不进链（空列表时含默认本地绕过，见 `http-proxy-egress.md`）。
- 某一跳连不上时，该请求失败，不改走直连。
- 链已配置但本机网关地址缺失时，Host API 与 Agent spawn fail-closed，不把 `socks5:` 交给只接受 HTTP 代理的 undici。

## 出口

一跳时下游看到的就是这一跳（HTTP 或 `socks5://`）。两跳及以上才只看到本机网关：

- Chromium：一跳用该跳 URL；多跳用 `socks5://127.0.0.1:<socksPort>`
- Host `NodeApiClient`：HTTP 用 undici `ProxyAgent`；SOCKS5 用同一份 `dialThroughSocks5Chain`；多跳用网关的 HTTP 入口
- Agent 模型、MCP、WebFetch：`HTTP_PROXY` / `HTTPS_PROXY` 指向上述出口
- 命令工具：`ALL_PROXY` 与该出口相同（多跳时指向网关 SOCKS 入口）

## 时间

保存后重启应用生效。Main 先听网关，再套用 Chromium 策略，再拉起 Host。
