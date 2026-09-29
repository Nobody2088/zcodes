import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NARROW_ANCHORED_MENU_MAX_HEIGHT_CLASS_NAME,
  NARROW_DIALOG_CLOSE_BUTTON_CLASS_NAME,
  NARROW_DIALOG_FOOTER_CLASS_NAME,
  NARROW_DIALOG_OVERLAY_CLASS_NAME,
  NARROW_DIALOG_SHEET_CLASS_NAME,
  NARROW_MODEL_MENU_CONNECTION_TRIGGER_CLASS_NAME,
  NARROW_MODEL_MENU_ITEM_NAME_CLASS_NAME,
  NARROW_MODEL_MENU_ROW_CLASS_NAME,
  NARROW_MODEL_MENU_SECTION_TITLE_CLASS_NAME,
  NARROW_TOUCH_TARGET_CLASS_NAME,
  resolveNarrowDrawerClassName as drawerOf,
  resolveNarrowDrawerScrimClassName as scrimOf,
} from "./narrowShellPresentation.js";

const tokensOf = (className: string) => className.split(/\s+/).filter(Boolean);
// 去掉变体前缀,只留工具类本体:max-md:[&_svg:not(...)]:size-4 → size-4。
const utilityOf = (token: string) => token.split(":").pop() ?? token;
const includesAll = (className: string, expected: readonly string[]) => {
  const tokens = tokensOf(className);
  for (const token of expected) assert.ok(tokens.includes(token), `缺少 ${token}:${className}`);
};
const timingOf = (className: string) =>
  [
    ...new Set(
      tokensOf(className)
        .map(utilityOf)
        .filter((u) => /^(duration|ease)-/.test(u)),
    ),
  ].sort();

// 弹窗类名必须带 max-md:;抽屉、遮罩、锚定菜单限高与模型菜单类名只在窄屏分支(useNarrowShellViewport)里使用,不带前缀。
const MAX_MD_CLASS_NAMES = [
  NARROW_DIALOG_OVERLAY_CLASS_NAME,
  NARROW_DIALOG_SHEET_CLASS_NAME,
  NARROW_DIALOG_CLOSE_BUTTON_CLASS_NAME,
  NARROW_DIALOG_FOOTER_CLASS_NAME,
  NARROW_TOUCH_TARGET_CLASS_NAME,
];
const DRAWER_CLASS_NAMES = [true, false].flatMap((open) => [drawerOf(open), scrimOf(open)]);
const MODEL_MENU_CLASS_NAMES = [
  NARROW_MODEL_MENU_SECTION_TITLE_CLASS_NAME,
  NARROW_MODEL_MENU_ROW_CLASS_NAME,
  NARROW_MODEL_MENU_ITEM_NAME_CLASS_NAME,
  NARROW_MODEL_MENU_CONNECTION_TRIGGER_CLASS_NAME,
];
const ALL_TOKENS = [
  ...MAX_MD_CLASS_NAMES,
  ...DRAWER_CLASS_NAMES,
  NARROW_ANCHORED_MENU_MAX_HEIGHT_CLASS_NAME,
  ...MODEL_MENU_CLASS_NAMES,
].flatMap(tokensOf);

describe("narrowShellPresentation", () => {
  it("弹窗与浮层类名全部限定在 max-md,≥768px 的桌面一个类都不变", () => {
    for (const token of MAX_MD_CLASS_NAMES.flatMap(tokensOf))
      assert.ok(token.startsWith("max-md:"), token);
  });

  it("底部面板贴底、让出 Home 指示条、不缩放;命中区不小于 44px", () => {
    includesAll(NARROW_DIALOG_SHEET_CLASS_NAME, [
      "max-md:top-auto",
      "max-md:bottom-0",
      "max-md:translate-y-0",
      "max-md:rounded-b-none",
      "max-md:max-h-[90dvh]",
      "max-md:overflow-y-auto",
      "max-md:shadow-md",
      "max-md:pb-[calc(1rem+env(safe-area-inset-bottom))]",
      "max-md:data-open:zoom-in-100",
      "max-md:data-closed:zoom-out-100",
      "max-md:motion-safe:data-open:slide-in-from-bottom",
      "max-md:motion-safe:data-closed:slide-out-to-bottom",
    ]);
    includesAll(NARROW_DIALOG_CLOSE_BUTTON_CLASS_NAME, ["max-md:size-11"]);
    includesAll(NARROW_DIALOG_FOOTER_CLASS_NAME, ["max-md:*:min-h-11"]);
    includesAll(NARROW_TOUCH_TARGET_CLASS_NAME, ["max-md:min-h-11"]);
  });

  it("抽屉、底部面板和遮罩同节奏;减少动态效果时去掉位移,遮罩的淡入淡出照常保留", () => {
    const timed = [
      NARROW_DIALOG_OVERLAY_CLASS_NAME,
      NARROW_DIALOG_SHEET_CLASS_NAME,
      ...DRAWER_CLASS_NAMES,
    ];
    for (const name of timed)
      assert.deepEqual(timingOf(name), ["duration-300", "ease-sheet"], name);
    const slides = ALL_TOKENS.filter((token) => utilityOf(token).startsWith("slide-"));
    for (const token of slides)
      assert.ok(token.includes("motion-safe:"), `位移未限定 motion-safe:${token}`);
    for (const open of [true, false])
      includesAll(drawerOf(open), ["motion-reduce:transition-none"]);
    assert.ok(
      ![scrimOf(true), scrimOf(false)].join(" ").includes("motion-reduce:"),
      "遮罩只做淡入淡出,不应随减少动态效果关闭",
    );
  });

  it("抽屉宽 86vw、最多 24rem,让出底部与左侧安全区,靠位移开合;遮罩与弹窗遮罩同色,关闭后都不拦截点击", () => {
    const shared = ["absolute", "w-[86vw]", "max-w-sm", "rounded-r-2xl", "transition-transform"];
    const insets = ["pb-[env(safe-area-inset-bottom)]", "pl-[env(safe-area-inset-left)]"];
    includesAll(drawerOf(true), [...shared, ...insets, "translate-x-0", "shadow-lg"]);
    includesAll(drawerOf(false), [
      ...shared,
      ...insets,
      "-translate-x-full",
      "shadow-none",
      "pointer-events-none",
    ]);
    includesAll(scrimOf(true), ["absolute", "bg-black/60", "transition-opacity", "opacity-100"]);
    includesAll(scrimOf(false), ["bg-black/60", "opacity-0", "pointer-events-none"]);
    assert.ok(![drawerOf(true), scrimOf(true)].flatMap(tokensOf).includes("pointer-events-none"));
  });

  it("窄屏锚定菜单向上弹出时让出顶栏与顶部安全区,向下弹出时让出底部安全区;不超过 Radix 可用高度且封顶 16rem,极矮视口保底 6rem;不带 max-md:,横屏与 lan 远控同样生效", () => {
    const available = "var(--radix-dropdown-menu-content-available-height)";
    // 外层 min 不超过 Radix 原本的可用高度,并封顶 16rem,避免手机模型菜单占满半屏。
    const expected = (deduction: string) =>
      `max-h-[min(${available},max(6rem,calc(${available}-${deduction})),16rem)]`;
    const tokens = tokensOf(NARROW_ANCHORED_MENU_MAX_HEIGHT_CLASS_NAME);
    const sideOf = (side: "top" | "bottom") =>
      tokens.find((token) => token.startsWith(`data-[side=${side}]:`)) ?? "";
    assert.equal(tokens.length, 2, NARROW_ANCHORED_MENU_MAX_HEIGHT_CLASS_NAME);
    // 只在 useNarrowShellViewport() 为真时使用;横屏手机与 lan 远控可能 ≥768px,不能带 max-md:。
    for (const token of tokens) assert.ok(!token.startsWith("max-md:"), token);
    // 3.5rem 对齐 WorkspaceHeader 窄屏高度 calc(3.5rem+env(safe-area-inset-top)),再留 0.5rem 间距,
    // 面板顶边落在状态栏、顶栏和 iOS 原生会话按钮下方。
    assert.equal(utilityOf(sideOf("top")), expected("env(safe-area-inset-top)-3.5rem-0.5rem"));
    assert.equal(utilityOf(sideOf("bottom")), expected("env(safe-area-inset-bottom)-0.5rem"));
    // 括号不配平时 Tailwind 不会生成这条类名,面板会静默退回原来的高度。
    for (const token of tokens)
      assert.equal(token.split("(").length, token.split(")").length, `括号不配平:${token}`);
  });

  it("窄屏模型菜单:小节标题 12px 中等字重三级文字色,行高 36px,模型名换行不截断;不带断点前缀", () => {
    includesAll(NARROW_MODEL_MENU_SECTION_TITLE_CLASS_NAME, [
      "text-ui-sm",
      "font-medium",
      "text-foreground-subtlest",
    ]);
    assert.deepEqual(tokensOf(NARROW_MODEL_MENU_ROW_CLASS_NAME), ["min-h-9"]);
    includesAll(NARROW_MODEL_MENU_ITEM_NAME_CLASS_NAME, [
      "min-w-0",
      "whitespace-normal",
      "break-words",
    ]);
    for (const token of tokensOf(NARROW_MODEL_MENU_ITEM_NAME_CLASS_NAME)) {
      assert.doesNotMatch(
        token,
        /^(truncate|text-ellipsis|whitespace-nowrap|line-clamp-[0-9]+)$/,
        token,
      );
    }
    // 只在 useNarrowShellViewport() 为真时拼进 className;带上 max-md: 等断点前缀,≥768px 的横屏手机与 lan 远控就会失效。
    for (const token of MODEL_MENU_CLASS_NAMES.flatMap(tokensOf)) {
      assert.doesNotMatch(token, /(^|:)(max-)?(sm|md|lg|xl|2xl):/, token);
    }
  });

  it("窄屏连接胶囊:伪元素上下各扩 8px,20px 高的胶囊命中区落在 36px 行内,不改胶囊尺寸、不带断点前缀", () => {
    assert.deepEqual(tokensOf(NARROW_MODEL_MENU_CONNECTION_TRIGGER_CLASS_NAME), [
      "relative",
      "after:absolute",
      "after:inset-x-0",
      "after:-inset-y-2",
      "after:-my-px",
    ]);
  });

  it("不引入 DESIGN.md 禁止的字号、阴影与圆角写法", () => {
    const utilities = ALL_TOKENS.map(utilityOf);
    const forbidden = /^(text-(xs|sm|base|lg|[2-9]?xl|\[)|shadow-(xl|2xl|\[))/;
    for (const utility of utilities) assert.doesNotMatch(utility, forbidden, utility);
    for (const utility of utilities.filter((token) => token.startsWith("rounded"))) {
      assert.match(utility, /^rounded(-[trblse]{1,2})?-(none|sm|md|lg|xl|2xl|full)$/, utility);
    }
  });
});
