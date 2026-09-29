# 局域网手机控制

手机是桌面窗口 Host 的 replayable 附件。发现、密码和设备令牌归桌面 Main。文件、会话和模型事实留在那个 Host 与 CLI，不在手机上复制。

## 所有者

- Main：mDNS 通告、TLS 监听、密码校验、可撤销设备令牌、心跳，以及把已认证连接挂到目标窗口 Host。不保存任务队列、快照或目录树。
- 窗口 Host：`AttachServicePort`，`clientMode` 为 `web-remote-replayable`，本地 scope 的 `IFileService` 就是这台电脑的磁盘。SSH 工作区继续用该远程 Host 的 `fileService`。
- CLI：命令接纳与会话事实。作曲栏换模型只改手机草稿，提交发生在 `sendText` 或 `createSession` 的 `modelSelection`。供应商设置写本机 Host 的 `IProviderSettingsService`。
- 手机：发现列表、令牌、未提交草稿。断线后按 replayable 的 `logEpoch/seq` 恢复。隔离键仍是 `workspaceIdentity?.trim() || workspacePath`。`workspacePath` 只表示对端路径。

## 发现与配对

通告类型 `_zcode._tcp`。TXT：`id`、`ver=1`、`fp`（局域网自签叶证书 SHA-256，仅作展示/兼容）、以及内网明文时的 `tls=0`（或 `scheme=http`）。密码和令牌不进通告。

兼容：旧 TXT 没有 `tls`/`scheme` 时，手机仍按 HTTPS + 指纹 pin（自签）处理。内网改为明文 HTTP 后必须带 `tls=0`（或 `scheme=http`），手机用 `http://` 连接且**不** pin。公网域名 HTTPS（如 `zcode.hunas.cn`）走系统信任，不要求自签 pin。

macOS（含 iOS Simulator）发现走系统 mDNSResponder。桌面 Main 在 darwin 上必须通过 Bonjour 注册（`dns-sd -R` 或等价系统 API），不能只发 raw UDP 5353 多播——后者不会进入 mDNSResponder，模拟器里的 `NetServiceBrowser` 也就看不到。非 darwin 仍可用 raw UDP 通告。通告只在局域网控制已开启且**内网 HTTP 正在监听**时发布，通告端口指向该 HTTP 端口。

内网监听绑私网 IPv4。没有私网地址时不对外监听内网 HTTP。公网 HTTPS 另绑 `0.0.0.0`。配对接口（HTTP 与 HTTPS 相同）：

- `GET /lan/v1/info`：协议版本、设备 ID、显示名、指纹。不含密码。
- `POST /lan/v1/pair`：`clientId`、`clientName`，密码可空。来源地址是私网 IPv4（10/8、172.16/12、192.168/16）且密码为空时直接签发令牌，手机在内网发现后自动连接，不必再输入密码。回环地址 `127.0.0.1` 和公网地址仍必须校验密码；密码非空但不正确时，私网同样拒绝。同一 IP 连续 5 次失败后锁定 60 秒。
- `GET /lan/v1/ws`：升级后的第一条文本消息必须是 `{ "type": "auth", "token" }`。通过后 Main 才把连接挂到当前聚焦窗口的 Host；没有 Host 时关闭连接，不创建第二个 Agent。

认证之后，Main 只做两种帧的双向转发，不解析任务或快照。手机 WebSocket 使用 SocketProtocol；窗口 Host 的 MessagePort 收的是已经拆完帧的 RPC 字节。手机发出的 Regular 帧必须还原成完整消息再 `postMessage` 给 Host。Host 发出的 `Uint8Array` 必须重新封装成 SocketProtocol 帧写回 WebSocket。只把入站字节送进 SocketProtocol、却不把 `onMessage` 交回 Host 时，ChannelClient 会停在初始化，`modelSelection.getView` 到不了 Host，手机壳就停在「模型配置加载失败」。流控对象不是 RPC 字节，不写入 WebSocket。

桌面设置文件保存可展示的密码，并用 scrypt 校验。更换密码会作废已签发令牌。撤销单台设备只断开那台手机。

局域网控制开关默认开启并开始监听。没有 `lan-remote-control.json`，或旧文件里 `enabled` 为 false 且用户还没拨过开关（没有 `enabledChosen: true`）时，按默认开启写入并监听。用户在设置里打开或关闭后写入 `enabled` 和 `enabledChosen: true`，之后每次启动都恢复这一次选择。更换密码会关掉监听，并记成用户选择的关闭。

## 文件与项目

`IFileService.createDirectory`、`writeTextFile`、`renamePath`、`removePath` 在持有该磁盘的 Host 上执行。拒绝空路径和文件系统根。手机用目录浏览器从 `ISystemService.info().homedir` 浏览，`allowOpenWorkspace` 打开，并用 `preferDirectoryBrowser`，不调用本机 `selectDirectory`。macOS 上浏览器提供「外置磁盘」，进入 Host 的 `/Volumes`，列出外接磁盘，不把起点锁在用户主目录。选中的目录用 `workspacePath` 建 tab。

作曲栏添加附件：桌面 `canSelectFilePath === true` 仍只开系统多选，不出现来源选择。没有原生路径选择时（手机局域网壳，以及同样没有该能力的 Web），「+」菜单里的「附件」先弹出全宽选择：**本机** 或 **客户端**，再进入对应选择器。这两项不放进加号那么窄的菜单里。本机仍用隐藏 file input，任意类型把字节经现有 `attachmentPut` 写入当前会话所在 Host（上限 `PROTOCOL_V4_LIMITS.attachmentMaxBytes`，20MiB）；超限失败并展示附件过大文案，不把附件丢成「无内容」。客户端用当前工作区的 `IFileService.readdir` 浏览（含以 `.` 开头的条目），起点是 `workspacePath`，可向上直到 `homedir`（工作区不在主目录下时仍可回到 `homedir`）。主目录读不到时仍可向上，直到文件系统根。点文件即加入附件并关闭浏览；该路径已在 Agent 可读的文件系统上，零拷贝引用，不把这条路径交给桌面磁盘 `stage`。仍最多 8 个附件。取消浏览不改草稿，也不撤掉这次浏览里已经加上的文件。

桌面进程重启或 WebSocket 断开后，手机页不得停在黑屏：先显示「正在重新连接」，用已保存令牌重试；令牌失效或页面加载失败时，内网按发现到的地址重新免密配对并刷新。

## 交付

桌面窗口保持 `desktop-continuous`。手机握手 `clientKind` 为 `mobileApp`。手机进后台走快照恢复，不占用桌面实时流。

手机切到后台不等于退出。原生壳保持已配对会话和当前 WebView，不因为系统挂起网络就把会话清掉、退回发现列表。回到前台时，网页进程还在就原地重连，不盖全屏黑底；网页进程被系统回收时，重新加载同一页。手机当前项目写在本机 `localStorage` 键 `zcode:lan-mobile-active-workspace`，恢复时在桌面 `lastWorkspaceSession` 的全部本地项目里激活这个项目，不用桌面的 `lastActiveTabIndex` 替换整份列表。每个项目上次在手机上查看的对话 id 写在本机 `localStorage` 键 `zcode:lan-mobile-active-tasks`（按 `workspaceIdentity?.trim() || workspacePath` 分区）；手机重新打开后，在激活上次项目之后进入该项目下上次查看的对话，而不是空白草稿、列表里另一条「最新」会话，或桌面当前焦点会话。Host 快照若带着桌面焦点，不得覆盖手机本机记下的对话。会话服务在没有工作区路径和有路径时都走同一组 hook，避免项目一出现就打断渲染、侧栏停在空列表。只有还没进入工作区时才显示「正在重新连接」。iOS 挂起后进程会冻结，回到前台仍是上次的项目界面。

手机进入工作区后，从同一个窗口 Host 的设置里恢复 `lastWorkspaceSession` 里的本地项目和对话工作区，再用该 Host 的任务列表展示这些项目下的历史会话。点开一条会话时，消息上下文仍由这个 Host 按 replayable 快照给出。手机和桌面看着同一个 Host。作曲栏的模型、推理档和模式不是各端自己的事实：某一端改选后，经同一窗口 Host 的广播把 `{workspaceKey, scopeId, mode, planEnabled, modelSelection}` 交给另一端，只更新这些字段，不覆盖对方输入框里的正文。挂载时的现有草稿不广播，避免后打开的一端用旧 localStorage 盖掉已经改过的选择。之后的改选最后写入者生效。手机新打开的本地项目可以追加进 `lastWorkspaceSession` 和 `recentProjects`。追加只增加手机标签里还没有的本地路径，不删除、不重排桌面已有条目，不改 `lastActiveTabIndex`。手机标签为空时不写。对话本身留在 Host 任务库，不写入设置。SSH、WSL、Docker 条目仍只由桌面写入和恢复。桌面窗口收到追加广播，或窗口重新可见时，只把设置里新出现且本窗口没有关掉的本地项目补进当前标签，不抢走当前焦点。同一项目里的新对话仍由 `workspace_task_list_changed` 刷新已经打开的任务列表。

窄屏（宽度不超过 767px，含手机 WebView）默认收起左侧导航，对话区占满宽度。左上角始终有展开/收起按钮，不依赖 macOS 或 Windows 标题栏按钮。展开时左侧导航盖在对话上面，点遮罩或同一按钮收回；在窄屏左侧导航里选中一条会话/任务（或会切入该对话的项目行）后也必须收起叠层并展示该对话，宽屏桌面布局保持侧栏常开。不把对话挤成半屏。窄屏打开右侧侧栏（子代理、浏览器、差异等同一块面板）时，主对话列不占分栏宽度，侧栏改为绝对定位盖住整个会话区，宽度等于该区域，不进入左右拖拽分栏；顶栏左侧有「返回」，调用现有关闭侧栏动作，回到打开前的主对话。宽屏仍按约 52% 主对话加可拖拽侧栏分栏。窄屏展开态的导航是绝对定位叠层，不再借用桌面窗口外框底色，必须自带不透明结构面：使用与 Web/Windows 外框一致的 `bg-background-win-alt`（`--color-background-win-alt`），不要只用与对话同色的 `bg-sidebar`（zai 暗色主题下二者同为 `#161616`，叠在对话上会看起来像“透底”）。宽度用可被 Tailwind 稳定扫描的 `w-80 max-w-[88vw]`（约 20rem），避免带逗号的任意值漏打包。对话内容不得从导航透出。窄屏顶部浮层不按桌面分栏的 `--workspace-sidebar-panel-width`（窄屏该值为 0）裁剪宽度，避免展开按钮被压成不可点。作曲栏模型选择器在窄屏须展示完整模型名（可截断省略号，不得退回仅图标）。`?sidebar=1` 仅供模拟器 UITest 默认展开叠层验收，正式配对 URL 只有 `lan=1`。手机页面视口固定，不能捏合放大缩小：`packages/web/index.html` 使用 `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`。iOS `WKWebView` 把 `scrollView.minimumZoomScale` 和 `maximumZoomScale` 都设为 1，并关闭 `bouncesZoom`。桌面 Electron 窗口不使用这份 viewport。手机没有悬停，用户消息的复制和编辑、助手回复的复制、赞、踩和分叉，以及忙碌时的队列/立即发送，都要直接显示，不靠 hover 才出现。队列、编辑重发和这些动作与桌面同一条命令，不另做一套。窄屏设置页和首页共用同一套左侧导航：页面铺满 WebView，不再在外层另加 safe-area。抽屉默认收起，宽 `w-80 max-w-[88vw]`，不透明 `bg-background-win-alt`。顶栏占位与首页侧栏相同，为 `h-[calc(3rem+env(safe-area-inset-top))]`。左上角展开/收起按钮浮在抽屉和遮罩之上，点同一按钮、遮罩或选中一项都收回；图标随开合在打开/关闭侧栏之间切换。抽屉里是纵向完整分类名，不改成顶上横滑图标。内容从这条浮层下面开始。短控件和标题同一行、控件靠右；带满宽的选择器和输入框换到下一行，避免 260px 固定列挤出屏幕。模型供应商在窄屏先显示当前详情，供应商目录放在详情下方并限制高度可滚动，每一行显示供应商名称，不收成只剩图标的方块。`?settings=<sectionId>` 与 `?settingsNav=1` 只给模拟器验收直达分区和展开抽屉，正式配对 URL 只有 `lan=1`。

局域网 TLS 监听在配对与 WebSocket 之外，向手机提供与桌面同源的 Web UI：`GET /`（及 SPA 静态资源）返回随包 `lan-web` 构建产物。手机配对成功后直接打开 `https://<host>:<port>/?lan=1`，用已 pin 的证书指纹加载完整 `packages/ui` 壳（会话、目录浏览器、新建项目、模型、设置），不再指向手机本机 `127.0.0.1` 或开发态 Vite 地址。UI 通过 `sessionStorage` 键 `zcode:lan-remote-session` 持有 `{origin, token, clientId}`，再连 `GET /lan/v1/ws`。手机设置里的垃圾清理和清理后的重启不在网页里执行：网页没有桌面的 `resetDisposableUserData`，按钮会保持禁用。已配对手机改为 `POST /lan/v1/cleanup`（body 为类别数组）和 `POST /lan/v1/relaunch`，请求头 `Authorization: Bearer <token>`。清理按钮在配对会话存在时必须可点，不能因为网页没有桌面 `resetDisposableUserData` 而禁用。Main 用与 WebSocket 相同的设备 token 校验；未配对或 token 无效返回 401，不删任何文件。校验通过后，清理与桌面设置页走同一条 Main 路径（同一批目录、同一批保留项、选了缓存时清 Chromium 缓存）。重启与桌面「立即重启」相同。手机页面脚本不得长时间缓存，否则 WebView 会一直拿旧页面，按钮继续是灰的。

分屏、内嵌浏览器、系统文件管理器定位、电脑控制权限引导、应用内更新仍只在桌面。新建 SSH、WSL、Docker 的连接参数仍在桌面填写。

## 导入 HTTPS 证书（ACME）与双监听

默认仍由 Main 生成**局域网自签**证书；手机用指纹 pin。用户可另外导入 ACME（或同类）证书链与私钥，用于**公网域名 HTTPS**（例如 `zcode.hunas.cn`）。导入材料**不得**替换局域网自签证书、指纹或 Bonjour 通告目标。不另起 Agent、Local Host 或远程 workspace；手机仍是 `web-remote-replayable` 附件，桌面仍是 `desktop-continuous`。

### 所有者与存储

- Main 是导入证书、落盘、解析域名/过期时间、到期提醒与**公网 HTTPS 监听**的唯一所有者。Renderer 只经 `IPlatformService` / 既有 LAN IPC 读状态与发命令。
- 持久化目录：`{userData}/https-cert/`（与 `lan-remote-control.json` 同级，macOS 上即 `~/Library/Application Support/ZCode/https-cert/`）。
  - `fullchain.pem`：公网证书链（叶证书在前）
  - `privkey.pem`：私钥，文件 mode `0600`
  - `meta.json`：`domain`、`notAfter`（ISO）、`fingerprint`（叶证书 SHA-256 hex）、`lastWarnedNotAfter`
- `lan-remote-control.json` 中的 `certPem` / `keyPem` / `fingerprint` **始终是局域网自签材料**。导入公网证书只写 `https-cert/`，不改写这些字段。若历史版本曾把公网材料写进 secret（指纹与 `https-cert/meta.json` 相同），Main 在启动局域网监听前必须重新生成自签并写回 secret。
- 再次导入覆盖 `https-cert/` 文件；不关闭、不换绑、不换证局域网监听。

### 导入与解析

主路径是**分别选择两个文件**，不是只选目录：

1. **证书**：PEM 完整链（常见名 `fullchain.pem` / `fullchain.cer` / `cert.pem` / `*.crt` / `*.pem`，排除 key）。
2. **私钥**：PEM（`privkey.pem` / `key.pem` / `*.key`）。

设置页提供两个文件选择控件（证书 / 私钥）；也可保留「从目录导入」作为次要入口。IPC 主路径传入 `certPath` + `keyPath`；省略路径时 Main 用 `dialog.showOpenDialog`（`openFile` + 对应 filters）依次弹出证书与私钥对话框，**不以 `openDirectory` 为唯一选项**。

次要路径：选择证书目录（或 IPC 传入 `directoryPath`）。识别常见 ACME 布局：证书候选 `fullchain.pem` / `fullchain.cer` / `cert.pem` / `*.cer` / `*.crt`（排除 key）；私钥候选 `privkey.pem` / `key.pem` / `*.key`。两者都要读入。

- 用 node-forge 解析叶证书：域名优先取 DNS SAN，否则 CN；展示主域名。`notAfter` 为过期时刻。
- 校验私钥与叶证书公钥匹配；不匹配则拒绝导入，不改写已有 `https-cert/`。
- **取消语义**：用户取消任一文件/目录对话框时，IPC **不得**抛出 `Certificate import cancelled` 或其它异常；返回安静的 `cancelled: true` 结果，**不改写**已存储证书，设置页不弹错误 toast。
- **失败语义**：缺证书或缺私钥、PEM 无效、公私钥不匹配 → IPC 返回可读 `errorCode`（设置页用中英 i18n 展示），**不**变成未捕获的 remote-method 异常；不记日志私钥或完整证书 PEM（可记域名、`notAfter`、指纹前缀）。

### 同一映射端口上的 HTTP 与 HTTPS

开启「局域网控制」后只绑定 **一个** TCP 端口：`0.0.0.0`（全部 IPv4）加上已保存的 `port`（当前映射端口，例如 49608）。不另开 443，也不把公网证书独占这个端口而关掉明文。

路由器把外网该端口转到这台电脑时，数据包必须能到达这个 `0.0.0.0:port`。只绑某一块内网网卡、或在握手前把连接交给错误的 TLS 层，外网 `https://域名:port/` 会一直转圈。

同一 socket 看客户端第一个字节：

- `0x16`（TLS ClientHello）交给 HTTPS。SNI 等于已导入证书的域名（如 `zcode.hunas.cn`）时出示 ACME 证书；其它 SNI 或没有 SNI 时出示局域网自签，Bonjour 的 `fp` 仍是自签指纹，内网手机 pin 继续有效。
- 其它字节交给明文 HTTP，供内网 `http://<lan-ip>:<port>/` 使用。

导入或关闭公网证书只改变 SNI 选证，不换端口、不停止 HTTP。关闭「局域网控制」才关掉这一个监听。

不得先把 socket 包成 `TLSSocket` 再交给 HTTPS server，否则会二次握手，连接在已 accept 之后超时。

### 到期提醒

- 阈值：公网证书已过期，或距 `notAfter` ≤ 15 天（16 天及以上不提醒）。
- 触发：应用启动恢复监听时、用户开启局域网控制或公网 HTTPS 时、设置页拉取 LAN 状态时。
- 防刷：同一 `notAfter` 只弹一次系统对话框，直到导入了新证书（`notAfter` 变化）。对话框文案提示用户续期；过期证书在设置里仍显示为已过期。
