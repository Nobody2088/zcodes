import { Globe2, Monitor, Package, WandSparkles } from "lucide-react";
import type { SettingsSectionId } from "@/lib/settingsNavigation.js";
import { Button } from "@/components/ui/button.js";

const CAPABILITY_CARDS: Array<{
  id: "model" | "proxy" | "extensions" | "control";
  icon: typeof Package;
  section?: SettingsSectionId;
  desktopOnlyAction?: boolean;
}> = [
  { id: "model", icon: Package, section: "modelProvider" },
  { id: "proxy", icon: Globe2, section: "general" },
  { id: "extensions", icon: WandSparkles, section: "skill" },
  { id: "control", icon: Monitor, section: "browser", desktopOnlyAction: true },
];

export function OnboardingCapabilitiesStep({
  saving,
  showBrowserSettings,
  onOpenSection,
  t,
}: {
  saving: boolean;
  showBrowserSettings: boolean;
  onOpenSection: (section: SettingsSectionId) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="mt-8 space-y-3" data-testid="onboarding-capabilities">
      {CAPABILITY_CARDS.map((card) => {
        const Icon = card.icon;
        const showAction =
          card.section !== undefined && (!card.desktopOnlyAction || showBrowserSettings);
        return (
          <div
            key={card.id}
            className="rounded-xl border border-card-border bg-card p-5 dark:bg-surface/40"
            data-onboarding-capability={card.id}
          >
            <div className="flex items-start gap-4">
              <Icon className="mt-0.5 size-5 shrink-0 text-foreground-subtle" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="text-ui-base font-medium">{t(`capability.${card.id}.title`)}</p>
                <p className="mt-1 text-ui-sm leading-relaxed text-foreground-subtle">
                  {t(`capability.${card.id}.description`)}
                </p>
                {showAction && card.section ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    className="mt-3 h-9 rounded-xl px-3"
                    data-testid={`onboarding-open-${card.id}`}
                    onClick={() => onOpenSection(card.section!)}
                  >
                    {t(card.desktopOnlyAction ? "openBrowserSettings" : "openSettings")}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
