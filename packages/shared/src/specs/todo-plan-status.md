# 待办状态与对号

## 行为

TodoWrite 的最新成功列表是当前待办的唯一事实。每一项保持原顺序，状态只在 `pending`、`in_progress`、`completed` 之间变化。

- `completed`、`complete`、`done`、`finished`、`checked`、`success` 都是已完成。
- `in_progress`、`inProgress`、`in-progress`、`running`、`doing`、`current` 都是进行中。
- `pending`、`todo`、`open`、`waiting`，以及认不出的状态，都是未开始。认不出的状态不得让整份列表投影失败，否则同一次写入里已经完成的项会一直停在空框。
- 结果里同时有 `oldTodos` 和 `todos` 时，只采用 `todos`。

界面上：

- 未开始是空框。
- 进行中是高亮空框，不画对号。
- 已完成在同一位置打上对号。不按状态把条目挪到列表末尾。

消息流里的待办卡片如果还能对上当前列表的 id 或原文，跟随这次最新状态打对号。对不上的历史卡片保持自己那一次的快照。

## Owner

- 会话待办的写入所有者是 CLI `TodoWrite`。
- 对话里的 live plan 由 V4 `todoPlanDeltas` 从同一次工具输入或成功结果投影，不另存一份待办。
- 状态词归一化只在 `packages/shared/src/tool-plan-adapter.ts`。UI 只读投影后的状态。

## 不变量

- 完成项留在原下标。
- 一次非法状态不能吞掉同列表里的 `completed`。
- 子代理镜像的 TodoWrite 不覆盖主任务列表（沿用 `isMainAgentToolProjectionSource`）。
