# 启动壳不得因 ServicePort 丢失而永不退场

## 行为

桌面首屏 HTML/React 启动壳（模糊背景 + 居中 Z）只表示「本地 Host 尚未把同代 RPC 端口交给 renderer」。Host 已经 `ready`、Agent 已经起来，都不足以关掉启动壳。

`DatabaseStartupAdmission.takeReadyPort()` 要求同时成立：

1. Main 转发的 `DatabaseStartupState.phase === "ready"`
2. 待接入 `MessagePort` 的 `databaseStartupId` 等于该 state 的 `startupId`

任一缺失时继续显示启动壳。不得把「库已 ready」当成业务 Root 已挂上。

## Owner

- Main `databaseStartupRelay` 拥有 Host `startupId` ↔ 本地 `ServicePort` 投递。
- Renderer `DatabaseStartupAdmission` 拥有同代配对；只有它能 `takeReadyPort()` 并进入 `Root`。
- Host 只准备库和 ChannelServer，不决定启动壳退场。

禁止 renderer 另存一份“已 ready 可进 Root”的本地门闩。

## 事件顺序

```text
Main spawn Host
  → 立即 postMessage(ServicePort, { databaseStartupId })   // 可能早于 renderer 监听
  → Host 迁移 / 装配服务
  → DatabaseStartupState.ready
Renderer
  → 注册 message 监听后 snapshot
  → ready 且没有配对端口：request-service-port
Main
  → AttachServicePort（desktop-continuous / local）+ 再投同 startupId 的 ServicePort
  → admission 配对成功 → connectViaMessagePort → Root
```

`snapshot` 只复述 Main 已缓存的 state，**不能**单独放行。Main 在 `phase === "ready"` 时主动补投同代 ServicePort；renderer 若仍缺端口则再发 `request-service-port`。两条路径都走 `reattachLocalServicePort` / AttachServicePort，不重跑 SQL。

`request-service-port` 只由 Main 处理，不转给 Host，不重跑 SQL。

## 失败语义

- 生产 Vite 把 `index.html` 里 `type="module"` 的 splash 脚本并进主入口。主模块的静态 import 图必须先求值完，splash 才跑。import 图抛错（例如 browser barrel 拉进 `createServiceLogger` → `process.pid`）时，HTML `#loading` 永不退场，Host 日志只有 `connections=0`、没有 `rpc:listen`。splash 脚本必须是经典 script，不能再当 module。
- 首个 ServicePort 是一次性 transfer。renderer 模块图还没 `addEventListener("message")` 时投出的端口会丢，且不会自动重放。
- 丢端口后 Host 可以照常 `local services ready` / Agent warmup；日志里会有 `connections=0` 且之后没有 `rpc:listen`。此时启动壳必须靠补投端口退场，不能空等。
- `connectViaMessagePort` / 首帧 `Root` 抛错不得把 `appInitialized` 卡死在 true；关闭坏端口，再 `request-service-port`。
- 已选模型被 catalog prune 掉、`getView` 挂起或失败，不得反向拖住启动壳。模型选择首读有界；超时或错误结束 provider 启动门禁，fail closed 进工作区或登录入口。

## 验收

- Host ready 之后若 renderer 尚未订阅 RPC，补投端口后必须出现 `rpc:listen`（至少 `broadcast.onMessage` / `model-selection.onDidChange`），启动壳退场。
- 最后一次选中的 glm/deepseek 已被 overlay 删掉时，启动壳仍须退场。
- 不在日志里写 API Key 或真实用户密钥。
