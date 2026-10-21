import { useMemo, useState } from "react";
import type { LocalSkillCandidate, SkillGroup, SkillGroupScope } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SkillLocalImportDialog({
  open,
  installing,
  rootPath,
  skills,
  scope,
  groups,
  onOpenChange,
  onScopeChange,
  onInstall,
}: {
  open: boolean;
  installing: boolean;
  rootPath: string;
  skills: readonly LocalSkillCandidate[];
  scope: SkillGroupScope;
  groups: readonly SkillGroup[];
  onOpenChange: (open: boolean) => void;
  onScopeChange: (scope: SkillGroupScope) => void;
  onInstall: (input: {
    directories: string[];
    groupId: string;
    newGroupName: string;
    scope: SkillGroupScope;
  }) => void;
}) {
  const { intl } = useZCodeIntl();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(skills.map((skill) => skill.directory)),
  );
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [newGroupName, setNewGroupName] = useState("");
  const selectedGroupId = groups.some((group) => group.id === groupId)
    ? groupId
    : (groups[0]?.id ?? "");
  const selectedCount = useMemo(
    () => skills.filter((skill) => selected.has(skill.directory)).length,
    [selected, skills],
  );
  const allSelected = skills.length > 0 && selectedCount === skills.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: "settings.skills.localImport.title" })}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onInstall({
              directories: skills
                .filter((skill) => selected.has(skill.directory))
                .map((skill) => skill.directory),
              groupId: selectedGroupId,
              newGroupName,
              scope,
            });
          }}
        >
          <p className="truncate text-ui-sm text-muted-foreground" title={rootPath}>
            {rootPath}
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
            <label className="flex items-center gap-2 px-1 py-1 text-ui-base font-medium text-foreground">
              <Checkbox
                checked={allSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                onCheckedChange={(checked) => {
                  setSelected(checked === true ? new Set(skills.map((skill) => skill.directory)) : new Set());
                }}
              />
              {intl.formatMessage(
                { id: "settings.skills.localImport.selected" },
                { count: selectedCount, total: skills.length },
              )}
            </label>
            {skills.map((skill) => (
              <label
                key={skill.directory}
                className="flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(skill.directory)}
                  onCheckedChange={(checked) => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked === true) next.add(skill.directory);
                      else next.delete(skill.directory);
                      return next;
                    });
                  }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-ui-base font-medium text-foreground">
                    {skill.name}
                  </span>
                  <span className="block line-clamp-2 text-ui-sm text-muted-foreground">
                    {skill.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
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
            <Button type="submit" disabled={installing || selectedCount === 0}>
              {intl.formatMessage({
                id: installing
                  ? "settings.skills.install.installing"
                  : "settings.skills.localImport.action",
              })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
