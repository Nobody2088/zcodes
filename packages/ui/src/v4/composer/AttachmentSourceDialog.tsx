import { MonitorIcon, SmartphoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function AttachmentSourceDialog({
  deviceTestId,
  clientTestId,
  onSelectDevice,
  onSelectClient,
  onCancel,
}: {
  deviceTestId: string;
  clientTestId: string;
  onSelectDevice: () => void;
  onSelectClient: () => void;
  onCancel: () => void;
}) {
  const { intl } = useZCodeIntl();
  const title = intl.formatMessage({ id: "chat.attachments.source.title" });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-4 backdrop-blur-sm sm:items-center"
      onClick={(event) => event.target === event.currentTarget && onCancel()}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full max-w-sm flex-col gap-2 rounded-xl border border-border bg-popover p-4 shadow-xl"
      >
        <div className="px-1 pb-1 text-ui-base font-medium text-foreground">{title}</div>
        <Button
          type="button"
          variant="outline"
          className="h-auto justify-start gap-3 px-3 py-3 text-ui-base"
          data-testid={deviceTestId}
          onClick={onSelectDevice}
        >
          <SmartphoneIcon className="size-5 shrink-0" />
          <span className="flex min-w-0 flex-col items-start">
            <span className="font-medium">
              {intl.formatMessage({ id: "chat.attachments.source.device" })}
            </span>
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "chat.attachments.source.device.description" })}
            </span>
          </span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto justify-start gap-3 px-3 py-3 text-ui-base"
          data-testid={clientTestId}
          onClick={onSelectClient}
        >
          <MonitorIcon className="size-5 shrink-0" />
          <span className="flex min-w-0 flex-col items-start">
            <span className="font-medium">
              {intl.formatMessage({ id: "chat.attachments.source.client" })}
            </span>
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "chat.attachments.source.client.description" })}
            </span>
          </span>
        </Button>
        <Button type="button" variant="secondary" className="mt-1 h-10 text-ui-base" onClick={onCancel}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
      </div>
    </div>
  );
}
