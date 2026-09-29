import type {
  ProviderApiKeyPoolBalanceView,
  ProviderApiKeyPoolMembershipView,
  ProviderApiKeyPoolUsageWindowView,
} from "@zcode/services";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";
import {
  API_KEY_POOL_USAGE_WINDOW_IDS,
  findUsageWindow,
  usageWindowRemainingPercent,
} from "./providerApiKeyPoolPresentation.js";

export function ProviderApiKeyPoolQuotaMeters({
  windows,
  membership,
  balance,
}: {
  windows: readonly ProviderApiKeyPoolUsageWindowView[];
  membership: ProviderApiKeyPoolMembershipView;
  balance?: ProviderApiKeyPoolBalanceView | null;
}) {
  const { intl, locale } = useZCodeIntl();
  const formatTime = (value: number) =>
    new Intl.DateTimeFormat(locale, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(value);

  return (
    <div className="flex flex-col gap-1.5">
      {membership.state === "inactive" ? (
        <div className="text-ui-xs text-warning">
          {intl.formatMessage({ id: "settings.modelProvider.keyPool.membership.inactive" })}
        </div>
      ) : membership.renewsAt != null ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-ui-xs">
          <span className="font-medium text-foreground">
            {intl.formatMessage(
              { id: "settings.modelProvider.keyPool.membership.expires" },
              { time: formatTime(membership.renewsAt) },
            )}
          </span>
          {membership.renewalAuthorizationRequired ? (
            <span className="text-warning">
              {intl.formatMessage({ id: "settings.modelProvider.keyPool.membership.reauthorize" })}
            </span>
          ) : null}
        </div>
      ) : null}
      {balance ? (
        <div className="text-ui-xs text-foreground">
          {balance.credits == null
            ? intl.formatMessage({ id: "settings.modelProvider.keyPool.balance.unlimited" })
            : intl.formatMessage(
                { id: "settings.modelProvider.keyPool.balance.credits" },
                { credits: balance.credits.toLocaleString(locale) },
              )}
        </div>
      ) : null}
      {windows.length > 0 ? (
        <div className="grid grid-cols-3 gap-3">
          {API_KEY_POOL_USAGE_WINDOW_IDS.map((windowId) => {
            const window = findUsageWindow(windows, windowId);
            const remaining = usageWindowRemainingPercent(window);
            const limited = remaining === 0;
            const resetTitle =
              window == null
                ? undefined
                : intl.formatMessage(
                    { id: "settings.modelProvider.keyPool.window.resets" },
                    { time: formatTime(window.resetsAt) },
                  );

            return (
              <div key={windowId} className="min-w-0" title={resetTitle}>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="truncate text-ui-xs text-foreground-subtle">
                    {intl.formatMessage({
                      id: `settings.modelProvider.keyPool.window.${windowId}`,
                    })}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums text-ui-sm",
                      limited ? "text-warning" : "text-foreground",
                    )}
                  >
                    {remaining == null
                      ? intl.formatMessage({ id: "settings.modelProvider.keyPool.window.unknown" })
                      : `${Math.round(remaining)}%`}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                  {remaining == null ? null : (
                    <div
                      className={cn("h-full rounded-full", limited ? "bg-warning" : "bg-success")}
                      style={{ width: `${remaining}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
