import { useState } from "react";
import type { IPlatformService } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  canRunDisposableCleanup,
  readLanDesktopSession,
  requestDesktopRelaunch,
  runDisposableCleanup,
} from "@/settings/phoneDesktopCleanup.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const CLEANUP_OPTIONS = ["conversations", "memory", "caches", "logs", "backups"] as const;

type CleanupOption = (typeof CLEANUP_OPTIONS)[number];

const DEFAULT_SELECTED: Record<CleanupOption, boolean> = {
  conversations: true,
  memory: true,
  caches: true,
  logs: true,
  backups: true,
};

export function CleanupSection({ platform }: { platform?: IPlatformService }) {
  const { intl } = useZCodeIntl();
  const [selected, setSelected] = useState(DEFAULT_SELECTED);
  const [busy, setBusy] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const chosen = CLEANUP_OPTIONS.filter((id) => selected[id]);
  // 手机没有桌面 IPC。只要配对会话还在，清理就必须能点，由桌面 Main 去删。
  const canClean = canRunDisposableCleanup({
    hasPlatformCleanup: typeof platform?.resetDisposableUserData === "function",
    hasLanSession: readLanDesktopSession() !== null,
  });

  return (
    <div className="space-y-4">
      <SettingsGroupCard>
        {CLEANUP_OPTIONS.map((id) => (
          <SettingsRow
            key={id}
            label={intl.formatMessage({ id: `settings.cleanup.option.${id}` })}
            description={intl.formatMessage({ id: `settings.cleanup.option.${id}.description` })}
            control={
              <Checkbox
                checked={selected[id]}
                aria-label={intl.formatMessage({ id: `settings.cleanup.option.${id}` })}
                onCheckedChange={(checked) => {
                  setSelected((current) => ({ ...current, [id]: checked === true }));
                }}
              />
            }
          />
        ))}
      </SettingsGroupCard>
      <p className="text-ui-caption text-foreground-subtle">
        {intl.formatMessage({ id: "settings.cleanup.kept" })}
      </p>
      <Button
        type="button"
        variant="destructive"
        disabled={busy || chosen.length === 0 || !canClean}
        onClick={() => {
          setBusy(true);
          void runDisposableCleanup(platform, chosen)
            .then(() => setRestartOpen(true))
            .finally(() => setBusy(false));
        }}
      >
        {intl.formatMessage({
          id: busy ? "settings.resetData.running" : "settings.resetData.action",
        })}
      </Button>
      <Dialog open={restartOpen} onOpenChange={setRestartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "settings.resetData.restartTitle" })}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: "settings.resetData.restartDescription" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRestartOpen(false)}>
              {intl.formatMessage({ id: "settings.resetData.restartLater" })}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void requestDesktopRelaunch(platform);
              }}
            >
              {intl.formatMessage({ id: "settings.resetData.restartNow" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
