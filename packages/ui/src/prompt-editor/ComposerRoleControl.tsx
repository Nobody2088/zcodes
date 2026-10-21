import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { listSelectableComposerRoles } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { RoleIcon } from "@/prompt-editor/composerRoleMenuSection.js";
import { NARROW_COMPOSER_TOOL_ENTRY_CLASS_NAME } from "@/lib/narrowShellPresentation.js";

export function ComposerRoleControl({
  disabled,
  onChange,
  roleId,
}: {
  disabled?: boolean;
  onChange: (roleId: string) => void;
  roleId: string;
}) {
  const roles = listSelectableComposerRoles();
  const current = roles.find((role) => role.id === roleId);
  const label = current?.name ?? roleId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          data-testid="composer-role"
          data-composer-collapse-priority="1"
          aria-label={label}
          // 窄屏不再用 max-md:h-11 撑高：整行工具入口统一 28px 视觉，44px 命中区由伪元素补（见常量注释）。
          className={`group/role h-7 w-auto max-w-28 gap-1 rounded-lg px-2 text-ui-base data-[composer-compact=true]:size-7 data-[composer-compact=true]:px-0 ${NARROW_COMPOSER_TOOL_ENTRY_CLASS_NAME}`}
        >
          <RoleIcon id={roleId} />
          <span className="min-w-0 truncate group-data-[composer-compact=true]/role:hidden">{label}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 group-data-[composer-compact=true]/role:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={4} className="w-64 max-h-72 overflow-y-auto">
        <DropdownMenuRadioGroup value={roleId} onValueChange={onChange}>
          {roles.map((role) => (
            // 行内截断短句；悬停在右侧展示 detail 正文。z-[70] 高于菜单 z-60。
            <ControlHintTooltip
              key={role.id}
              title={role.name}
              description={role.detail}
              side="right"
              align="start"
              sideOffset={8}
              className="z-[70]"
            >
              <DropdownMenuRadioItem
                value={role.id}
                data-testid={`composer-role-${role.id}`}
                className="min-h-11 items-start gap-2 py-1.5 max-md:min-h-9"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  {role.id === roleId ? <CheckIcon className="size-3.5" /> : null}
                </span>
                <RoleIcon id={role.id} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-ui-base font-medium leading-5">{role.name}</span>
                  <span className="truncate text-ui-sm leading-4 text-foreground-subtle">
                    {role.description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            </ControlHintTooltip>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
