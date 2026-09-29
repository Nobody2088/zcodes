import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Languages, Pencil, Trash2 } from "lucide-react";
import {
  UNGROUPED_SKILL_GROUP_ID,
  type SkillGroupScope,
  type SkillGroupSection,
  type SkillSummary,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsResourceList } from "@/settings/SettingsResourceGroup.js";

export function SkillGroupSections({
  sections,
  query,
  renderSkill,
  onRename,
  onDelete,
  onMove,
  onTranslateGroup,
  translating = false,
}: {
  sections: readonly SkillGroupSection<SkillSummary>[];
  query: string;
  renderSkill: (skill: SkillSummary) => ReactNode;
  onRename: (scope: SkillGroupScope, groupId: string, name: string) => void;
  onDelete: (scope: SkillGroupScope, groupId: string, name: string) => void;
  onMove: (scope: SkillGroupScope, groupId: string, direction: -1 | 1) => void;
  onTranslateGroup?: (groupId: string) => void;
  translating?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const [editing, setEditing] = useState<SkillGroupSection<SkillSummary> | null>(null);
  const [name, setName] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = sections.flatMap((section) => {
    const skills = normalizedQuery
      ? section.skills.filter((skill) => skillMatchesQuery(skill, normalizedQuery))
      : section.skills;
    if (section.id === UNGROUPED_SKILL_GROUP_ID && skills.length === 0) return [];
    if (normalizedQuery && skills.length === 0) return [];
    return [{ ...section, skills }];
  });
  const editableIds = sections.filter((section) => section.editable).map((section) => section.id);
  const activeKey = visibleSections.some((section) => sectionKey(section) === selectedKey)
    ? selectedKey
    : visibleSections[0]
      ? sectionKey(visibleSections[0])
      : "";
  const activeSection = visibleSections.find((section) => sectionKey(section) === activeKey);
  const editableIndex = activeSection ? editableIds.indexOf(activeSection.id) : -1;

  if (!activeSection) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Tabs value={activeKey} onValueChange={setSelectedKey} className="min-w-0 flex-1 gap-0">
          <div className="overflow-x-auto">
            <TabsList className="flex h-8 w-max rounded-full bg-surface p-0.5 group-data-horizontal/tabs:h-8">
              {visibleSections.map((section) => (
                <TabsTrigger
                  key={sectionKey(section)}
                  value={sectionKey(section)}
                  className="h-7 flex-none rounded-full border-transparent bg-transparent px-2.5 text-ui-base font-medium text-foreground-subtle data-active:border-transparent data-active:bg-background data-active:text-foreground data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-background"
                >
                  <span>{section.name}</span>
                  <span className="text-ui-sm font-normal text-foreground-subtle">
                    {section.skills.length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <div className="flex shrink-0 items-center gap-1">
          {onTranslateGroup && activeSection.skills.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={translating}
              aria-label={intl.formatMessage({ id: "settings.skills.translate.group" })}
              title={intl.formatMessage({ id: "settings.skills.translate.group" })}
              onClick={() => onTranslateGroup(activeSection.id)}
            >
              <Languages className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
          {activeSection.editable && activeSection.ownerScope ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.skills.groups.moveLeft" })}
                disabled={editableIndex <= 0}
                onClick={() => onMove(activeSection.ownerScope!, activeSection.id, -1)}
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.skills.groups.moveRight" })}
                disabled={editableIndex < 0 || editableIndex >= editableIds.length - 1}
                onClick={() => onMove(activeSection.ownerScope!, activeSection.id, 1)}
              >
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.skills.groups.rename" })}
                onClick={() => {
                  setEditing(activeSection);
                  setName(activeSection.name);
                }}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-foreground-subtle hover:bg-destructive/10 hover:text-destructive"
                aria-label={intl.formatMessage({ id: "settings.skills.groups.delete" })}
                onClick={() =>
                  onDelete(activeSection.ownerScope!, activeSection.id, activeSection.name)
                }
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {activeSection.skills.length > 0 ? (
        <SettingsResourceList
          items={activeSection.skills}
          getKey={(skill) => skill.id}
          renderItem={renderSkill}
        />
      ) : (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.skills.groups.empty" })}
        </p>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: "settings.skills.groups.renameTitle" })}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!editing?.ownerScope) return;
              onRename(editing.ownerScope, editing.id, name);
              setEditing(null);
            }}
          >
            <Input
              value={name}
              placeholder={intl.formatMessage({ id: "settings.skills.groups.namePlaceholder" })}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit">
                {intl.formatMessage({ id: "settings.skills.groups.rename" })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function sectionKey(section: SkillGroupSection<SkillSummary>): string {
  return `${section.ownerScope ?? "none"}:${section.id}`;
}

function skillMatchesQuery(skill: SkillSummary, query: string): boolean {
  return [
    skill.name,
    skill.description,
    skill.metadata?.descriptionZh ?? "",
    ...(skill.metadata?.activationKeywords ?? []),
  ]
    .join("\n")
    .toLowerCase()
    .includes(query);
}
