export const SIDE_PANE_DEFAULT_EXPANDED_SIZE = "45%";
export const SIDE_PANE_DEFAULT_EXPANDED_RATIO = 0.45;
export const DESKTOP_SIDE_PANE_BODY_PANEL_IDS = ["conversation-column", "browser"];
export const NARROW_SIDE_PANE_BODY_PANEL_IDS = ["conversation-column"];

const SIDE_PANE_TAB_MIN_WIDTH_PX = 60;
const SIDE_PANE_TAB_GAP_PX = 4;
const SIDE_PANE_TAB_OVERFLOW_TOLERANCE_PX = 1;

export function resolveSidePaneTabsOverflow({
  addButtonInside,
  addButtonWidth,
  tabCount,
  viewportWidth,
}: {
  addButtonInside: boolean;
  addButtonWidth: number;
  tabCount: number;
  viewportWidth: number;
}): boolean {
  const tabsWidth =
    tabCount * SIDE_PANE_TAB_MIN_WIDTH_PX + Math.max(0, tabCount - 1) * SIDE_PANE_TAB_GAP_PX;
  const addButtonGap = tabCount > 0 ? SIDE_PANE_TAB_GAP_PX : 0;
  const viewportWidthWithAddButtonInside = viewportWidth + (addButtonInside ? 0 : addButtonWidth);
  const contentWidthWithAddButtonInside = tabsWidth + addButtonGap + addButtonWidth;

  return (
    contentWidthWithAddButtonInside >
    viewportWidthWithAddButtonInside + SIDE_PANE_TAB_OVERFLOW_TOLERANCE_PX
  );
}

/** 窄屏打开侧栏时整屏覆盖会话区；宽屏保持左右分栏。 */
export function resolveSidePaneShellPresentation({
  isNarrowShell,
  isSidePaneVisible,
}: {
  isNarrowShell: boolean;
  isSidePaneVisible: boolean;
}): {
  fillViewport: boolean;
  bodyPanelIds: string[];
  conversationDefaultSize: "52%" | undefined;
} {
  const fillViewport = isNarrowShell && isSidePaneVisible;
  return {
    fillViewport,
    bodyPanelIds: fillViewport ? NARROW_SIDE_PANE_BODY_PANEL_IDS : DESKTOP_SIDE_PANE_BODY_PANEL_IDS,
    conversationDefaultSize: isSidePaneVisible && !isNarrowShell ? "52%" : undefined,
  };
}
