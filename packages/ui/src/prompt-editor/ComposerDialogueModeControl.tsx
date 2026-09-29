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
          className="group/dialogue h-7 w-auto gap-1 rounded-lg px-2 text-ui-base max-md:h-11 data-[composer-compact=true]:size-7 data-[composer-compact=true]:px-0"
        >
          <BotIcon className="size-4 max-md:size-5" />
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
