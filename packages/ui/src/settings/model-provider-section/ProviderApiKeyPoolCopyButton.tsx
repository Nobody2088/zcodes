import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

const COPIED_MS = 1400;

export function ProviderApiKeyPoolCopyButton({
  testId,
  onCopy,
}: {
  testId: string;
  onCopy: () => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-testid={testId}
      aria-label={intl.formatMessage({
        id: copied
          ? "settings.modelProvider.keyPool.copied"
          : "settings.modelProvider.keyPool.copy",
      })}
      className={cn(
        "transition-colors duration-200",
        copied && "bg-success/15 text-success hover:bg-success/20 hover:text-success",
      )}
      onClick={() => {
        void onCopy()
          .then(() => {
            setCopied(true);
            if (timerRef.current != null) window.clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(() => setCopied(false), COPIED_MS);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? (
        <CheckIcon className="size-3.5 scale-110 transition-transform" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </Button>
  );
}
