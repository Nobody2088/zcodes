import { Checkbox } from "@/components/ui/checkbox.js";

export function OnboardingPreferencesStep({
  modeIsOffice,
  saving,
  migration,
  memory,
  suggestions,
  onMigrationChange,
  onMemoryChange,
  onSuggestionsChange,
  t,
}: {
  modeIsOffice: boolean;
  saving: boolean;
  migration: boolean;
  memory: boolean;
  suggestions: boolean;
  onMigrationChange: (checked: boolean) => void;
  onMemoryChange: (checked: boolean) => void;
  onSuggestionsChange: (checked: boolean) => void;
  t: (key: string) => string;
}) {
  const checked = {
    migration,
    memory,
    suggestions,
  };
  const onChange = {
    migration: onMigrationChange,
    memory: onMemoryChange,
    suggestions: onSuggestionsChange,
  };

  return (
    <div className="mt-8 space-y-3">
      {(["suggestions", "memory", "migration"] as const)
        .filter((key) => key !== "suggestions" || modeIsOffice)
        .map((key) => (
          <label
            key={key}
            className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-xl border border-card-border bg-card p-5 text-ui-base transition-colors hover:bg-surface-hover dark:bg-surface/40"
          >
            <Checkbox
              checked={checked[key]}
              disabled={saving}
              onCheckedChange={(next) => onChange[key](next === true)}
            />
            <span className="font-medium">{t(key)}</span>
            <span className="col-start-2 text-ui-sm font-normal text-foreground-subtle">
              {t(`${key}Description`)}
            </span>
          </label>
        ))}
    </div>
  );
}
