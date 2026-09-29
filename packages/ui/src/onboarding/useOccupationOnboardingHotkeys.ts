import { useEffect, type MutableRefObject } from "react";
import type { InterfaceMode } from "@/lib/interfaceMode.js";
import { matchesShortcutBinding } from "@/shortcuts/bindings.js";
import type { useEffectiveShortcutBindings } from "@/shortcuts/useShortcutBindings.js";

type ShortcutBindings = ReturnType<typeof useEffectiveShortcutBindings>;

/** 引导打开时拦截 Esc 和打开引导快捷键；模式快捷键只改当次选择。 */
export function useOccupationOnboardingHotkeys({
  shortcutBindings,
  saving,
  onboardingVisible,
  savedInterfaceMode,
  mode,
  suggestionsEditedRef,
  setInterfaceMode,
  setMode,
  setMemory,
  setSuggestions,
  closeOnboarding,
  setRequested,
}: {
  shortcutBindings: ShortcutBindings;
  saving: boolean;
  onboardingVisible: boolean;
  savedInterfaceMode: InterfaceMode;
  mode: InterfaceMode | null;
  suggestionsEditedRef: MutableRefObject<boolean>;
  setInterfaceMode: (mode: InterfaceMode) => void;
  setMode: (mode: InterfaceMode) => void;
  setMemory: (enabled: boolean) => void;
  setSuggestions: (enabled: boolean) => void;
  closeOnboarding: () => void;
  setRequested: (open: boolean) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        shortcutBindings.toggleInterfaceMode.some((binding) =>
          matchesShortcutBinding(event, binding),
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (saving) return;
        const nextMode = savedInterfaceMode === "office" ? "coding" : "office";
        setInterfaceMode(nextMode);
        setMode(nextMode);
        if (nextMode !== mode) {
          setMemory(nextMode === "office");
          if (nextMode === "office" && !suggestionsEditedRef.current) setSuggestions(true);
        }
        return;
      }
      if (event.key === "Escape" && onboardingVisible && !saving) {
        // 直接退出引导（设置里主动打开的场景尤其需要）：不保存、不改记录，
        // 本次会话不再显示，下次启动按记录重新触发。
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOnboarding();
        return;
      }
      if (
        !shortcutBindings.openOnboarding.some((binding) => matchesShortcutBinding(event, binding))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (saving) return;
      // 关闭调试引导不保存偏好，也不把首次引导标记为已完成。
      if (onboardingVisible) {
        closeOnboarding();
      } else {
        setRequested(true);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    closeOnboarding,
    mode,
    onboardingVisible,
    savedInterfaceMode,
    saving,
    setInterfaceMode,
    setMemory,
    setMode,
    setRequested,
    setSuggestions,
    shortcutBindings,
    suggestionsEditedRef,
  ]);
}
