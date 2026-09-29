# HTTP / SOCKS 代理出口与绕过

## 行为

设置页配置代理（单个 `httpProxy` 或 `proxyChain`）后，ZCode **可控的应用/模型 HTTP 出口**遵循：

1. 目标命中「不使用代理的地址」（含默认本地规则，或用户显式列表）→ **直连**。
2. 其余 `http:` / `https:` 目标 → **走当前出口代理**。只有一跳时就是用户填的 `http://` 或 `socks5://`；两跳及以上才进本机链网关。
3. 代理不可达或网关缺失 → **fail-closed**，不静默回退直连。

这不是系统 TUN / VPN。ZCode 以外的进程不受影响。

## Owner

| 状态 | 所有者 |
| --- | --- |
| 用户填写的绕过列表 | AppSettings.`httpProxyNoProxy`（`SettingService`） |
| 默认本地绕过常量 | `@zcode/shared` 的 `DEFAULT_LOCAL_PROXY_BYPASS_RULES`（纯函数，无 IO） |
| 绕过匹配与 CIDR | `@zcode/shared` 的 `matchesProxyBypass` / `resolveEffectiveNoProxy` |
| Host Node fetch 出口 | `createHostApiNetworkTransport`（`packages/services`） |
| Chromium Session 代理 | Main `applyDesktopChromiumNetworkPolicies` |
| Agent / CLI 模型与工具出口 | 注入的 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` + CLI `resolveProxyForRequest` |
| 代理连通性测试 | `ISystemService.testProxyEndpoint` |
| 模型商 API 延迟探测 | `IProviderSettingsService.probeProviderApiLatency` |

## 默认绕过（未保存显式列表时）

当 `httpProxyNoProxy` 为空或未设置时，运行时有效规则为：

```text
localhost,127.0.0.1,::1,169.254.0.0/16,fe80::/10
```

含义：

- `localhost` / `127.0.0.1` / `::1`：回环
- `169.254.0.0/16`：IPv4 link-local
- `fe80::/10`：IPv6 link-local

**不改写**用户已持久化的显式列表：若 setting.json 里已有非空 `httpProxyNoProxy`，运行时只使用该列表（不再自动合并默认项）。清空输入并保存后，重新回到上述默认。

## 绕过语法

逗号分隔。支持：

- 主机名：`localhost`、`api.corp.com`（后缀匹配 `*.corp.com` 语义：精确或子域）
- 前导点 / 通配：`.example.com`、`*.example.com`
- 可选端口：`host:443`
- IPv4 / IPv6 字面量
- **IPv4 / IPv6 CIDR**（真实包含判定，非字符串前缀）：如 `192.168.8.0/24`

含 `/` 且无法解析为合法 CIDR 的 token：**校验拒绝保存**，匹配时**不得**当成主机名。

## 覆盖范围（走代理规则）

代理启用且目标未绕过时，下列路径必须经代理：

- Desktop Chromium：`defaultSession`（renderer / `net.fetch` 同源出口）与内置浏览器 partition（另：留空代理时内置浏览器跟系统代理，见既有策略）
- Host `NodeApiClient`、远程模型目录同步、API Key 池配额探测（OpenCode / balance 等）
- Agent 子进程模型请求、MCP、WebFetch（经注入的代理环境变量 + CLI `http-config`）
- 命令工具：`ALL_PROXY`（链开启时指向 SOCKS 入口）

## 明确不覆盖

- 系统其它应用、shell 里用户自己的进程
- Host/Agent 里未接入 `HostApiNetworkTransport` / 代理 env 的裸 `fetch`（应逐步收口；新增出口必须接入）
- 本地代理链网关本身对上游跳板的拨号（网关出站不读 `HTTP_PROXY`，避免回环）

## 设置页动作

### 测试代理

每个已添加的代理地址旁提供「测试」。对**该条代理自身**做 TCP（SOCKS5 另做问候握手；HTTP 代理另做最小 CONNECT/HTTP 探活）可达性检查。成功才报成功；超时/拒绝/协议不符 → 失败。不伪造成功。

### 测试模型商延迟

用户选择已配置的模型商，发起一次轻量鉴权探测（优先 `GET …/models`，不发起计费 chat completion）。走当前代理/绕过规则。展示 RTT（ms）。不落盘、不打印密钥。

## 时间与幂等

- 保存代理 / 绕过 / 证书后：**立即**回收当前已运行的 Agent 进程，并清掉 Host fetch 上缓存的出口。下一条模型请求按新设置重新 spawn；代理不可达则该请求失败，**不**静默直连。不要求用户重启整个应用。
- 正在进行的对话会被这次回收打断；下一条消息使用新代理。
- 测试动作无持久化副作用；并发点击以最后一次结果展示为准。

## 事件顺序（桌面）

```text
保存设置 → SettingService 持久化
        → Main 应用 proxy chain / Chromium setProxy（含有效 bypass）
        → Host transport.invalidate()，下一次 Host fetch 重读设置
        → 回收已运行 Agent（dispose workspace runtime，不关闭 manager）
        → 下一条对话 spawn 时读取新 httpProxy / 链网关
        → 代理不可达：请求失败，不回退直连
```
