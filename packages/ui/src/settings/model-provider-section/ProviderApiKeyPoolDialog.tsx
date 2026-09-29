import {
  deriveRemainingMs,
  type ProviderApiKeyPoolKeyView,
  type ProviderApiKeyPoolQuotaQuery,
} from "@zcode/services";
import {
  TID_MODEL_PROVIDER_API_KEY_POOL_ADD,
  TID_MODEL_PROVIDER_API_KEY_POOL_BATCH_DELETE,
  TID_MODEL_PROVIDER_API_KEY_POOL_BATCH_QUERY,
  TID_MODEL_PROVIDER_API_KEY_POOL_DIALOG,
  TID_MODEL_PROVIDER_API_KEY_POOL_GROUP,
  TID_MODEL_PROVIDER_API_KEY_POOL_PASTE,
  TID_MODEL_PROVIDER_API_KEY_POOL_SELECT,
  testId,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Spinner } from "@/components/ui/spinner.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { ProviderApiKeyPoolCurrent } from "./ProviderApiKeyPoolCurrent.js";
import { ProviderApiKeyPoolRow } from "./ProviderApiKeyPoolRow.js";
import {
  keysInApiKeyPoolGroup,
  visibleApiKeyPoolGroups,
  type ApiKeyPoolLane,
} from "./providerApiKeyPoolPresentation.js";

export function ProviderApiKeyPoolDialog({
  open,
  onOpenChange,
  paste,
  onPasteChange,
  group,
  onGroupChange,
  selected,
  onToggleSelectAll,
  keys,
  counts,
  visibleKeys,
  activeKey,
  now,
  revealed,
  probingIds,
  readOnly,
  mutating,
  allVisibleSelected,
  quotaQuery,
  quotaQueryEnabled,
  onAdd,
  onBatchQuery,
  onBatchDelete,
  onReveal,
  onHide,
  onRefresh,
  onDelete,
  onUse,
  onCopy,
  onToggleSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paste: string;
  onPasteChange: (value: string) => void;
  group: ApiKeyPoolLane;
  onGroupChange: (group: ApiKeyPoolLane) => void;
  selected: ReadonlySet<string>;
  onToggleSelectAll: (enable: boolean) => void;
  keys: readonly ProviderApiKeyPoolKeyView[];
  counts: Record<ApiKeyPoolLane, number>;
  visibleKeys: readonly ProviderApiKeyPoolKeyView[];
  activeKey: ProviderApiKeyPoolKeyView | null;
  now: number;
  revealed: Readonly<Record<string, string>>;
  probingIds: ReadonlySet<string>;
  readOnly?: boolean;
  mutating: boolean;
  allVisibleSelected: boolean;
  quotaQuery: ProviderApiKeyPoolQuotaQuery | null;
  quotaQueryEnabled: boolean;
  onAdd: () => void;
  onBatchQuery: () => void;
  onBatchDelete: () => void;
  onReveal: (keyId: string) => void;
  onHide: (keyId: string) => void;
  onRefresh: (keyId: string) => void;
  onDelete: (keyId: string) => void;
  onUse: (keyId: string) => void;
  onCopy: (keyId: string) => Promise<void>;
  onToggleSelect: (keyId: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const lanes = visibleApiKeyPoolGroups(counts, quotaQuery);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={TID_MODEL_PROVIDER_API_KEY_POOL_DIALOG}
        className="flex h-[min(720px,calc(100dvh-2rem))] max-h-[min(720px,calc(100dvh-2rem))] max-w-2xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="gap-2 border-b border-border px-6 py-5">
          <DialogTitle>
            {intl.formatMessage({ id: "settings.modelProvider.keyPool.dialogTitle" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.modelProvider.keyPool.dialogDescription" })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <ProviderApiKeyPoolCurrent item={activeKey} onCopy={onCopy} />

          <div className="mt-4 rounded-xl border border-border bg-surface p-3">
            <Textarea
              {...TECHNICAL_INPUT_ATTRIBUTES}
              data-testid={TID_MODEL_PROVIDER_API_KEY_POOL_PASTE}
              value={paste}
              readOnly={readOnly}
              disabled={readOnly}
              placeholder={intl.formatMessage({
                id: "settings.modelProvider.keyPool.pastePlaceholder",
              })}
              className="min-h-20 rounded-lg border-input-border bg-input font-mono text-mobile-input-safe md:text-ui-base"
              onChange={(event) => onPasteChange(event.target.value)}
            />
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                data-testid={TID_MODEL_PROVIDER_API_KEY_POOL_ADD}
                disabled={readOnly || mutating || !paste.trim()}
                onClick={onAdd}
              >
                {mutating ? <Spinner className="size-3.5" /> : null}
                {intl.formatMessage({
                  id: mutating
                    ? "settings.modelProvider.keyPool.adding"
                    : "settings.modelProvider.keyPool.add",
                })}
              </Button>
            </div>
          </div>

          <Tabs
            value={group}
            onValueChange={(value) => onGroupChange(value as ApiKeyPoolLane)}
            className="mt-4"
          >
            <div className="flex flex-col gap-3">
              <TabsList className="h-auto w-full flex-wrap justify-start">
                {lanes.map(
                  (lane) => (
                    <TabsTrigger
                      key={lane}
                      value={lane}
                      data-testid={testId(TID_MODEL_PROVIDER_API_KEY_POOL_GROUP, lane)}
                    >
                      {intl.formatMessage({ id: `settings.modelProvider.keyPool.group.${lane}` })}
                      <span className="font-mono text-ui-xs tabular-nums text-foreground-subtle">
                        {counts[lane]}
                      </span>
                    </TabsTrigger>
                  ),
                )}
              </TabsList>
              <div className="flex flex-wrap items-center gap-2">
                {selected.size > 0 ? (
                  <span className="text-ui-sm text-foreground-subtle">
                    {intl.formatMessage(
                      { id: "settings.modelProvider.keyPool.selectedCount" },
                      { count: selected.size },
                    )}
                  </span>
                ) : null}
                <label className="flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
                  <Checkbox
                    data-testid={testId(TID_MODEL_PROVIDER_API_KEY_POOL_SELECT, "all")}
                    checked={allVisibleSelected}
                    disabled={readOnly || visibleKeys.length === 0}
                    onCheckedChange={(checked) => onToggleSelectAll(checked === true)}
                  />
                  {intl.formatMessage({ id: "settings.modelProvider.keyPool.selectAll" })}
                </label>
                {quotaQueryEnabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={TID_MODEL_PROVIDER_API_KEY_POOL_BATCH_QUERY}
                    disabled={readOnly || selected.size === 0 || mutating}
                    onClick={onBatchQuery}
                  >
                    {intl.formatMessage({ id: "settings.modelProvider.keyPool.batchQuery" })}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={TID_MODEL_PROVIDER_API_KEY_POOL_BATCH_DELETE}
                  disabled={readOnly || selected.size === 0 || mutating}
                  onClick={onBatchDelete}
                >
                  {intl.formatMessage({ id: "settings.modelProvider.keyPool.batchDelete" })}
                </Button>
              </div>
            </div>
            {lanes.map((lane) => (
              <TabsContent key={lane} value={lane} className="mt-3 space-y-2">
                {keysInApiKeyPoolGroup(keys, lane).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center">
                    <div className="text-ui-base text-foreground">
                      {intl.formatMessage({ id: "settings.modelProvider.keyPool.empty" })}
                    </div>
                    <p className="mt-1 text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: "settings.modelProvider.keyPool.emptyHint" })}
                    </p>
                  </div>
                ) : (
                  keysInApiKeyPoolGroup(keys, lane).map((item) => (
                    <ProviderApiKeyPoolRow
                      key={item.keyId}
                      item={item}
                      selected={selected.has(item.keyId)}
                      revealed={revealed[item.keyId] ?? null}
                      remainingMs={
                        item.group === "cooling" ? deriveRemainingMs(item.availableAt, now) : null
                      }
                      probing={probingIds.has(item.keyId)}
                      readOnly={readOnly}
                      isActive={item.keyId === activeKey?.keyId}
                      quotaQueryEnabled={quotaQueryEnabled}
                      onToggleSelect={() => onToggleSelect(item.keyId)}
                      onReveal={() => onReveal(item.keyId)}
                      onHide={() => onHide(item.keyId)}
                      onRefresh={() => onRefresh(item.keyId)}
                      onDelete={() => onDelete(item.keyId)}
                      onUse={() => onUse(item.keyId)}
                      onCopy={() => onCopy(item.keyId)}
                    />
                  ))
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
