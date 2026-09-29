import { useEffect, useMemo, useRef, useState } from "react";
import {
  TID_MODEL_PROVIDER_API_KEY_POOL,
  TID_MODEL_PROVIDER_API_KEY_POOL_MANAGE,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Spinner } from "@/components/ui/spinner.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useProviderApiKeyPool } from "@/hooks/useProviderApiKeyPool.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { PresetProviderApiKeyBanner } from "./PresetProviderApiKeyBanner.js";
import { ProviderApiKeyPoolCurrent } from "./ProviderApiKeyPoolCurrent.js";
import { ProviderApiKeyPoolDialog } from "./ProviderApiKeyPoolDialog.js";
import {
  countApiKeyPoolGroups,
  dueCoolingKeyIds,
  findActiveApiKey,
  keysInApiKeyPoolGroup,
  type ApiKeyPoolLane,
} from "./providerApiKeyPoolPresentation.js";

export function ProviderApiKeyPoolManager({
  providerId,
  presetApiKeyUrl,
  onOpenPresetApiKey,
  readOnly,
}: {
  providerId: string;
  presetApiKeyUrl?: string;
  onOpenPresetApiKey?: () => void;
  readOnly?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const requestConfirmation = useConfirmDialog();
  const pool = useProviderApiKeyPool(providerId);
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [group, setGroup] = useState<ApiKeyPoolLane>("pool");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const [probingIds, setProbingIds] = useState<Set<string>>(() => new Set());
  const dueProbeRef = useRef<string>("");
  const keys = pool.view?.keys ?? [];
  const counts = useMemo(() => countApiKeyPoolGroups(keys), [keys]);
  const visibleKeys = useMemo(() => keysInApiKeyPoolGroup(keys, group), [group, keys]);
  const activeKey = findActiveApiKey(keys, pool.view?.activeKeyId);
  // 自定义渠道 quotaQuery 为 none，不展示也不触发额度查询。
  const quotaQuery = pool.view?.quotaQuery ?? null;
  const quotaQueryEnabled =
    quotaQuery === "opencode" || quotaQuery === "channel" || quotaQuery === "balance";

  useEffect(() => {
    if (!keys.some((item) => item.group === "cooling" && item.availableAt != null)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [keys]);

  useEffect(() => {
    if (!quotaQueryEnabled) return;
    const due = dueCoolingKeyIds(keys, now);
    if (due.length === 0) return;
    const token = due
      .map((keyId) => {
        const item = keys.find((key) => key.keyId === keyId);
        return `${keyId}:${item?.availableAt ?? 0}`;
      })
      .join("|");
    if (dueProbeRef.current === token) return;
    dueProbeRef.current = token;
    void pool.probeKeys(due).catch((error: unknown) => {
      logger.warn("[ProviderApiKeyPoolManager] 冷却到期复检失败", error);
    });
  }, [keys, now, pool.probeKeys, quotaQueryEnabled]);

  const addKeys = async () => {
    if (readOnly || !paste.trim()) return;
    try {
      const result = await pool.addKeys(paste);
      setPaste("");
      toast(
        intl.formatMessage(
          { id: "settings.modelProvider.keyPool.addResult" },
          { added: result.added, duplicate: result.duplicate, invalid: result.invalid },
        ),
      );
      if (result.view.keys.some((item) => item.probeError)) {
        toast(intl.formatMessage({ id: "settings.modelProvider.keyPool.partialFailure" }), {
          variant: "warning",
        });
      }
    } catch (error) {
      logger.warn("[ProviderApiKeyPoolManager] 批量添加失败", error);
      toast(intl.formatMessage({ id: "settings.modelProvider.keyPool.loadFailed" }));
    }
  };

  const probeSelected = async (keyIds: readonly string[]) => {
    if (readOnly || !quotaQueryEnabled || keyIds.length === 0) return;
    setProbingIds(new Set(keyIds));
    try {
      await pool.probeKeys(keyIds);
    } catch (error) {
      logger.warn("[ProviderApiKeyPoolManager] 额度查询失败", error);
      toast(intl.formatMessage({ id: "settings.modelProvider.keyPool.loadFailed" }));
    } finally {
      setProbingIds(new Set());
    }
  };

  const deleteSelected = async (keyIds: readonly string[]) => {
    if (readOnly || keyIds.length === 0) return;
    const confirmed = await requestConfirmation({
      title: intl.formatMessage(
        {
          id:
            keyIds.length === 1
              ? "settings.modelProvider.keyPool.deleteConfirmTitle"
              : "settings.modelProvider.keyPool.batchDeleteConfirmTitle",
        },
        { count: keyIds.length },
      ),
      description: intl.formatMessage({
        id:
          keyIds.length === 1
            ? "settings.modelProvider.keyPool.deleteConfirmDescription"
            : "settings.modelProvider.keyPool.batchDeleteConfirmDescription",
      }),
      confirmLabel: intl.formatMessage({ id: "common.delete" }),
      confirmVariant: "destructive",
    });
    if (!confirmed) return;
    try {
      await pool.deleteKeys(keyIds);
      setSelected((current) => {
        const next = new Set(current);
        for (const keyId of keyIds) next.delete(keyId);
        return next;
      });
      setRevealed((current) => {
        const next = { ...current };
        for (const keyId of keyIds) delete next[keyId];
        return next;
      });
    } catch (error) {
      logger.warn("[ProviderApiKeyPoolManager] 删除密钥失败", error);
      toast(intl.formatMessage({ id: "settings.modelProvider.keyPool.loadFailed" }));
    }
  };

  const useKey = async (keyId: string) => {
    if (readOnly) return;
    try {
      await pool.selectActiveKey(keyId);
      toast(intl.formatMessage({ id: "settings.modelProvider.keyPool.switched" }));
    } catch (error) {
      logger.warn("[ProviderApiKeyPoolManager] 切换当前密钥失败", error);
      toast(intl.formatMessage({ id: "settings.modelProvider.keyPool.switchFailed" }));
    }
  };

  const copyKey = async (keyId: string) => {
    const known = revealed[keyId];
    const secret = known ?? (await pool.revealKey(keyId));
    if (!navigator.clipboard?.writeText) {
      throw new Error("clipboard unavailable");
    }
    await navigator.clipboard.writeText(secret);
  };

  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((item) => selected.has(item.keyId));

  return (
    <section
      data-testid={TID_MODEL_PROVIDER_API_KEY_POOL}
      className="rounded-lg border border-border bg-card p-3"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.modelProvider.keyPool.title" })}
          </div>
          <p className="mt-0.5 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.modelProvider.keyPool.autoSwitchHint" })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {presetApiKeyUrl && onOpenPresetApiKey ? (
            <PresetProviderApiKeyBanner onOpenApiKey={onOpenPresetApiKey} />
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={TID_MODEL_PROVIDER_API_KEY_POOL_MANAGE}
            onClick={() => setOpen(true)}
          >
            {intl.formatMessage({ id: "settings.modelProvider.keyPool.manage" })}
          </Button>
        </div>
      </div>

      <ProviderApiKeyPoolCurrent item={activeKey} onCopy={copyKey} />

      <div className="mt-2 text-ui-xs text-foreground-subtle">
        {intl.formatMessage(
          { id: "settings.modelProvider.keyPool.summaryCounts" },
          { pool: counts.pool, cooling: counts.cooling },
        )}
        {counts.exhausted > 0
          ? intl.formatMessage(
              { id: "settings.modelProvider.keyPool.summaryExhausted" },
              { count: counts.exhausted },
            )
          : null}
      </div>

      {pool.status === "loading" && !pool.view ? (
        <div className="mt-3 flex items-center gap-2 text-ui-sm text-foreground-subtle">
          <Spinner className="size-3.5" />
          {intl.formatMessage({ id: "common.loading" })}
        </div>
      ) : null}
      {pool.status === "error" ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.modelProvider.keyPool.loadFailed" })}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={pool.reload}>
            {intl.formatMessage({ id: "settings.modelProvider.keyPool.retry" })}
          </Button>
        </div>
      ) : null}

      <ProviderApiKeyPoolDialog
        open={open}
        onOpenChange={setOpen}
        paste={paste}
        onPasteChange={setPaste}
        group={group}
        onGroupChange={setGroup}
        selected={selected}
        onToggleSelectAll={(enable) => {
          setSelected((current) => {
            const next = new Set(current);
            for (const item of visibleKeys) {
              if (enable) next.add(item.keyId);
              else next.delete(item.keyId);
            }
            return next;
          });
        }}
        keys={keys}
        counts={counts}
        visibleKeys={visibleKeys}
        activeKey={activeKey}
        now={now}
        revealed={revealed}
        probingIds={probingIds}
        readOnly={readOnly}
        mutating={pool.mutating}
        allVisibleSelected={allVisibleSelected}
        quotaQuery={quotaQuery}
        quotaQueryEnabled={quotaQueryEnabled}
        onAdd={() => void addKeys()}
        onBatchQuery={() => void probeSelected([...selected])}
        onBatchDelete={() => void deleteSelected([...selected])}
        onReveal={(keyId) => {
          void pool
            .revealKey(keyId)
            .then((secret) => {
              setRevealed((current) => ({ ...current, [keyId]: secret }));
            })
            .catch((error: unknown) => {
              logger.warn("[ProviderApiKeyPoolManager] 揭开密钥失败", error);
            });
        }}
        onHide={(keyId) => {
          setRevealed((current) => {
            const next = { ...current };
            delete next[keyId];
            return next;
          });
        }}
        onRefresh={(keyId) => void probeSelected([keyId])}
        onDelete={(keyId) => void deleteSelected([keyId])}
        onUse={(keyId) => void useKey(keyId)}
        onCopy={copyKey}
        onToggleSelect={(keyId) => {
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(keyId)) next.delete(keyId);
            else next.add(keyId);
            return next;
          });
        }}
      />
    </section>
  );
}
