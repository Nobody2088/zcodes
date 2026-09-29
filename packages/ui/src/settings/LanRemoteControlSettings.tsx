import { useEffect, useState } from "react";
import {
  TID_SETTINGS_LAN_REMOTE_SWITCH,
  type ImportLanRemoteHttpsCertErrorCode,
  type ImportLanRemoteHttpsCertResult,
  type LanRemoteControlState,
} from "@zcode/shared";
import type { IPlatformService } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

const EMPTY_STATE: LanRemoteControlState = {
  enabled: false,
  password: "",
  fingerprint: "",
  port: 0,
  httpPort: 0,
  addresses: [],
  devices: [],
  httpsCert: null,
};

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export function LanRemoteControlSettings() {
  const platform = usePlatform() as IPlatformService;
  const { intl } = useZCodeIntl();
  const [state, setState] = useState<LanRemoteControlState>(EMPTY_STATE);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [certPath, setCertPath] = useState<string | null>(null);
  const [keyPath, setKeyPath] = useState<string | null>(null);
  const supported = typeof platform.getLanRemoteControlState === "function";

  useEffect(() => {
    if (!supported || !platform.getLanRemoteControlState) return;
    void platform
      .getLanRemoteControlState()
      .then(setState)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [platform, supported]);

  if (!supported) {
    return null;
  }

  function formatImportError(code: ImportLanRemoteHttpsCertErrorCode): string {
    return intl.formatMessage({ id: `settings.lanRemote.httpsCert.error.${code}` });
  }

  function applyImportResult(result: ImportLanRemoteHttpsCertResult): void {
    setState(result.state);
    if (result.cancelled) {
      // 取消对话框：安静返回，不改错误文案、不 toast。
      return;
    }
    if (result.errorCode) {
      setError(formatImportError(result.errorCode));
      return;
    }
    setError("");
    setCertPath(null);
    setKeyPath(null);
  }

  async function run(action: () => Promise<LanRemoteControlState>) {
    setError("");
    try {
      setState(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function pickCertificateFile() {
    if (!platform.importLanRemoteHttpsCert) return;
    try {
      const result = await platform.importLanRemoteHttpsCert({ kind: "pickCertificate" });
      setState(result.state);
      if (result.cancelled) return;
      if (result.errorCode) {
        setError(formatImportError(result.errorCode));
        return;
      }
      if (result.pickedPath) {
        setCertPath(result.pickedPath);
        setError("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function pickPrivateKeyFile() {
    if (!platform.importLanRemoteHttpsCert) return;
    try {
      const result = await platform.importLanRemoteHttpsCert({ kind: "pickPrivateKey" });
      setState(result.state);
      if (result.cancelled) return;
      if (result.errorCode) {
        setError(formatImportError(result.errorCode));
        return;
      }
      if (result.pickedPath) {
        setKeyPath(result.pickedPath);
        setError("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function importSelectedFiles() {
    if (!platform.importLanRemoteHttpsCert) return;
    if (!certPath || !keyPath) {
      setError(
        formatImportError(!certPath ? "missing_cert" : "missing_key"),
      );
      return;
    }
    try {
      applyImportResult(
        await platform.importLanRemoteHttpsCert({
          kind: "files",
          certPath,
          keyPath,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function importFromDirectory() {
    if (!platform.importLanRemoteHttpsCert) return;
    try {
      applyImportResult(await platform.importLanRemoteHttpsCert({ kind: "directory" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const cert = state.httpsCert;
  const expiryDescription = cert
    ? intl.formatMessage(
        {
          id: cert.expired
            ? "settings.lanRemote.httpsCert.expired"
            : "settings.lanRemote.httpsCert.expiry",
        },
        {
          date: new Date(cert.notAfter).toLocaleString(),
          days: cert.daysRemaining,
        },
      )
    : intl.formatMessage({ id: "settings.lanRemote.httpsCert.none" });

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.lanRemote.title" })}
        description={intl.formatMessage({ id: "settings.lanRemote.description" })}
        control={
          <Switch
            checked={state.enabled}
            data-testid={TID_SETTINGS_LAN_REMOTE_SWITCH}
            aria-label={intl.formatMessage({ id: "settings.lanRemote.enabled" })}
            onCheckedChange={(enabled) => {
              if (!platform.setLanRemoteControlEnabled) return;
              void run(() => platform.setLanRemoteControlEnabled!(enabled));
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.lanRemote.httpsCert.title" })}
        description={
          cert
            ? intl.formatMessage(
                { id: "settings.lanRemote.httpsCert.summary" },
                {
                  domain: cert.domain,
                  path: cert.storagePath,
                  fingerprint: cert.fingerprintPrefix,
                },
              )
            : intl.formatMessage({ id: "settings.lanRemote.httpsCert.hint" })
        }
        controlLayout="wide"
        control={
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => void pickCertificateFile()}>
                {intl.formatMessage({ id: "settings.lanRemote.httpsCert.pickCert" })}
              </Button>
              <span className="truncate text-ui-sm text-muted-foreground">
                {certPath
                  ? basename(certPath)
                  : intl.formatMessage({ id: "settings.lanRemote.httpsCert.pickCertEmpty" })}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => void pickPrivateKeyFile()}>
                {intl.formatMessage({ id: "settings.lanRemote.httpsCert.pickKey" })}
              </Button>
              <span className="truncate text-ui-sm text-muted-foreground">
                {keyPath
                  ? basename(keyPath)
                  : intl.formatMessage({ id: "settings.lanRemote.httpsCert.pickKeyEmpty" })}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={!certPath || !keyPath}
                onClick={() => void importSelectedFiles()}
              >
                {intl.formatMessage({ id: "settings.lanRemote.httpsCert.import" })}
              </Button>
              <Button type="button" variant="ghost" size="lg" onClick={() => void importFromDirectory()}>
                {intl.formatMessage({ id: "settings.lanRemote.httpsCert.importFolder" })}
              </Button>
            </div>
          </div>
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.lanRemote.httpsCert.domain" })}
        description={cert?.domain ?? intl.formatMessage({ id: "settings.lanRemote.httpsCert.none" })}
        control={<span />}
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.lanRemote.httpsCert.notAfter" })}
        description={expiryDescription}
        control={<span />}
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.lanRemote.password" })}
        controlLayout="wide"
        control={
          <div className="flex min-w-0 items-center gap-2">
            <Input
              readOnly
              size="lg"
              type={visible ? "text" : "password"}
              value={state.password}
              className="w-full max-w-full md:w-[220px]"
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setVisible((value) => !value)}
            >
              {intl.formatMessage({
                id: visible ? "settings.lanRemote.hidePassword" : "settings.lanRemote.showPassword",
              })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                if (!platform.rotateLanRemotePassword) return;
                void run(() => platform.rotateLanRemotePassword!());
              }}
            >
              {intl.formatMessage({ id: "settings.lanRemote.rotate" })}
            </Button>
          </div>
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.lanRemote.addresses" })}
        description={
          state.port > 0
            ? state.addresses.map((address) => `${address}:${state.port}`).join(", ")
            : state.addresses.join(", ")
        }
        control={<span />}
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.lanRemote.fingerprint" })}
        description={state.fingerprint}
        control={<span />}
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.lanRemote.devices" })}
        description={
          state.devices.length === 0
            ? intl.formatMessage({ id: "settings.lanRemote.emptyDevices" })
            : undefined
        }
        control={
          state.devices.length > 0 ? (
            <div className="flex flex-col gap-2">
              {state.devices.map((device) => (
                <div key={device.id} className="flex items-center justify-between gap-3">
                  <span className="truncate text-ui-base">{device.name}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!platform.revokeLanRemoteDevice) return;
                      void run(() => platform.revokeLanRemoteDevice!(device.id));
                    }}
                  >
                    {intl.formatMessage({ id: "settings.lanRemote.revoke" })}
                  </Button>
                </div>
              ))}
            </div>
          ) : null
        }
      />
      {error ? <p className="px-4 pb-3 text-ui-base text-destructive">{error}</p> : null}
    </SettingsGroupCard>
  );
}
