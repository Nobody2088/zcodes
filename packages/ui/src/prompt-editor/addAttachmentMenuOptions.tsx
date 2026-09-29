import { MonitorIcon, PaperclipIcon, SmartphoneIcon } from "lucide-react";

export function addAttachmentMenuOptions(attachmentAction: {
  label: string;
  menuItemTestId?: string;
  sourceChoice?: {
    deviceLabel: string;
    clientLabel: string;
    deviceTestId: string;
    clientTestId: string;
  };
} | undefined) {
  const sourceChoice = attachmentAction?.sourceChoice;
  if (sourceChoice) {
    return [
      {
        id: "attach-device",
        label: sourceChoice.deviceLabel,
        description: "",
        content: (
          <>
            <SmartphoneIcon className="size-4 shrink-0" />
            <span className="truncate text-ui-base font-medium" data-testid={sourceChoice.deviceTestId}>
              {sourceChoice.deviceLabel}
            </span>
          </>
        ),
      },
      {
        id: "attach-client",
        label: sourceChoice.clientLabel,
        description: "",
        content: (
          <>
            <MonitorIcon className="size-4 shrink-0" />
            <span className="truncate text-ui-base font-medium" data-testid={sourceChoice.clientTestId}>
              {sourceChoice.clientLabel}
            </span>
          </>
        ),
      },
    ];
  }
  if (!attachmentAction) return [];
  return [
    {
      id: "attach-files",
      label: attachmentAction.label,
      description: "",
      content: (
        <>
          <PaperclipIcon className="size-4 shrink-0" />
          <span className="truncate text-ui-base font-medium" data-testid={attachmentAction.menuItemTestId}>
            {attachmentAction.label}
          </span>
        </>
      ),
    },
  ];
}
