import { KeyRound } from "lucide-react";
import type { ProviderApiKeyPoolKeyView } from "@zcode/services";
import {
  TID_MODEL_PROVIDER_API_KEY_POOL_COPY,
  TID_MODEL_PROVIDER_API_KEY_POOL_CURRENT,
  testId,
} from "@zcode/shared";
import { Badge } from "@/components/ui/badge.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";
import { ProviderApiKeyPoolCopyButton } from "./ProviderApiKeyPoolCopyButton.js";
import { ProviderApiKeyPoolQuotaMeters } from "./ProviderApiKeyPoolQuotaMeters.js";

export function ProviderApiKeyPoolCurrent({
  item,
  onCopy,
}: {
  item: ProviderApiKeyPoolKeyView | null;
  onCopy?: (keyId: string) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();

  return (
    <div
      data-testid={
        item
          ? testId(TID_MODEL_PROVIDER_API_KEY_POOL_CURRENT, item.keyId)
          : TID_MODEL_PROVIDER_API_KEY_POOL_CURRENT
      }
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-2.5 py-2",
        item ? "border-success/20 bg-success/5" : "border-border bg-surface",
      )}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-input">
        <KeyRound className="size-3.5 text-foreground-subtle" />
      </div>
      <div className="min-w-0 flex-1">
        {item ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              {item.label ? (
                <span className="max-w-28 shrink-0 truncate rounded-md bg-accent px-1.5 py-0.5 text-ui-sm font-medium text-foreground">
                  {item.label}
                </span>
              ) : null}
              <code className="min-w-0 flex-1 truncate font-mono text-ui-base text-foreground">
                {item.maskedKey}
              </code>
              {onCopy ? (
                <ProviderApiKeyPoolCopyButton
                  testId={testId(TID_MODEL_PROVIDER_API_KEY_POOL_COPY, item.keyId)}
                  onCopy={() => onCopy(item.keyId)}
                />
              ) : null}
              <Badge className="shrink-0 rounded-md border-success/20 bg-success/10 text-success">
                {intl.formatMessage({ id: "settings.modelProvider.keyPool.usingKey" })}
              </Badge>
            </div>
            <div className="mt-2">
              <ProviderApiKeyPoolQuotaMeters
                membership={item.membership}
                windows={item.windows}
                balance={item.balance}
              />
            </div>
          </>
        ) : (
          <div className="text-ui-base text-foreground">
            {intl.formatMessage({ id: "settings.modelProvider.keyPool.noCurrentKey" })}
          </div>
        )}
      </div>
    </div>
  );
}
