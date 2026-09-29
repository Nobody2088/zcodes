import { EyeIcon, EyeOffIcon, RefreshCw, Trash2 } from "lucide-react";
import type { ProviderApiKeyPoolKeyView } from "@zcode/services";
import {
  TID_MODEL_PROVIDER_API_KEY_POOL_COPY,
  TID_MODEL_PROVIDER_API_KEY_POOL_DELETE,
  TID_MODEL_PROVIDER_API_KEY_POOL_REFRESH,
  TID_MODEL_PROVIDER_API_KEY_POOL_REVEAL,
  TID_MODEL_PROVIDER_API_KEY_POOL_ROW,
  TID_MODEL_PROVIDER_API_KEY_POOL_SELECT,
  TID_MODEL_PROVIDER_API_KEY_POOL_USE,
  testId,
} from "@zcode/shared";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Spinner } from "@/components/ui/spinner.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";
import type { ApiKeyPoolLane } from "./providerApiKeyPoolPresentation.js";
import { formatApiKeyPoolCountdownParts } from "./providerApiKeyPoolPresentation.js";
import { ProviderApiKeyPoolCopyButton } from "./ProviderApiKeyPoolCopyButton.js";
import { ProviderApiKeyPoolQuotaMeters } from "./ProviderApiKeyPoolQuotaMeters.js";

export function ProviderApiKeyPoolRow({
  item,
  selected,
  revealed,
  remainingMs,
  probing,
  readOnly,
  isActive,
  quotaQueryEnabled = true,
  onToggleSelect,
  onReveal,
  onHide,
  onRefresh,
  onDelete,
  onUse,
  onCopy,
}: {
  item: ProviderApiKeyPoolKeyView;
  selected: boolean;
  revealed: string | null;
  remainingMs: number | null;
  probing: boolean;
  readOnly?: boolean;
  isActive: boolean;
  quotaQueryEnabled?: boolean;
  onToggleSelect: () => void;
  onReveal: () => void;
  onHide: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onUse: () => void;
  onCopy: () => Promise<void>;
}) {
  const { intl, locale } = useZCodeIntl();
  const group = item.group as ApiKeyPoolLane;
  const checkedLabel = item.lastCheckedAt
    ? intl.formatMessage(
        { id: "settings.modelProvider.keyPool.lastChecked" },
        { time: new Date(item.lastCheckedAt).toLocaleString(locale) },
      )
    : intl.formatMessage({ id: "settings.modelProvider.keyPool.neverChecked" });
  const canUse = item.group === "pool" && !isActive && !readOnly;

  return (
    <div
      data-testid={testId(TID_MODEL_PROVIDER_API_KEY_POOL_ROW, item.keyId)}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-surface px-2.5 py-2 md:flex-row md:items-start md:gap-3",
        isActive ? "border-success/30 bg-success/5" : "border-border",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Checkbox
          data-testid={testId(TID_MODEL_PROVIDER_API_KEY_POOL_SELECT, item.keyId)}
          checked={selected}
          disabled={readOnly}
          onCheckedChange={onToggleSelect}
          aria-label={intl.formatMessage({ id: "settings.modelProvider.keyPool.selectAll" })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {item.label ? (
              <span className="max-w-28 truncate rounded-md bg-accent px-1.5 py-0.5 text-ui-sm font-medium text-foreground">
                {item.label}
              </span>
            ) : null}
            <code className="truncate font-mono text-ui-base text-foreground">
              {revealed ?? item.maskedKey}
            </code>
            <Badge className={cn("rounded-md", groupBadgeClass(group))}>
              {intl.formatMessage({ id: `settings.modelProvider.keyPool.group.${group}` })}
            </Badge>
            {isActive ? (
              <Badge className="rounded-md border-success/20 bg-success/10 text-success">
                {intl.formatMessage({ id: "settings.modelProvider.keyPool.usingKey" })}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-xs text-foreground-subtle">
            {remainingMs != null ? (
              <span className="font-mono tabular-nums text-warning">
                {intl.formatMessage(
                  { id: "settings.modelProvider.keyPool.cooldown" },
                  { time: formatCountdown(intl.formatMessage, remainingMs) },
                )}
              </span>
            ) : null}
            <span>{checkedLabel}</span>
          </div>
          <div className="mt-2">
            <ProviderApiKeyPoolQuotaMeters
              membership={item.membership}
              windows={item.windows}
              balance={item.balance}
            />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1">
        {canUse ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={testId(TID_MODEL_PROVIDER_API_KEY_POOL_USE, item.keyId)}
            onClick={onUse}
          >
            {intl.formatMessage({ id: "settings.modelProvider.keyPool.useKey" })}
          </Button>
        ) : null}
        <ProviderApiKeyPoolCopyButton
          testId={testId(TID_MODEL_PROVIDER_API_KEY_POOL_COPY, item.keyId)}
          onCopy={onCopy}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-testid={testId(TID_MODEL_PROVIDER_API_KEY_POOL_REVEAL, item.keyId)}
          aria-label={intl.formatMessage({
            id: revealed
              ? "settings.modelProvider.keyPool.hide"
              : "settings.modelProvider.keyPool.reveal",
          })}
          onClick={revealed ? onHide : onReveal}
        >
          {revealed ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
        </Button>
        {quotaQueryEnabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-testid={testId(TID_MODEL_PROVIDER_API_KEY_POOL_REFRESH, item.keyId)}
            disabled={readOnly || probing}
            aria-label={intl.formatMessage({ id: "settings.modelProvider.keyPool.refresh" })}
            onClick={onRefresh}
          >
            {probing ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-testid={testId(TID_MODEL_PROVIDER_API_KEY_POOL_DELETE, item.keyId)}
          disabled={readOnly}
          aria-label={intl.formatMessage({ id: "settings.modelProvider.keyPool.delete" })}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function groupBadgeClass(group: ApiKeyPoolLane): string {
  switch (group) {
    case "pool":
      return "border-success/20 bg-success/10 text-success";
    case "cooling":
    case "exhausted":
      return "border-warning/20 bg-warning/10 text-warning";
    case "expired":
      return "border-border bg-surface text-foreground-subtle";
    case "invalid":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    case "unknown":
      return "border-border bg-input text-foreground-subtle";
  }
}

function formatCountdown(
  formatMessage: ReturnType<typeof useZCodeIntl>["intl"]["formatMessage"],
  remainingMs: number,
): string {
  const parts = formatApiKeyPoolCountdownParts(remainingMs);
  if (parts.hours > 0) {
    return formatMessage({ id: "settings.modelProvider.keyPool.countdown.hms" }, parts);
  }
  if (parts.minutes > 0) {
    return formatMessage({ id: "settings.modelProvider.keyPool.countdown.ms" }, parts);
  }
  return formatMessage({ id: "settings.modelProvider.keyPool.countdown.s" }, parts);
}
