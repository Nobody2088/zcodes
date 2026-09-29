import { canonicalizeProxyHop, MAX_SOCKS5_PROXY_CHAIN_HOPS, parseSocks5ProxyHop } from "@zcode/shared";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

interface ProxyRow {
  id: string;
  value: string;
}

type RowTestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; latencyMs: number }
  | { status: "error"; message: string };

export function ProxyChainSetting({
  enabled,
  proxyChain,
  onChange,
}: {
  enabled: boolean;
  proxyChain: readonly string[];
  onChange?: (patch: { proxyChain: string[]; proxyChainEnabled: boolean }) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const services = useOptionalServices();
  const nextId = useRef(0);
  const createRow = (value: string): ProxyRow => {
    nextId.current += 1;
    return { id: `proxy-${nextId.current}`, value };
  };
  const [rows, setRows] = useState<ProxyRow[]>(() => proxyChain.map((value) => createRow(value)));
  const [error, setError] = useState<string | undefined>();
  const [testByRowId, setTestByRowId] = useState<Record<string, RowTestState>>({});
  const savedKey = proxyChain.join("\n");
  useEffect(() => {
    setRows(proxyChain.map((value) => createRow(value)));
  }, [savedKey]);

  const commit = (nextRows: ProxyRow[], nextEnabled: boolean) => {
    const canonical: string[] = [];
    for (const row of nextRows) {
      const trimmed = row.value.trim();
      if (!trimmed) continue;
      const normalized = canonicalizeProxyHop(trimmed);
      if (!normalized) {
        setError(intl.formatMessage({ id: "settings.proxyChainInvalid" }));
        return;
      }
      canonical.push(normalized);
    }
    setError(undefined);
    void onChange?.({ proxyChain: canonical, proxyChainEnabled: nextEnabled });
  };

  const testProxy = async (row: ProxyRow) => {
    const trimmed = row.value.trim();
    const normalized = canonicalizeProxyHop(trimmed);
    if (!normalized) {
      setTestByRowId((current) => ({
        ...current,
        [row.id]: {
          status: "error",
          message: intl.formatMessage({ id: "settings.proxyChainInvalid" }),
        },
      }));
      return;
    }
    const systemService = services?.systemService;
    if (!systemService?.testProxyEndpoint) {
      setTestByRowId((current) => ({
        ...current,
        [row.id]: {
          status: "error",
          message: intl.formatMessage({ id: "settings.proxyTestUnavailable" }),
        },
      }));
      return;
    }
    setTestByRowId((current) => ({ ...current, [row.id]: { status: "running" } }));
    try {
      const result = await systemService.testProxyEndpoint(normalized);
      const latencyMs = result.latencyMs;
      if (result.ok && latencyMs != null) {
        setTestByRowId((current) => ({
          ...current,
          [row.id]: { status: "ok", latencyMs },
        }));
        return;
      }
      setTestByRowId((current) => ({
        ...current,
        [row.id]: {
          status: "error",
          message: result.error || intl.formatMessage({ id: "settings.proxyTestFailed" }),
        },
      }));
    } catch (error) {
      logger.warn("[ProxyChainSetting] proxy test failed", error);
      setTestByRowId((current) => ({
        ...current,
        [row.id]: {
          status: "error",
          message: intl.formatMessage({ id: "settings.proxyTestFailed" }),
        },
      }));
    }
  };

  return (
    <SettingsRow
      label={intl.formatMessage({ id: "settings.proxyChain" })}
      description={intl.formatMessage({ id: "settings.proxyChainDescription" })}
      control={
        <Switch
          aria-label={intl.formatMessage({ id: "settings.proxyChain" })}
          checked={enabled}
          onCheckedChange={(checked) => commit(rows, checked)}
        />
      }
      detail={
        enabled ? (
          <div className="flex max-w-[560px] flex-col gap-2">
            {rows.map((row, index) => {
              const hop = parseSocks5ProxyHop(row.value);
              const role =
                rows.length === 1
                  ? intl.formatMessage({ id: "settings.proxyChainEntryExit" })
                  : index === 0
                    ? intl.formatMessage({ id: "settings.proxyChainEntry" })
                    : index === rows.length - 1
                      ? intl.formatMessage({ id: "settings.proxyChainExit" })
                      : String(index + 1);
              const protocol = hop
                ? hop.protocol === "http"
                  ? "HTTP"
                  : "SOCKS5"
                : undefined;
              const testState = testByRowId[row.id] ?? { status: "idle" as const };
              return (
                <div key={row.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-ui-caption text-foreground-subtle">
                      {role}
                    </span>
                    <Input
                      size="lg"
                      value={row.value}
                      placeholder={intl.formatMessage({ id: "settings.proxyChainPlaceholder" })}
                      onChange={(event) => {
                        const next = rows.map((item) =>
                          item.id === row.id ? { ...item, value: event.currentTarget.value } : item,
                        );
                        setRows(next);
                        setError(undefined);
                        setTestByRowId((current) => {
                          if (!(row.id in current)) return current;
                          const nextState = { ...current };
                          delete nextState[row.id];
                          return nextState;
                        });
                      }}
                      onBlur={() => commit(rows, enabled)}
                      className="font-mono"
                    />
                    <span className="w-14 shrink-0 text-ui-caption text-foreground-subtle">
                      {protocol ?? ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={testState.status === "running" || !row.value.trim()}
                      onClick={() => void testProxy(row)}
                    >
                      {testState.status === "running" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      {intl.formatMessage({ id: "settings.proxyTest" })}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={intl.formatMessage({ id: "settings.proxyChainRemove" })}
                      onClick={() => {
                        const next = rows.filter((item) => item.id !== row.id);
                        setRows(next);
                        commit(next, enabled);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {testState.status === "ok" ? (
                    <p className="pl-[4.5rem] text-ui-caption text-foreground-subtle">
                      {intl.formatMessage(
                        { id: "settings.proxyTestSuccess" },
                        { ms: testState.latencyMs },
                      )}
                    </p>
                  ) : null}
                  {testState.status === "error" ? (
                    <p className="pl-[4.5rem] text-ui-caption text-destructive">{testState.message}</p>
                  ) : null}
                </div>
              );
            })}
            {rows.length < MAX_SOCKS5_PROXY_CHAIN_HOPS ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={() => setRows((current) => [...current, createRow("")])}
              >
                <Plus className="size-4" />
                {intl.formatMessage({ id: "settings.proxyChainAdd" })}
              </Button>
            ) : null}
            {error ? <p className="text-ui-caption text-destructive">{error}</p> : null}
          </div>
        ) : null
      }
    />
  );
}
