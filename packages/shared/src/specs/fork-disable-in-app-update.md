# F-disable-in-app-update：关闭应用内自动更新

## 行为

本 fork 的桌面生产包不得检查、下载或安装官方 Electron 更新，也不得在启动时因 `minimalVersion` 走 `quitAndInstall`。官方应用内更新会覆盖 `/Applications/ZCode.app`（及对应平台安装目录）并抹掉打包进去的本地魔改。

## Owner

`isDesktopInAppUpdateEnabled()`（`@zcode/shared`）是唯一开关。它读取 `FORK_DESKTOP_IN_APP_UPDATE_ENABLED` 再与官方产品身份求交：仅当 fork 开关为 true **且** flavor 为 `production` 时才启用。Main 的 `initAutoUpdater({ enabled })`、启动强更、菜单/托盘、绿色 `UpdateStatusButton`、设置页更新开关都只读这个函数，不得再各自判断 `ZCODE_PRODUCT_FLAVOR === "production"`。

## 不变量

- `FORK_DESKTOP_IN_APP_UPDATE_ENABLED === false`（本 fork 默认）。
- `initAutoUpdater` 必须收到 `enabled: false`，从而不配置 electron-updater、不轮询 manifest、不设 `autoInstallOnAppQuit`。
- 绿色侧栏 `UpdateStatusButton` 不挂载；用户打不开更新窗口。
- 启动 `maybeBlockStartupForForceUpdate` 不跑；它会拉 client configs，并在低于 `minimalVersion` 时调用 `requestForceAutoUpdate` → `quitAndInstall`。
- 设置页不展示「接受预览版更新 / 自动下载并安装」开关，改为静态说明。
- 不删除 `autoUpdater.ts` / `manifestUpdateProvider.ts` / `forceUpdateGuard.ts` 等官方实现，便于以后把 fork 开关改回 true。

## 时间与失败语义

- 无更新流：不 check、不 download、不 install。
- 若仍有入口漏到 `checkForUpdateMenuClick` / `requestForceAutoUpdate`，模块内 `autoUpdaterDisabledForProductFlavor` fail-closed，不向占位 feed 发请求。

## 恢复官方行为

把 `FORK_DESKTOP_IN_APP_UPDATE_ENABLED` 改回 `true`。Preview 身份仍保持官方 `enabled: false`。
