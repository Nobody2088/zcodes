import { BotIcon, ChevronDownIcon } from "lucide-react";
import { DIALOGUE_MODES, type DialogueMode } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { NARROW_COMPOSER_TOOL_ENTRY_CLASS_NAME } from "@/lib/narrowShellPresentation.js";

export function ComposerDialogueModeControl({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (mode: DialogueMode) => void;
  value: DialogueMode;
}) {
  const { intl } = useZCodeIntl();
  const shortLabel = intl.formatMessage({ id: `chat.composer.dialogueMode.${value}.short` });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          data-testid="composer-dialogue-mode"
          data-composer-collapse-priority="0"
          aria-label={intl.formatMessage({ id: "chat.composer.dialogueMode.label" })}
          // 窄屏同理：28px 视觉 + 伪元素 44px 命中区，图标回到 size-4 基线，与同行的 + / 模式 / CUA 对齐。
          className={`group/dialogue h-7 w-auto gap-1 rounded-lg px-2 text-ui-base data-[composer-compact=true]:size-7 data-[composer-compact=true]:px-0 ${NARROW_COMPOSER_TOOL_ENTRY_CLASS_NAME}`}
        >
          <BotIcon className="size-4" />
          <span className="max-w-16 truncate group-data-[composer-compact=true]/dialogue:hidden">
            {shortLabel}
          </span>
          <ChevronDownIcon className="size-3.5 group-data-[composer-compact=true]/dialogue:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={4} className="w-64 max-h-72 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as DialogueMode)}>
          {DIALOGUE_MODES.map((mode) => (
            <DropdownMenuRadioItem
              key={mode}
              value={mode}
              data-testid={`composer-dialogue-mode-${mode}`}
              className="min-h-13 items-start gap-3 py-2"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{intl.formatMessage({ id: `chat.composer.dialogueMode.${mode}` })}</span>
                <span className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: `chat.composer.dialogueMode.${mode}.description` })}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
