import { z } from "zod";

/** 角色目录里的「默认」。选中它不加提示词。没选过任何角色时 roleId 缺省，不要用这个常量表示未选择。 */
export const COMPOSER_ROLE_DEFAULT_ID = "默认";

export const DIALOGUE_MODES = ["eino_single", "deep", "plan_execute", "supervisor"] as const;
export type DialogueMode = (typeof DIALOGUE_MODES)[number];
export const dialogueModeSchema = z.enum(DIALOGUE_MODES);
export const DEFAULT_DIALOGUE_MODE: DialogueMode = "deep";

export interface ComposerRoleMeta {
  id: string;
  name: string;
  description: string;
  icon?: string;
  enabled: boolean;
}

/** 给界面的角色目录。不含 user_prompt。 */
export const COMPOSER_ROLE_CATALOG: readonly ComposerRoleMeta[] = [
  {
    "id": "默认",
    "name": "默认",
    "description": "默认角色，不额外携带用户提示词，使用默认MCP",
    "icon": "🔵",
    "enabled": true
  },
  {
    "id": "二进制分析",
    "name": "二进制分析",
    "description": "二进制分析与利用专家，擅长逆向工程和密码破解",
    "icon": "🔬",
    "enabled": true
  },
  {
    "id": "后渗透测试",
    "name": "后渗透测试",
    "description": "后渗透测试专家，权限维持与横向移动",
    "icon": "🕵",
    "enabled": true
  },
  {
    "id": "容器安全",
    "name": "容器安全",
    "description": "容器与Kubernetes安全专家，容器环境安全检测",
    "icon": "🛡",
    "enabled": true
  },
  {
    "id": "渗透测试",
    "name": "渗透测试",
    "description": "专业渗透测试专家，全面深入的漏洞检测",
    "icon": "🎯",
    "enabled": true
  },
  {
    "id": "数字取证",
    "name": "数字取证",
    "description": "数字取证与隐写分析专家，文件与内存取证",
    "icon": "🔎",
    "enabled": true
  },
  {
    "id": "信息收集",
    "name": "信息收集",
    "description": "资产发现与信息搜集专家",
    "icon": "🔍",
    "enabled": true
  },
  {
    "id": "云安全审计",
    "name": "云安全审计",
    "description": "云安全审计专家，多云环境安全检测",
    "icon": "☁",
    "enabled": true
  },
  {
    "id": "综合漏洞扫描",
    "name": "综合漏洞扫描",
    "description": "综合漏洞扫描专家，多类型漏洞检测",
    "icon": "⚠",
    "enabled": true
  },
  {
    "id": "API安全测试",
    "name": "API安全测试",
    "description": "API安全测试专家，专注于API接口安全检测",
    "icon": "📡",
    "enabled": true
  },
  {
    "id": "CTF",
    "name": "CTF",
    "description": "CTF竞赛专家，擅长解题和漏洞利用",
    "icon": "🏆",
    "enabled": true
  },
  {
    "id": "Web框架测试",
    "name": "Web框架测试",
    "description": "Web框架安全测试专家，专注于Web应用框架漏洞检测",
    "icon": "🌐",
    "enabled": true
  },
  {
    "id": "Web应用扫描",
    "name": "Web应用扫描",
    "description": "Web应用漏洞扫描专家，全面的Web安全检测",
    "icon": "🌐",
    "enabled": true
  }
];

export function listSelectableComposerRoles(): ComposerRoleMeta[] {
  return COMPOSER_ROLE_CATALOG.filter((role) => role.enabled).sort((a, b) => {
    if (a.id === COMPOSER_ROLE_DEFAULT_ID) return -1;
    if (b.id === COMPOSER_ROLE_DEFAULT_ID) return 1;
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
