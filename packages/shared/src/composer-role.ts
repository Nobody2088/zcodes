import { z } from "zod";

/** 角色目录里的「默认」。选中它不加提示词。没选过任何角色时 roleId 缺省，不要用这个常量表示未选择。 */
export const COMPOSER_ROLE_DEFAULT_ID = "默认";

/** 角色目录里的「重构项目」。固定排在「默认」后面，携带整份保真重构技能包。 */
export const COMPOSER_ROLE_REBUILD_ID = "重构项目";

/** 悬停用的技能简介。整包 userPrompt 不进气泡。 */
export const COMPOSER_ROLE_REBUILD_DETAIL =
  "用于在允许彻底重做内部架构的前提下，对 Web、桌面或混合应用执行原项目 1:1 兼容重构；保留功能、页面、UI、主题、交互、动画、响应式、数据、快捷键、桌面能力、错误恢复、无障碍和外部副作用，并以可审计基线、行为契约、对照测试和发布门禁证明等价性。";

export const DIALOGUE_MODES = ["eino_single", "deep", "plan_execute", "supervisor"] as const;
export type DialogueMode = (typeof DIALOGUE_MODES)[number];
export const dialogueModeSchema = z.enum(DIALOGUE_MODES);
export const DEFAULT_DIALOGUE_MODE: DialogueMode = "deep";

export interface ComposerRoleMeta {
  id: string;
  name: string;
  description: string;
  /** 悬停正文。普通角色等于 YAML user_prompt；重构项目只用技能简介。 */
  detail: string;
  icon?: string;
  enabled: boolean;
}

/** 给界面的角色目录。不含 user_prompt。 */
export const COMPOSER_ROLE_CATALOG: readonly ComposerRoleMeta[] = [
  {
    id: "默认",
    name: "默认",
    description: "默认角色，不额外携带用户提示词，使用默认MCP",
    detail: "默认角色，不额外携带用户提示词，使用默认MCP",
    icon: "🔵",
    enabled: true,
  },
  {
    id: "重构项目",
    name: "重构项目",
    description: "内部架构可重做，外部表现按原项目 1:1 保留",
    detail: COMPOSER_ROLE_REBUILD_DETAIL,
    icon: "🔄",
    enabled: true,
  },
  {
    id: "二进制分析",
    name: "二进制分析",
    description: "二进制分析与利用专家，擅长逆向工程和密码破解",
    detail:
      "你是一个专业的二进制分析与利用专家。请使用逆向工程工具分析二进制文件，识别漏洞，进行利用开发。同时擅长密码破解、哈希分析等技术。",
    icon: "🔬",
    enabled: true,
  },
  {
    id: "后渗透测试",
    name: "后渗透测试",
    description: "后渗透测试专家，权限维持与横向移动",
    detail:
      "你是一个专业的后渗透测试专家。请使用专业的后渗透工具在获得初始访问权限后进行权限提升、横向移动、权限维持、数据收集等后渗透测试工作。",
    icon: "🕵",
    enabled: true,
  },
  {
    id: "容器安全",
    name: "容器安全",
    description: "容器与Kubernetes安全专家，容器环境安全检测",
    detail:
      "你是一个专业的容器与Kubernetes安全专家。请使用专业的容器安全工具对Docker容器和Kubernetes集群进行全面的安全检测，包括镜像漏洞扫描、配置检查、运行时安全等工作。",
    icon: "🛡",
    enabled: true,
  },
  {
    id: "渗透测试",
    name: "渗透测试",
    description: "专业渗透测试专家，全面深入的漏洞检测",
    detail:
      "你是一个专业的网络安全渗透测试专家。请使用专业的渗透测试方法和工具，对目标进行全面的安全测试，包括但不限于SQL注入、XSS、CSRF、文件包含、命令执行等常见漏洞。",
    icon: "🎯",
    enabled: true,
  },
  {
    id: "数字取证",
    name: "数字取证",
    description: "数字取证与隐写分析专家，文件与内存取证",
    detail:
      "你是一个专业的数字取证与隐写分析专家。请使用专业的取证工具对文件、磁盘镜像、内存转储进行分析，提取证据信息。同时擅长隐写分析、数据恢复、元数据提取等技术。",
    icon: "🔎",
    enabled: true,
  },
  {
    id: "信息收集",
    name: "信息收集",
    description: "资产发现与信息搜集专家",
    detail:
      "你是一个专业的信息收集专家。请使用各种信息收集技术和工具，对目标进行全面的资产发现、子域名枚举、端口扫描、服务识别等信息收集工作。",
    icon: "🔍",
    enabled: true,
  },
  {
    id: "云安全审计",
    name: "云安全审计",
    description: "云安全审计专家，多云环境安全检测",
    detail:
      "你是一个专业的云安全审计专家。请使用专业的云安全工具对AWS、Azure、GCP等云环境进行全面的安全审计，包括配置检查、合规性评估、权限审计、安全最佳实践验证等工作。",
    icon: "☁",
    enabled: true,
  },
  {
    id: "综合漏洞扫描",
    name: "综合漏洞扫描",
    description: "综合漏洞扫描专家，多类型漏洞检测",
    detail:
      "你是一个专业的综合漏洞扫描专家。请使用各种漏洞扫描工具对目标进行全面的安全检测，包括Web漏洞、网络服务漏洞、配置缺陷等多种类型的漏洞识别和分析。",
    icon: "⚠",
    enabled: true,
  },
  {
    id: "API安全测试",
    name: "API安全测试",
    description: "API安全测试专家，专注于API接口安全检测",
    detail:
      "你是一个专业的API安全测试专家。请使用专业的API测试工具对目标API接口进行全面的安全检测，包括GraphQL安全、API参数fuzzing、JWT分析、API架构分析等工作。",
    icon: "📡",
    enabled: true,
  },
  {
    id: "CTF",
    name: "CTF",
    description: "CTF竞赛专家，擅长解题和漏洞利用",
    detail: "你是一个CTF竞赛专家。请使用CTF解题思维和方法，快速定位和利用漏洞，解决各类CTF题目。",
    icon: "🏆",
    enabled: true,
  },
  {
    id: "Web框架测试",
    name: "Web框架测试",
    description: "Web框架安全测试专家，专注于Web应用框架漏洞检测",
    detail:
      "你是一个专业的Web框架安全测试专家。请使用专业的工具对Web应用框架进行安全测试，识别框架相关的安全漏洞和配置问题。",
    icon: "🌐",
    enabled: true,
  },
  {
    id: "Web应用扫描",
    name: "Web应用扫描",
    description: "Web应用漏洞扫描专家，全面的Web安全检测",
    detail:
      "你是一个专业的Web应用漏洞扫描专家。请使用各种Web扫描工具对目标Web应用进行全面的安全检测，包括目录枚举、文件扫描、漏洞识别等工作。",
    icon: "🌐",
    enabled: true,
  },
];

function pinnedComposerRoleRank(id: string): number {
  if (id === COMPOSER_ROLE_DEFAULT_ID) return 0;
  if (id === COMPOSER_ROLE_REBUILD_ID) return 1;
  return 2;
}

export function listSelectableComposerRoles(): ComposerRoleMeta[] {
  return COMPOSER_ROLE_CATALOG.filter((role) => role.enabled).sort((a, b) => {
    const rank = pinnedComposerRoleRank(a.id) - pinnedComposerRoleRank(b.id);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name, "zh");
  });
}

export function isDialogueMode(value: unknown): value is DialogueMode {
  return dialogueModeSchema.safeParse(value).success;
}

/** 对话模式始终显示。没存过时用 Deep，之后以用户改过的值为准。 */
export function visibleDialogueMode(
  _roleId: string | undefined,
  dialogueMode: DialogueMode | undefined,
): DialogueMode {
  return dialogueMode ?? DEFAULT_DIALOGUE_MODE;
}

/** 输入栏始终显示一个角色。没存过时显示「默认」。 */
export function visibleComposerRoleId(roleId: string | undefined): string {
  return roleId && roleId.length > 0 ? roleId : COMPOSER_ROLE_DEFAULT_ID;
}
