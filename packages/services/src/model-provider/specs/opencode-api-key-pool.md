# Provider API Key Pool

统一的个人供应商 API Key 号池。凡设置卡上会出现「粘贴 API Key」字段的供应商（含「创建自定义供应商」与全部 API 模板）共用同一套 Host 号池 UX；OpenCode Go / Zen 在此之上额外提供官方 `/usage` 三档额度探测。

仓库目录里没有名为 Zend 的 template。第三方身份是：

- OpenCode Go：`opencode-go-chat`、`opencode-go-messages`、`opencode-go-responses`（`openai-chat-completions` / `anthropic-messages` / `openai-responses`，默认 Base URL `https://opencode.ai/zen/go/v1`）
- OpenCode Zen：`opencode-zen-chat`、`opencode-zen-messages`、`opencode-zen-responses`（同上三套 API type，默认 Base URL `https://opencode.ai/zen/v1`）

## 适用范围

| 纳入号池 | 条件 |
| -------- | ---- |
| 是 | `access.type === "api-key"` 或 `"zhipu-coding-plan-api-key"`（`isApiKeyAccess`），含自定义 `standard-personal` 与全部 API 模板（BigModel API、Z.ai API、Kimi、MiniMax、DeepSeek、阿里云百炼、Xiaomi MiMo、OpenAI、Anthropic、xAI、OpenRouter、OpenCode Go/Zen 等） |
| 否 | 账号登录 Coding Plan 卡（`access.type === "zhipu-account"`：BigModel Coding Plan、Z.ai Coding Plan、Start Plan 等）。这些卡没有 API Key 字段，继续走既有账号流 |

**禁止**为非 OpenCode 供应商编造 5 小时 / 周 / 月百分比。`renewsAt` **只**在该 Key **本次**探测响应自带订阅字段时写入；不得显示共享控制台到期日。

## 行为

对适用供应商，Host 维护 Key 池：批量粘贴、去重、探测（OpenCode 有额度；其它为鉴权/models 或可请求前可用）、按 Host 事实分组、冷却到期后由 Host 复检并重新入池。Renderer 只读投影（mask、分组、countdown 的 remainingMs），不得自报入池资格，不得把明文 Key 写入日志或默认视图。

## Owner

`IProviderApiKeyPoolService` 是可变池状态的唯一所有者。密钥与探测事实加密写在 `ICredentialService`（key：`provider-api-key-pool:{providerId}`）。**当前调用 Key**（`activeKeyId`）也由 Host 拥有，并投影到 overlay `access.apiKey`。创建号池 / `addKeys` 时，**已有 overlay 明文就是默认当前 Key**，不得只因为另一把号池 Key 剩余额度更高而覆盖。只有当前 Key 离开号池（冷却 / 过期 / 无效 / 删除）后，才用剩余额度最高的号池 Key 做回退。Runtime 不另建第二份池，也不在请求中途轮换；下一次请求读到的是已经切换后的 overlay。Renderer 只展示 `activeKeyId` 与分组，不得自报下一把 Key。

## 命令

- `getView(providerId)`：投影；冷却到期的 Key 先由 Host 复检再入组。非适用供应商返回 `supported: false`、空 keys。
- `addKeys(providerId, text)`：按行 trim；空行跳过；批内与已有明文去重；过短或含空白为 invalid。一行可写成 `密钥#备注`，第一个 `#` 之后是显示名（trim，最长 40）。无 `#` 或 `#` 后为空则没有名称。去重只看密钥明文，重复行不改已有名称。先落盘再探测。
- `deleteKeys(providerId, keyIds)`：单删与批删。
- `probeKeys(providerId, keyIds?)`：Host 探测；缺省为该供应商全部 Key。
- `selectActiveKey(providerId, keyId)`：用户指定当前调用 Key；仅号池（`pool`）成员可被指定。
- `revealKey(providerId, keyId)`：仅在用户显式揭开时返回明文。
- `noteRequestFailure(providerId, status)`：Host 记录一次已完成请求的 HTTP 状态，只影响下一跳 overlay；见「请求失败后的下一跳」。
- `onDidChange`：每次落盘后广播无密钥投影。投影里的每把 Key 带 `windows`：`rolling | weekly | monthly` 各自的 `{ status, usedPercent, resetsAt }`。缺档不补假百分比；**非 OpenCode 不得出现假三档**。`usedPercent` 是官方已用比例；UI 剩余 = `100 - usedPercent`。分组仍只看三档里已用最高的那一档。另带 `membership`：`active | inactive | unknown`，以及可选的 `renewsAt` / `renewalAuthorizationRequired`。这两项**只**来自该 Key **本次**探测响应里的订阅字段；没有则为 `null` / `false`。UI 只在该 Key 自有 `renewsAt` 时显示到期文案；无 `windows` 时不渲染三档进度条。失效会员 `renewsAt = null`。

按 `providerId` 串行 admission。同一命令内探测 bounded concurrency = 4。

`view.family`：OpenCode Go/Zen 为 `"opencode-go"` / `"opencode-zen"`；其它适用供应商为 `null`（仍 `supported: true`）。

`view.quotaQuery`（Host 拥有，投影到视图；由 `resolveProviderApiKeyPoolQuotaQuery(templateId, baseUrl)` 决定。判定顺序自上而下，先命中先返回）：

| `quotaQuery` | 条件 | 探测 |
| ------------ | ---- | ---- |
| `opencode` | OpenCode Go/Zen template（`resolveOpenCodeApiKeyPoolFamily` 非空） | 官方 `/usage`（及 Zen models 回退） |
| `balance` | `baseUrl` 命中已知「余额制」host（`resolveBalanceQuotaUrl` 非空） | `resolveBalanceQuotaUrl(baseUrl)`，b.ai 为 `GET https://api.b.ai/v1/balance` |
| `channel` | 其它非空 templateId（openai、anthropic、deepseek、openrouter 等内置第三方） | **仅**该供应商有效 `api.type` + `api.baseUrl` 的远程 models catalog；**永不**打 `opencode.ai/zen/go/v1/usage`（除非该供应商自己的 baseUrl 就是该 host） |
| `none` | 上述都不命中（`templateId` 为 null / 空白且 baseUrl 不是已知余额制 host） | **不做任何** HTTP 额度/models 探测 |

`quotaQuery` 是**单一真相**：探测层从 Service 显式接收它，**不得**在 probe 内用 baseUrl 再推导一次。`baseUrl` 只参与 `quotaQuery` 的求值，因此自定义供应商（`templateId` 为 null）也能按 URL 自动获得额度查询，无需用户手填模板。

`view.family` 与 `view.quotaQuery` 正交：余额制渠道的 `family` 仍为 `null`；`opencode` 的判定回退顺序保证 OpenCode Go/Zen 的额度查询**不受**新增分支影响（templateId 先命中）。

### 余额制渠道（`quotaQuery = "balance"`，family = null）

面向返回「绝对余额」而不是「窗口百分比」的网关（如 b.ai）。已知 host 表 `BALANCE_QUOTA_HOSTS` 按 **hostname** 精确匹配（不做字符串前缀，避免 `api.b.ai.example.com` 误判）。

- 探测 URL：`resolveBalanceQuotaUrl(baseUrl)`。已知 host 一律归一到该 host 的 origin + API 版本段 + `/balance`，不把用户填进 Base URL 的资源路径（如 `/chat/completions`）接在后面。b.ai 的版本段是 `/v1`。例：`https://api.b.ai/v1`、`https://api.b.ai`、`https://api.b.ai/v1/chat/completions` 都得到 `https://api.b.ai/v1/balance`。`api.b.ai.example.com` 不命中。
- 请求头复用 `buildRemoteModelCatalogHeaders` 的 Bearer 形态（b.ai 同时接受 `Authorization: Bearer` 与 `x-api-key`）。
- 响应信封：`{ success, message, data }`。`data.api_key_type` 为 `personal` | `team`。字段含义按官方文档：
  - `personal`：`personal_balance`（整数 Credits）。
  - `team` + `quota_limit_type = "limited"`：`team_balance`（仅 admin）、`member_quota_limit`、`member_quota_used`、`quota_reset_at`。
  - `team` + `quota_limit_type = "unlimited"`：**没有** limit / balance / reset 字段；不得补假数字。
- Host 事实 `balance`（新投影字段）：

```ts
interface ApiKeyPoolBalanceFact {
  scope: "personal" | "team";
  credits: number | null;   // unlimited 名额没有剩余数字 → null
  limit: number | null;
  used: number | null;
  resetAt: number | null;   // 只认 quota_reset_at 或等价的周期重置时间
}
```

| 余额事实 | 分组 | remainingPercent |
| -------- | ---- | ---------------- |
| `credits > 0` | Pool | `limit` 已知且 > 0 时 `100 - used / limit * 100`；否则 `null` |
| `credits == 0` 且 `resetAt` 非空 | Cooling，`availableAt = resetAt` | `0` |
| `credits == 0` 且无 `resetAt` | **Exhausted**（额度耗尽，需充值/换钥，不会自行恢复） | `0` |
| `credits == null`（unlimited） | Pool | `null` |

- `credit insufficient balance` / `access_denied`（「Deposit required」）这类**响应体**错误只在模型回合出现，HTTP 常为 403。额度探测本身只看 `/balance` 的成功响应。`success: false`（HTTP 200）→ 保留上次分组、`probeError = "http"`，**不得**标 Invalid，也不得编造余额。401 → Invalid / Expired（沿用 `classifyAuthFailure`）。429 → Cooling（Retry-After）。网络 / 其它 HTTP → 保留上次分组。
- 余额渠道的 `noteRequestFailure(403)` **先复检** `GET /v1/balance`（与 OpenCode 403 先复检 `/usage` 同一模式）：`credits == 0` → Exhausted 并改选仍在号池的 Key；余额仍大于 0 或 unlimited → 不把整把 Key 标 Invalid，有其它号池 Key 才换下一跳。OpenCode 的 403 仍只复检 `/usage`，不打 `/balance`。
- Exhausted **不**参与自动复检（`shouldReprobeCoolingKey` 只认 Cooling）：余额归零没有可等待的重置时间，只能由用户充值后手动「查询额度」或换钥。Cooling 仍按 `availableAt` 到期由 Host 复检。
- 余额制渠道的号池**与 OpenCode 一起**预热：启动约 2 秒 + 每 5 分钟刷新（`quotaQuery ∈ {opencode, balance}`）。`channel` / `none` 不预热，避免给内置第三方和自定义渠道引入周期性 HTTP。

## 探测（fail closed）

### OpenCode Go / Zen（`quotaQuery = "opencode"`，family 非空）

Go：`GET {baseUrl}/usage`（官方 `https://opencode.ai/zen/go/v1/usage`），`Authorization: Bearer`。200 体为 `usage.{rolling,weekly,monthly}.{status,percent,resetsAt}`（status：`ok` | `rate-limited`）。`rolling` 是 5 小时窗口，`weekly` 约周一 UTC 重置，`monthly` 是账单周期。`percent` 是已用比例，不是剩余。任一窗口 `rate-limited` 或 `percent >= 100` → Cooling，`availableAt` = 这些窗口最早的 `resetsAt`。全部 ok → Pool，`remainingPercent = 100 - max(percent)`。200 表示 **Go 会员仍有效**。

**会员到期（`endsAt`）与 API Key：** 开源侧（cc-switch、openusage、opencode-go-usage、VS Code Go Usage Checker 等）一致：Bearer 只能打 `/zen/go/v1/usage`，响应**只有**三档用量，**没有** `access.endsAt` / 续订截止。控制台 `GET /console/api/go/status` 的 `access.endsAt` 与 `renewalAuthorizationRequired` 依赖浏览器 cookie（`__Host-console_session`）与 `x-org-id`，是**登录会话/工作区**事实，不是单把 API Key 事实；用 API Key 打该路径会 403。因此 **不得**把一次控制台会话的日期抄到号池里每一把 Key。Host **不**用 cookie 探测，也 **不**在额度探测之间保留旧的 `renewsAt`。若某把 Key 的**本次**响应碰巧带 `access.endsAt`、`subscription.renewsAt`、`subscription.currentPeriodEnd`、`subscription.expiresAt`、`billing.renewsAt`、`billing.currentPeriodEnd` 或 `billing.mandateExpiresAt`，只写入**该 Key** 的 `membership.renewsAt`；`renewalAuthorizationRequired: true` 同理只绑该 Key。没有这些字段时 `renewsAt = null`、不显示到期/需重新授权。**不得**把 monthly `resetsAt` 当成到期日。403 且 `error.type === EntitlementError` 或 message 表明 subscription required → 会员已不在，分组 Expired，`membership.state = inactive`，`renewsAt = null`。模型回合若返回同样的 403 正文（例如 `An active OpenCode Go subscription is required to use Go models.`），对话区直接说明需要有效的 OpenCode Go 订阅，不能改写成可重试的网络错误，也不能靠改请求格式绕过。装配模型请求时只记录有没有 API Key 或 Authorization，不记录密钥本身。这次 403 不把整把 Key 标成 Invalid；Host 接着探测这把 Key 的 `/usage`。探测结果是会员不在（EntitlementError / subscription required）时，分组改为 Expired，并改选其它仍在号池的 Key。探测仍是会员有效时，按区域类 403 处理：Key 留在号池，有其它号池 Key 则下一跳改选。Host 启动约 2 秒后预热全部 OpenCode Go/Zen 号池（探测并改选已离开号池的当前 Key），之后每 5 分钟再刷新一次。其它 Go 403（例如模型 RegionError）不把整把 Key 标成 Invalid，保留上次分组。其它 HTTP / 网络 → `unknown`，可重试，**不编造剩余额度**。

Zen：官方 `https://opencode.ai/zen/v1` 可额外打兄弟路径 `https://opencode.ai/zen/go/v1/usage`（同一 workspace Key 可能带 Go 套餐）。403/404 则回退 `GET {baseUrl}/models`：200 → Pool 且 `remainingPercent = null`；401 → Invalid/Expired；429 + Retry-After → Cooling。自定义 Base URL 只打 `{baseUrl}/usage` 与 `{baseUrl}/models`，不改写到 opencode.ai。

### 其它 API Key 供应商 / 内置第三方渠道（`quotaQuery = "channel"`，family = null）

**不得**探测 OpenCode `/usage`，**不得**写入假 `windows`，**不得**把探测打到 `https://opencode.ai/zen/go/v1/usage`（除非该供应商自己的 baseUrl 就是该 host）。有 Base URL 时复用既有远程目录鉴权：`resolveRemoteModelCatalogUrl` + `buildRemoteModelCatalogHeaders`（`GET {baseUrl}/models`；Anthropic 无 `/v1` 时补 `/v1/models`）。Probe 传入 `family: null`。

| 结果 | 分组 |
| ---- | ---- |
| 200 | Pool，`remainingPercent = null`，无 windows |
| 401 | Invalid；message 匹配 expir → Expired |
| 429 | Cooling（Retry-After 或沿用上次 availableAt） |
| 无 Base URL / 探测不可用 | 直接入 Pool（`remainingPercent = null`），直到请求失败再经 `noteRequestFailure` 离开 |
| 网络 / 其它 HTTP | `unknown`（保留上次分组）；**不编造额度** |

探测失败不得删除 Key，也不得撤销已经成功的 batch add。

### 自定义渠道（`quotaQuery = "none"`，templateId 空）

**不做任何** HTTP 额度或 models 探测（`addKeys` / `getView` / `probeKeys` 均不发网络请求）。

- 新 `addKeys` 的 Key 直接入 `pool`（`remainingPercent = null`，无 windows，`probeError = null`），可选。
- 已存 `unknown` 在 `getView` / `probeKeys` / `addKeys` 时本地提升为 `pool`（清空 `probeError`、`windows`、`remainingPercent`、`lastCheckedAt`），修复曾被误打 models/OpenCode 探测标成 unknown 的 Key。**不**提升 `invalid` / `expired`。
- 冷却且 `availableAt` 已到期 → 本地回 `pool`（清空 `availableAt`）；未到期仍冷却。
- `probeKeys` 除上述本地提升外为 no-op，不抛错。
- `noteRequestFailure` 不变：401 标无效并切换；429 冷却并切换；403 排除当前钥并在有其它号池钥时切换。

## 分组（Host 事实，UI 只展示）

| 组      | 条件                                                                  |
| ------- | --------------------------------------------------------------------- |
| Pool    | 探测可用且额度未耗尽（无额度数字时 remaining 为 null，仍入 Pool） |
| Cooling | 额度耗尽，等待 `availableAt`（窗口重置或余额周期重置）                |
| Exhausted | 余额归零且无重置时间；不自动恢复，需充值 / 手动复检 / 换钥          |
| Expired | 鉴权失败且服务端表明过期                                              |
| Invalid | 鉴权失败 / Key 已删除 / 被拒绝                                        |
| unknown | 探测未完成或失败，保留上次分组；若无上次分组则单独展示为 unknown      |

`Exhausted` 由余额制渠道引入。它和 Cooling 一样属于「已离开号池」（`hasLeftApiKeyPool` 为 true，当前钥会被改选），但**不**进入冷却到期复检队列。UI 文案走 i18n（「没有额度」）。该页签只在 `quotaQuery === "balance"` 或该组已有 Key 时出现，OpenCode Go 的分组页签不因此多出一个空组。

UI `remainingMs = max(0, availableAt - now)`。`setTimeout` 只刷新展示，不是状态源。`remainingMs === 0` 时 UI 请求 `probeKeys`；`getView` 对到期 Cooling 也会复检。复检可用则自动回到 Pool，并清空 `availableAt`。

消失的 Key（401/已删除）进入 Invalid 或 Expired，不从存储里自动抹掉，除非用户删除。

## 当前 Key

- 用户 `selectActiveKey` 只能指定 `group === "pool"` 的成员；冷却组要等复检回池后再选。
- **创建号池或 `addKeys`：** 若 overlay 已有明文，先 `importOverlayKey`，该 Key 就是默认 `activeKeyId`。即便尚未探测、分组仍是 `unknown`，也算「还没离开」，必须继续投影这把明文。禁止用「剩余最高」抢掉一把还能用的 overlay。
- 当前 Key 仍在（`pool` 或尚未证实离开的 `unknown`）：保持不动。剩余额度只用于当前 Key **已经离开** 之后的回退，不是改选理由。
- 当前 Key 进入冷却 / 没有额度 / 过期 / 无效，或被删除：改选号池里 `remainingPercent` 最高的 Key（`null` 视为 100，适配无数字额度与 unlimited 余额）。Exhausted 与 Cooling 一样已离开号池，但没有 `availableAt`，不进入冷却到期复检。
- 号池为空且当前 Key 也已离开：`activeKeyId = null`，overlay `apiKey = null`。当前 Key 仍是 overlay/`unknown` 时，即使其它钥还没入池，也不得把 overlay 清成 `null`。
- **号池里还有成员时，禁止把 overlay 清成 `null`。** 禁止把冷却 Key 投影给 Runtime。

## 请求失败后的下一跳（不中途轮换）

Runtime **不**在同一次请求里换 Key。Host 命令 `noteRequestFailure(providerId, status)` 只改池事实和 overlay，供 **下一次** 请求读取。对 **所有** 适用供应商（含非 OpenCode）生效。`selectActiveKey` 可以改 overlay；若这把 Key 随后在连通性测试或 **chat turn.failed** 上返回 401/403/429，Host 必须调用该命令，把 overlay 改到另一把仍在号池的 Key（号池非空则不得写成 `null`）。干净钩子是 Host 已观察到的终态 `turn.failed`（及连通性测试返回），不是 SSE 中途 attempt。不要为了 500 去改官方重试环（500 是上游，换 Key 也救不了 glm 打错协议）。

| HTTP           | Host 动作                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401            | 当前 Key → Invalid（message 匹配 expir → Expired）。改选其他号池 Key。                                                                                                                                                |
| 429            | 当前 Key → Cooling；无 Retry-After 时 `availableAt = now + 60s`。改选其他号池 Key。                                                                                                                                   |
| 403            | **不要**凭状态码整钥标成 Invalid。OpenCode 先复检 `/usage`：会员不在 → Expired 并改选；仍有效则 Key 留在号池，有其它号池 Key 才换下一跳。余额渠道先复检 `/balance`：`credits == 0` → Exhausted 并改选；余额仍大于 0 则 Key 留在号池，有其它号池 Key 才换下一跳。其它渠道不复检，Key 留在号池，有其它号池 Key 才换下一跳。排除后号池为空时**保持当前 overlay**。 |
| 其它（含 500） | 忽略。不轮换、不改分组。                                                                                                                                                                                              |

```text
chat / connectivity 401/403/429
  → IProviderApiKeyPoolService.noteRequestFailure
       → 分组（401/429）或仅排除当前（403）
       → resolveActiveApiKeyId（号池非空则 overlay 必有明文）
       → savePersonalProviderOverlay
  → 下一次请求读到新 overlay
同一次 SSE/API 重试仍用当前 overlay
```

## 幂等与失败

- 同一明文再次 add → duplicate，不新建 `keyId`。
- `keyId` 稳定：密钥 SHA-256 截断，不把明文当 id。
- Overlay 同步失败记 warn，不回滚已写入的池。
- 从不在 log/test 名称外的断言文本里打印完整密钥（测试用 `sk-test-*` 占位）。

## 验收

1. 粘贴三行（空行、重复、合法）→ added/duplicate/invalid 计数正确。
2. Go usage 返回 rolling rate-limited → Cooling + countdown；到期后 Host 复检 ok → 自动回 Pool。
3. 401 Unauthorized → Invalid；401 expired → Expired。
4. 批量删除需确认；单删同样确认。
5. 单条/批量 quota 查询更新 lastChecked / remaining / reset（OpenCode）；非 OpenCode 探测不写假 windows。
6. 探测抛错后，刚 add 的 Key 仍在池中。
7. 凡 `isApiKeyAccess` 的设置卡（含 openai、自定义 standard-personal、OpenCode）走同一 `ProviderApiKeyPoolManager`；`zhipu-account` Coding Plan 卡仍无 Key 字段。
8. 当前 Key 额度耗尽 / 被 401·429 拒绝且号池还有成员 → overlay 切到剩余额度最高的号池 Key。
9. 用户在弹窗里点「使用」仅对号池 Key 生效；设置卡只显示当前 Key 摘要，添加/分组在弹窗里。
10. `noteRequestFailure(403)` 且号池还有其它 Key → overlay 换钥，当前 Key 仍在号池；仅一把号池 Key 时 overlay 不变。
11. `noteRequestFailure(401)` → 当前 Key Invalid，overlay 切到其它号池 Key；不得在仍有号池 Key 时写成 null。
12. overlay 已有明文时 `addKeys` 一批更高剩余的号池 Key → `activeKeyId` / overlay 仍是原明文（含尚未探测的 `unknown`）；非 OpenCode 同规则。
13. 当前 Key 仍在号池时，后到的更高剩余 Key 不得改 overlay。
14. chat `turn.failed` 带 403/401 且号池还有其它成员 → 下一次请求读到另一把号池 Key，不得中途轮换 SSE。
15. 官方 usage 三档齐全时，视图 `windows` 含 rolling / weekly / monthly 的 `usedPercent` 与 `resetsAt`；剩余展示为 `100 - usedPercent`。缺一档时该档不出现，另外两档仍在。分组仍由已用最高的一档决定。
16. `addKeys` 之后 `getView` 对原 overlay 的 Go `/usage` 返回 403 → 该 Key 不进入 Invalid，`activeKeyId` 仍是原 overlay。
17. `noteRequestFailure(403)` 且当前 Key 仍是 `unknown`、或排除后没有其它号池 Key → overlay 明文不变，不得写成 null。
18. Go `/usage` 返回 `EntitlementError` → `membership.state = inactive`、`renewsAt = null`、分组 Expired。200 且没有订阅续订字段 → `membership.state = active`、`renewsAt = null`，不得等于 monthly `resetsAt`。响应带 `subscription.renewsAt` / `access.endsAt` 时只写入**该 Key**；两把 Key 若各自返回不同 `endsAt`，不得互相覆盖。先前误写入的控制台日期，在下一次只有用量的探测后必须清成 `null`。RegionError 403 仍不标 Expired。
19. 内置非 OpenCode template（如 `openai`）：探测该渠道 models URL，**永不**请求 `opencode.ai/zen/go/v1/usage`；`view.quotaQuery` 为 `channel`；models 200 → Pool 且 `windows` 为空；`noteRequestFailure(429)` 切到其它号池 Key。
20. 自定义 `templateId` 为 null 且 host 不是余额制 host：`view.quotaQuery` 为 `none`；`addKeys` 不调用 probe；Key 分组为 `pool`。
21. 自定义 `getView` 将已存 `unknown` Key 本地提升为 `pool`，且不调用 probe。
22. OpenCode 仍走 `/usage`（及 Zen models 回退），三档额度行为不变；`view.quotaQuery` 为 `opencode`。OpenCode 模板即使 Base URL 被改成 `api.b.ai`，判定仍是 `opencode`，不打 `/balance`。
23. `baseUrl` 为 `https://api.b.ai/v1`、`https://api.b.ai` 或 `https://api.b.ai/v1/chat/completions`（`templateId` 为空或为 openai 等内置模板）→ `quotaQuery` 为 `balance`，探测只打 `https://api.b.ai/v1/balance`。`personal_balance: 0` 且无 `quota_reset_at` → 分组 `exhausted`，`windows` 为空，视图带 `balance.credits = 0`。`personal_balance > 0` → Pool，`remainingPercent = null`，界面显示剩余 Credits。`success: false` 保留上次分组。`api.b.ai.example.com` 不命中。
24. 余额渠道当前 Key 探测为 `exhausted`，且号池还有 `credits > 0` 的 Key → overlay 切到仍在号池的 Key。当前 Key 仍在 Pool 时，不得因另一把 Key 余额更高而换。
25. 余额渠道 `noteRequestFailure(403)` 先复检 `/balance`：余额为 0 → `exhausted` 并改选；余额仍大于 0 → 当前 Key 留在号池，有其它号池 Key 才换下一跳。OpenCode 的 403 仍只复检 `/usage`。

## 时间与所有者

```text
UI add/probe/delete
  → IProviderApiKeyPoolService（唯一 admission + 分组事实）
       → ICredentialService（密文 blob）
       → OpenCode usage/models、余额 /balance，或 generic models probe
       → IProviderSettingsService（active access.apiKey 投影）
  → onDidChange(view without secrets)
UI remainingMs 只从 availableAt 派生
```

```mermaid
sequenceDiagram
  participant UI
  participant Pool as ProviderApiKeyPoolService
  participant Cred as ICredentialService
  participant Probe as Key probe
  participant Settings as IProviderSettingsService

  UI->>Pool: addKeys / probeKeys / deleteKeys
  Pool->>Pool: serial admit per providerId
  Pool->>Cred: load/save encrypted blob
  Note over Pool: probe failure does not rollback add
  Pool->>Probe: OpenCode usage/models or generic models
  Probe-->>Pool: windows or 401/403/429 or usable-without-quota
  Pool->>Pool: group + availableAt/resetAt
  Pool->>Pool: resolve activeKeyId (keep overlay/current unless it left pool; else highest remaining)
  Pool->>Settings: overlay access.apiKey = active secret or null
  Pool-->>UI: masked view
  UI->>UI: remainingMs = availableAt - now
  UI->>Pool: probeKeys when remainingMs is 0
  Pool->>Probe: re-probe due cooling keys
  Probe-->>Pool: usable
  Pool->>Pool: re-admit to Pool
```
