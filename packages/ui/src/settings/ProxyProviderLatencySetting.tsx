import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import { logger } from "@/logger.js";

type LatencyState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; latencyMs: number; statusCode?: number }
  | { status: "error"; message: string };

interface ProviderOption {
  providerId: string;
  label: string;
}

export function ProxyProviderLatencySetting() {
  const { intl } = useZCodeIntl();
  const services = useOptionalServices();
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [state, setState] = useState<LatencyState>({ status: "idle" });

  useEffect(() => {
    const providerSettings = services?.providerSettingsService;
    if (!providerSettings?.getView) return;
    let cancelled = false;
    void providerSettings
      .getView()
      .then((view) => {
        if (cancelled) return;
        const options = view.providers
          .filter((provider) => Boolean(provider.effectiveConfig.api?.baseUrl?.trim()))
          .map((provider) => ({
            providerId: provider.providerId,
            label: getProviderFormLabel({
              providerId: provider.providerId,
              providerName: provider.providerName,
            }),
          }));
        setProviders(options);
        setSelectedId((current) =>
          current && options.some((item) => item.providerId === current)
            ? current
            : (options[0]?.providerId ?? ""),
        );
      })
      .catch((error) => {
        logger.warn("[ProxyProviderLatencySetting] load providers failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [services?.providerSettingsService]);

  const selectedLabel = useMemo(
    () => providers.find((item) => item.providerId === selectedId)?.label,
    [providers, selectedId],
  );

  const runProbe = async () => {
    const providerSettings = services?.providerSettingsService;
    if (!providerSettings?.probeProviderApiLatency || !selectedId) {
      setState({
        status: "error",
        message: intl.formatMessage({ id: "settings.proxyProviderLatencyUnavailable" }),
      });
      return;
    }
    setState({ status: "running" });
    try {
      const result = await providerSettings.probeProviderApiLatency(selectedId);
      if (result.ok && result.latencyMs != null) {
        setState({
          status: "ok",
          latencyMs: result.latencyMs,
          statusCode: result.status,
        });
        return;
      }
      setState({
        status: "error",
        message: result.error || intl.formatMessage({ id: "settings.proxyProviderLatencyFailed" }),
      });
    } catch (error) {
      logger.warn("[ProxyProviderLatencySetting] probe failed", error);
      setState({
        status: "error",
        message: intl.formatMessage({ id: "settings.proxyProviderLatencyFailed" }),
      });
    }
  };

  return (
    <SettingsRow
      label={intl.formatMessage({ id: "settings.proxyProviderLatency" })}
      description={intl.formatMessage({ id: "settings.proxyProviderLatencyDescription" })}
      control={<></>}
      detail={
        <div className="flex max-w-[560px] flex-col gap-2">
          <div className="flex items-center gap-2">
            <Select
              value={selectedId || undefined}
              onValueChange={(value) => {
                setSelectedId(value);
                setState({ status: "idle" });
              }}
              disabled={providers.length === 0}
            >
              <SelectTrigger className="max-w-[320px]">
                <SelectValue
                  placeholder={intl.formatMessage({
                    id: "settings.proxyProviderLatencyPlaceholder",
                  })}
                />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.providerId} value={provider.providerId}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!selectedId || state.status === "running"}
              onClick={() => void runProbe()}
            >
              {state.status === "running" ? <Loader2 className="size-4 animate-spin" /> : null}
              {intl.formatMessage({ id: "settings.proxyProviderLatencyTest" })}
            </Button>
          </div>
          {state.status === "ok" ? (
            <p className="text-ui-caption text-foreground-subtle">
              {intl.formatMessage(
                { id: "settings.proxyProviderLatencySuccess" },
                {
                  ms: state.latencyMs,
                  provider: selectedLabel ?? selectedId,
                  status: state.statusCode ?? "—",
                },
              )}
            </p>
          ) : null}
          {state.status === "error" ? (
            <p className="text-ui-caption text-destructive">{state.message}</p>
          ) : null}
          {providers.length === 0 ? (
            <p className="text-ui-caption text-foreground-subtle">
              {intl.formatMessage({ id: "settings.proxyProviderLatencyEmpty" })}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
