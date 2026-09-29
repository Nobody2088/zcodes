import { useState } from "react";
import type { SkillGroup, SkillGroupScope } from "@zcode/shared";
import { parseActivationKeywordsInput } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SkillOnlineInstallDialog({
  open,
  installing,
  scope,
  groups,
  onOpenChange,
  onScopeChange,
  onInstall,
}: {
  open: boolean;
  installing: boolean;
  scope: SkillGroupScope;
  groups: readonly SkillGroup[];
  onOpenChange: (open: boolean) => void;
  onScopeChange: (scope: SkillGroupScope) => void;
  onInstall: (input: {
    url: string;
    groupId: string;
    newGroupName: string;
    scope: SkillGroupScope;
    activationKeywords: string[];
  }) => void;
}) {
  const { intl } = useZCodeIntl();
  const [url, setUrl] = useState("");
  const [activationKeywordsText, setActivationKeywordsText] = useState("");
  const [keywordsError, setKeywordsError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [newGroupName, setNewGroupName] = useState("");
  const selectedGroupId = groups.some((group) => group.id === groupId)
    ? groupId
    : (groups[0]?.id ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "settings.skills.install.title" })}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseActivationKeywordsInput(activationKeywordsText);
            if (!parsed.ok) {
              setKeywordsError(
                intl.formatMessage({
                  id: `settings.skills.install.keywords.error.${parsed.code}`,
                }),
              );
              return;
            }
            setKeywordsError(null);
            onInstall({
              url,
              groupId: selectedGroupId,
              newGroupName,
              scope,
              activationKeywords: parsed.keywords,
            });
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.skills.install.url" })}
            </span>
            <Input
              value={url}
              placeholder={intl.formatMessage({ id: "settings.skills.install.urlPlaceholder" })}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.skills.install.keywords" })}
            </span>
            <Input
              value={activationKeywordsText}
              placeholder={intl.formatMessage({
                id: "settings.skills.install.keywordsPlaceholder",
              })}
              onChange={(event) => {
                setActivationKeywordsText(event.target.value);
                if (keywordsError) setKeywordsError(null);
              }}
            />
            <span className="block text-ui-sm text-muted-foreground">
              {intl.formatMessage({ id: "settings.skills.install.keywordsHint" })}
            </span>
            {keywordsError ? (
              <span className="block text-ui-sm text-destructive">{keywordsError}</span>
            ) : null}
          </label>
          <fieldset className="space-y-2">
            <legend className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.skills.install.scope" })}
            </legend>
            <div className="flex flex-wrap gap-2">
              {(["user", "workspace"] as const).map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant={scope === item ? "default" : "outline"}
                  onClick={() => onScopeChange(item)}
                >
                  {intl.formatMessage({ id: `settings.skills.install.scope.${item}` })}
                </Button>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1.5">
            <span className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.skills.install.group" })}
            </span>
            <select
              className="h-8 w-full rounded-lg border border-input-border bg-input px-3 text-ui-base text-foreground"
              value={selectedGroupId}
              onChange={(event) => setGroupId(event.target.value)}
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.skills.install.newGroup" })}
            </span>
            <Input
              value={newGroupName}
              placeholder={intl.formatMessage({ id: "settings.skills.groups.namePlaceholder" })}
              onChange={(event) => setNewGroupName(event.target.value)}
            />
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={installing || url.trim().length === 0}>
              {intl.formatMessage({
                id: installing
                  ? "settings.skills.install.installing"
                  : "settings.skills.install.action",
              })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
