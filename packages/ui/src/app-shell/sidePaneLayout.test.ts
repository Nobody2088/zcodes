import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_SIDE_PANE_BODY_PANEL_IDS,
  NARROW_SIDE_PANE_BODY_PANEL_IDS,
  resolveSidePaneShellPresentation,
} from "./sidePaneLayout.js";

test("narrow shell covers the conversation when the side pane is open", () => {
  assert.deepEqual(
    resolveSidePaneShellPresentation({ isNarrowShell: true, isSidePaneVisible: true }),
    {
      fillViewport: true,
      bodyPanelIds: NARROW_SIDE_PANE_BODY_PANEL_IDS,
      conversationDefaultSize: undefined,
    },
  );
});

test("wide shell keeps the split when the side pane is open", () => {
  assert.deepEqual(
    resolveSidePaneShellPresentation({ isNarrowShell: false, isSidePaneVisible: true }),
    {
      fillViewport: false,
      bodyPanelIds: DESKTOP_SIDE_PANE_BODY_PANEL_IDS,
      conversationDefaultSize: "52%",
    },
  );
});

test("closed side pane stays in the desktop split on a narrow shell", () => {
  assert.deepEqual(
    resolveSidePaneShellPresentation({ isNarrowShell: true, isSidePaneVisible: false }),
    {
      fillViewport: false,
      bodyPanelIds: DESKTOP_SIDE_PANE_BODY_PANEL_IDS,
      conversationDefaultSize: undefined,
    },
  );
});
