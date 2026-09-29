# 第三方 Provider 远程模型目录

## 行为

第三方（`standard-personal`）供应商在连接可用后，由 Host 拉取对方模型目录，写入 Personal 成员，并用目录里的上下文窗口、最大输出和输入模态覆盖智能推荐叶子。Renderer 不得自报模型名单。

OpenCode Go / Zen 的 `GET {baseUrl}/models` **不带 API type**（只有 `id` / `object` / `created` / `owned_by`），但同一 Base URL 上 chat、responses、messages 是三套互不兼容的协议。Host 必须用同 family 的 builtin 模板 `builtinModelIds` → `api.type` 索引过滤；对不上的模型不得导入，已误导入的 Personal 成员要删掉。

## Owner

`IProviderSettingsService.syncRemoteProviderModels` 是目录写入的唯一入口。成员与推荐 overlay 仍走现有 `addPersonalModel` / `savePersonalModelDraft` / `deletePersonalModel`。OpenCode 误导入成员的纠正也由该入口（以及 ProviderRuntime 启动时的本地 reconcile）完成，Renderer 不得自删名单。

`providerFacadeServices.ts` 只放 descriptor / 接口，从 `@zcode/services` 根入口给 renderer。`createProviderSettingsService` 与 `syncRemoteProviderModelsFromCatalog` 只能从 Host/`@zcode/services/node` 引入。`providerRemoteModelCatalogSync.ts` 模块顶层若执行 `createServiceLogger`（读 `process.pid`），一旦被 facade 静态导入，生产 renderer 会 `ReferenceError: process is not defined`，HTML 启动壳永不退场。

## 触发

- 连接字段（API 格式、Base URL、API Key）保存成功且连接完整时自动同步。
- 模型列表为空时导入远程目录（上限 200）。
- 已有成员时自动路径只更新智能配置中的上下文等相关叶子；显式“获取模型列表”才追加新模型。
- 官方 `zai-family` / `bigmodel-family` 不走此路径。
- 目录请求失败不得回滚刚保存的连接配置；本地 API-type 纠正不依赖目录 HTTP。
- ProviderRuntime 启动、Registry 就绪后，对 OpenCode family 的 Personal 供应商做一次本地 reconcile（不打 `/models`）。**就绪 Promise 只覆盖 Config + Registry**；reconcile 挂在就绪之后的独立任务上。`ensureReady()` / `modelSelection.getView()` / Root 首屏不得等待 prune。prune 抛错只 warn，不得拒绝 `start()`，也不得把 `#startPromise` 清掉重入。

## API type（fail closed）

- 非 OpenCode 个人供应商：保持原导入规则（远程目录通常也没有 API type）。
- OpenCode Go / Zen（`resolveOpenCodeApiKeyPoolFamily(templateId)` 非空）：
  - 用同 family 模板的 `builtinModelIds` 建立 `modelId → api.type` 索引。
  - **导入 / 追加 / 更新推荐叶子**：只接受索引中 `api.type` 与当前供应商 `effectiveConfig.api.type` 相同的 modelId。
  - **索引里没有的 id**：不导入（fail closed）。不根据 `/models` 猜测。
  - **已有 Personal 成员**（`builtin === false`）若在索引中且 API type 不同：Host `deletePersonalModel`，不留在选择器里。索引没有的已有成员不动。
  - builtin 继承成员不删。
  - 同一 modelId 被同 family 两套不同 `api.type` 同时声明：视为冲突，两边都不导入。
- 已有成员时仍然 **不得** 把整份远端目录（可能 200+）倒进现有列表；自动路径不追加新 ID。

## 时间与幂等

- 按 `providerId` 串行；重复同步跳过已存在的 modelId。
- 手动配置（`useRecommendedConfig === false`）不被远程覆盖。
- 远程未给出某叶子时保留当前智能推荐。
- 纠正删除可重复执行；已对齐的成员不再写入。
- 每个 `deletePersonalModel` 都会刷新 Registry 并广播模型选择。启动期若把 N 次删除 `await` 进 `start()`，已经挂上的 Root 会停在 `RootStartupLoading`。因此 prune 必须发生在就绪之后，且失败可恢复。
- 启动壳（模糊背景 + Z）永不退场是另一条门闩：Main `ServicePort` 与 `DatabaseStartupState.ready` 必须同代配对，见 `packages/shared/src/specs/database-startup-service-port.md`。已选模型被 prune 掉或 `getView` 失败不得反向拖住该门闩。
