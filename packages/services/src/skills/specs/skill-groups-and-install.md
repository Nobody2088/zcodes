# 技能分组与在线安装

## 行为

设置页在现有「用户 / 当前工作区」范围下用横向标签切换分组，一次只显示当前分组里的技能。分组可以新建、改名、左右排序和删除。删除分组只去掉归属，组内技能回到「未分组」，不删除技能目录。「未分组」不是分组记录，不能改名或删除。空分组可以先建好。

内置官方技能在用户范围分组文件第一次创建时预置到：浏览器、文档、规划、设备、技能创作。技能创作预置含 `agent-bypass`、`skill-creator`、`plugin-creator`。之后以该文件为准。用户改过名称、顺序、归属或删过预置分组后，不再重新套用预置。

在线安装接受 GitHub 仓库 URL，整库安装其中每个 `SKILL.md`。安装时选择分组、可选的激活关键词，以及安装位置：

- 通用技能：`~/.zcode/skills/<name>/`
- 当前项目独立技能：`<workspacePath>/.zcode/skills/<name>/`

路径使用 `workspacePath`。`workspaceIdentity?.trim() || workspacePath` 只用于请求关联，不决定目录。

适配保留技能正文，并把 frontmatter 收成 ZCode 可加载字段：`name`、`description`、可选的 `when_to_use`、`license`、`metadata`、`activation_keywords`。`description` 按原文保存，不再因为超过 1024 字符拒绝加载。中文展示说明写入 `descriptionZh`。设置页与 Composer `$` 技能列表在 `zh-CN` 下都通过 `resolveSkillDisplayDescription` 优先显示它。Composer `$` 走 `skills/referenceCatalog`（不是 Settings 的 `ISkillsService.list`）：CLI 发现时从 `_meta.json` 读入 `descriptionZh`，并对 plugin/内置技能合并用户分组文件里的 `descriptionZhBySkillKey` overlay，再放入 catalog entry 的 `metadata.descriptionZh`。Agent 目录注入仍把每条说明摘到 250 字符。

### 说明中文翻译

只翻译技能的英文/原文 `description` 字段，不翻译整份 `SKILL.md`。翻译器为 Google Translate 免密钥端点：

`GET https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=`

解析嵌套 JSON 数组中的译文片段并拼接。超时、非 200、空结果记为该技能失败，不中断整批。并发最多 3 个。日志不写凭据或完整用户原文。路径仍用 `workspacePath`；`workspaceIdentity` 只用于请求关联。

判定：原文 `description` 已以汉字为主（Han 字符数不少于拉丁字母数）时跳过，计入「已是中文」；若尚无 `descriptionZh`，把原文写入 `descriptionZh`。否则请求翻译并保存。

设置页「翻译全部 / 当前分组 / 单条」针对**当前已发现并列出的技能**（含此前安装、手动放入目录、仅有 `SKILL.md` 尚无 `_meta.json` 的技能，以及 `~/.agents/skills` / `<workspace>/.agents/skills` 兼容根下的用户与工作区技能），不是只翻本会话刚装的一批。在线安装成功后另有一条「仅新装条目」批翻译，与设置页全量动作互补。

`descriptionZh` 写入位置（唯一写入方仍是 `ISkillsService`）：

- `user` / `workspace` 技能：技能目录 `_meta.json.descriptionZh`。目录可写时**创建或更新**该文件；已有 `activationKeywords`、`source` 及其他字段必须合并保留，不得整文件覆盖丢键。
- `plugin` / 内置等不可写目录：不修改技能目录；写入用户范围分组文件 `~/.zcode/cli/skill-groups.json` 的 `descriptionZhBySkillKey`，键为 `skillGroupAssignmentKey(scope, name)`（如 `plugin:control-browser`）。Settings `list` 与 Composer `skills/referenceCatalog` 都把该 overlay 合并进展示用的 `metadata.descriptionZh`（`_meta.json` 已有值时优先）。

翻译保存后，无需重装：`ISkillsService.list` 再扫目录即读回 `_meta.json` / overlay；`resolveSkillDisplayDescription`（设置页与 Composer `$`）在 `zh-CN` 下优先展示该字段。Composer `$` 走 `skills/referenceCatalog`：CLI 发现时从 `_meta.json` 读入 `descriptionZh`，并对 plugin/内置技能合并用户分组文件里的 `descriptionZhBySkillKey` overlay。

设置页动作（网络在 Host/`ISkillsService`，不阻塞渲染进程 HTTP）：

- 翻译当前范围全部技能（含所有分组与未分组，含已安装存量）。
- 翻译当前选中分组。
- 翻译单行技能。

结果用现有 toast 汇总：已翻译 / 已跳过（已是中文）/ 失败。在线安装与检查更新写入技能后，对仍缺中文说明的新装技能调用同一翻译函数；翻译失败时回退为「{分组名}中的技能「{名称}」。」。

### 激活关键词

安装对话框提供「激活关键词」字段。解析规则：按空白、英文逗号 `,`、中文逗号 `，` 切分；trim；丢弃空串；大小写不敏感去重。硬限制：**最多 20 个关键词，每个 1–32 个字符**。超出数量或单词超长时整次安装拒绝并返回明确错误，不静默截断。

用户填写的关键词是**安装包级额外触发词**：同一次安装写入该包内每一个技能。每个技能还自动带有**名称派生关键词**（按 `-` / `_` 拆分技能名，空段丢弃）；派生词在匹配时计算，不必单独持久化。

持久化双写，使桌面列表与 Agent 运行时都能读到，且不依赖 UI：

- `_meta.json.activationKeywords: string[]`（桌面 `SkillMetadata` 与设置页展示）
- `SKILL.md` frontmatter 顶层标量 `activation_keywords`（空格/逗号分隔）。CLI 的 flat YAML 解析器读不到嵌套 `metadata`，因此不用 `when_to_use` / 嵌套 `metadata` 承载关键词，而是把 `activation_keywords` 列为与 `name`/`description` 同等的安全 frontmatter 键。运行时优先读 frontmatter，再用同目录 `_meta.json` 补齐。

检查更新同一来源时：若本次未提交新关键词，保留原 `_meta.json` / frontmatter 中的 `activationKeywords`；提交了则覆盖。

### 自动调用

用户消息进入 Agent 回合、模型作答之前，对当前已发现且启用的技能做确定性匹配。命中唯一胜者时，把该回合提示改写为与 `/skill` 相同的强制 Skill 工具契约（`buildManualSkillPrompt` / 同等文案）：先调用 `Skill` 工具加载该技能，再继续用户请求。不在此路径直接执行或注入技能正文。

匹配规则：

- 大小写不敏感。
- ASCII 关键词按词边界匹配；含 CJK 的关键词按子串匹配。
- 计分：先比最长命中关键词长度，再比命中次数；取唯一最高分者。
- **包级共享词不得激活全部技能**：当启用技能数 ≥ 2 时，出现在每一个启用技能上的关键词视为共享词。技能胜出仅当它至少命中一个非共享词，或仅凭名称派生关键词得分且为唯一最高。共享词单独命中、或多个技能并列最高分时，不强制调用。
- 仅启用且已发现的技能参与；禁用或未发现的忽略。

`_meta.json` 同时记录 GitHub 来源（owner、repo、url、commit、安装时的 groupId）。检查更新比较该 commit 与远端当前提交。更新覆盖同一来源的技能目录并安装新增技能，不删除目录里其他技能。同名目录若已属于别的来源，跳过并在结果里报告。

## Owner

`ISkillsService` 是分组文件、安装目录、`_meta.json` 来源字段与 `descriptionZh`（含 plugin overlay）的唯一写入方。设置页只提交命令并展示返回的文档与翻译计数。

- 用户范围分组：`~/.zcode/cli/skill-groups.json`（含 `descriptionZhBySkillKey` overlay）
- 项目范围分组：`<workspacePath>/.zcode/skill-groups.json`
- 内置技能和通用技能的归属写在用户范围文件。项目技能的归属写在项目范围文件。

同一分组文件的读-改-写按路径串行。安装先下载和解压，再重新读取分组文件，只补上本次新技能的归属；下载期间的改名、排序和移动保留。分组若在下载期间被删除，新技能进入未分组。安装和解压使用临时目录，失败时删除临时目录。单个技能先写入同级隐藏临时目录，成功后再替换原目录；替换失败则把原目录移回。翻译在安装归属写完后异步批处理，单条失败不影响已成功条目。

## 失败

- 分组名为空、重名、排序不是现有分组的完整排列、或指向不存在的分组：拒绝写入。
- URL 不是 GitHub 仓库、下载失败、解压失败、或开始时目标分组不存在：不改分组归属，也不替换已有技能目录。
- 激活关键词超过 20 个、某个关键词长度不在 1–32、或输入无法解析为合法列表：拒绝安装，返回 `skill-install:activation-keywords-*` 类错误，不写入技能目录。
- 损坏的分组文件不自动覆盖。列表按空文档展示，变更和安装归属写入失败。
- 同一仓库里只要有一个技能的 commit 与远端不同，检查更新就标记可更新。单个仓库查询失败只跳过该仓库。
- 说明超过 1024 字符不再产生 `skill_description_too_long`。
- 单条翻译超时 / 非 200 / 空译文：计入 failed，已成功写入的 `descriptionZh` 保留。

## 时间

安装与更新按一次命令跑完：解析 URL → 读取远端 commit → 下载 tar.gz → 系统 `tar` 解压 → 写入技能目录 → 写入归属 → 对缺中文说明的新技能批翻译。重复安装同一 commit 覆盖同一来源的目录，归属若已存在则保留。桌面设置走 Host 上的 `ISkillsService`，不在渲染进程下载或调用翻译端点。
