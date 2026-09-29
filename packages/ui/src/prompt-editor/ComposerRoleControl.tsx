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
import { RoleIcon } from "@/prompt-editor/composerRoleMenuSection.js";

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
          className="group/role h-7 w-auto max-w-28 gap-1 rounded-lg px-2 text-ui-base max-md:h-11 data-[composer-compact=true]:size-7 data-[composer-compact=true]:px-0"
        >
          <RoleIcon id={roleId} />
          <span className="min-w-0 truncate group-data-[composer-compact=true]/role:hidden">{label}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 group-data-[composer-compact=true]/role:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={4} className="w-64 max-h-72 overflow-y-auto">
        <DropdownMenuRadioGroup value={roleId} onValueChange={onChange}>
          {roles.map((role) => (
            <DropdownMenuRadioItem
              key={role.id}
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
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
