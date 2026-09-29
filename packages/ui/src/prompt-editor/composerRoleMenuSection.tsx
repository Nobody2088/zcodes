import {
  Braces,
  Bug,
  CheckIcon,
  Circle,
  Cloud,
  Component,
  Container,
  Crosshair,
  Globe,
  Microscope,
  Radar,
  ScanSearch,
  Trophy,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { ComposerRoleMeta } from "@zcode/shared";
import type { MentionPanelSection } from "@/mentions/components/MentionPanel.js";

const ROLE_ICONS: Record<string, LucideIcon> = {
  默认: Circle,
  二进制分析: Microscope,
  后渗透测试: Waypoints,
  容器安全: Container,
  渗透测试: Crosshair,
  数字取证: ScanSearch,
  信息收集: Radar,
  云安全审计: Cloud,
  综合漏洞扫描: Bug,
  API安全测试: Braces,
  CTF: Trophy,
  Web框架测试: Component,
  Web应用扫描: Globe,
};

export function RoleIcon({ id }: { id: string }) {
  const Icon = ROLE_ICONS[id] ?? Circle;
  return <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />;
}

export function insertComposerRoleSection<T extends { id: string }>(
  sections: readonly T[],
  roleSection: T | null,
): T[] {
  if (!roleSection) return [...sections];
  const pluginsAt = sections.findIndex((section) => section.id === "plugins");
  if (pluginsAt < 0) return [...sections, roleSection];
  return [...sections.slice(0, pluginsAt), roleSection, ...sections.slice(pluginsAt)];
}

export function composerRoleMenuSection(
  roles: readonly ComposerRoleMeta[],
  selectedRoleId: string | undefined,
  title: string,
): MentionPanelSection | null {
  if (roles.length === 0) return null;
  return {
    id: "roles",
    title,
    emptyText: "",
    options: roles.map((role) => ({
      id: `role:${role.id}`,
      label: role.name,
      description: role.description,
      content: (
        <>
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            {selectedRoleId === role.id ? <CheckIcon className="size-3.5" /> : null}
          </span>
          <RoleIcon id={role.id} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui-base font-medium leading-5">{role.name}</span>
            <span className="mt-0.5 block truncate text-ui-sm leading-4 text-foreground-subtle">
              {role.description}
            </span>
          </span>
        </>
      ),
    })),
  };
}
