import { useEffect, useState } from "react";

/** 手机 WebView 和窄窗口。超过这个宽度仍按桌面分栏。 */
export const NARROW_SHELL_MEDIA_QUERY = "(max-width: 767px)";

/** 设备短边（与朝向无关）≤ 此值时，侧向子菜单放不下。 */
export const NARROW_SHELL_MAX_WIDTH = 767;

const COARSE_POINTER_MEDIA_QUERY = "(hover: none) and (pointer: coarse)";

/** 与 packages/web lanPairing / iOS WKWebView 注入的 session key 一致。 */
const LAN_REMOTE_SESSION_KEY = "zcode:lan-remote-session";

function readPositiveWidth(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * iOS WKWebView 会在 viewport 生效前把 matchMedia 算成 false，之后也不再发 change。
 * 可见布局宽度已经是手机尺寸时仍要当成窄屏。
 */
function hasNarrowVisibleWidth(): boolean {
  if (typeof window === "undefined") return false;
  const widths = [
    readPositiveWidth(window.innerWidth),
    typeof document === "undefined"
      ? null
      : readPositiveWidth(document.documentElement?.clientWidth),
    readPositiveWidth(window.visualViewport?.width),
  ];
  return widths.some((width) => width !== null && width <= NARROW_SHELL_MAX_WIDTH);
}

/**
 * 物理/CSS 屏幕短边。layout viewport 被报成 ≥768（整页缩放塞进手机）时，
 * innerWidth/visualViewport 都会偏大，只有 screen 短边仍是真实机宽。
 */
function hasNarrowDeviceScreen(): boolean {
  if (typeof window === "undefined" || typeof window.screen === "undefined") return false;
  const width = readPositiveWidth(window.screen.width);
  const height = readPositiveWidth(window.screen.height);
  if (width === null || height === null) return false;
  return Math.min(width, height) <= NARROW_SHELL_MAX_WIDTH;
}

/**
 * 局域网手机远控：/?lan=1、配对 session、或 iOS 注入的原生槽位。
 * 这条路径的 UI 始终按手机单栏，不信任 WebView 报的 layout 宽度。
 */
export function isLanRemoteShell(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("lan") === "1") return true;
  } catch {
    // ignore malformed location
  }
  try {
    if (window.sessionStorage?.getItem(LAN_REMOTE_SESSION_KEY)) return true;
  } catch {
    // private mode / blocked storage
  }
  if (typeof document === "undefined") return false;
  try {
    const inset = document.documentElement?.style
      ?.getPropertyValue("--zcode-native-trailing-inset")
      ?.trim();
    if (inset && inset !== "0" && inset !== "0px") return true;
  } catch {
    // ignore
  }
  return false;
}

function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(COARSE_POINTER_MEDIA_QUERY).matches;
}

/**
 * 侧向子菜单需要一级 + 二级两列；短边或可见宽度已经不够时，触控设备也必须平铺。
 * 宽屏触控笔电（短边与 layout 都 ≥768）仍可保留桌面子菜单。
 */
function cannotFitSideFlyoutOnCoarsePointer(): boolean {
  if (!isCoarsePointer()) return false;
  return hasNarrowVisibleWidth() || hasNarrowDeviceScreen();
}

export function isNarrowShellViewport(): boolean {
  if (typeof window === "undefined") return false;
  if (isLanRemoteShell()) return true;
  if (hasNarrowVisibleWidth()) return true;
  if (hasNarrowDeviceScreen()) return true;
  if (cannotFitSideFlyoutOnCoarsePointer()) return true;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(NARROW_SHELL_MEDIA_QUERY).matches;
}

/**
 * 模型选择器：窄屏 / 手机远控只渲染一层面板（provider 标题 + 模型行），
 * 禁止 Radix DropdownMenuSub 侧向飞出。
 */
export function shouldFlattenModelProviderMenu(input?: {
  directItems?: boolean;
  narrowShell?: boolean;
}): "flat" | "submenu" {
  if (input?.directItems || input?.narrowShell || isNarrowShellViewport()) {
    return "flat";
  }
  return "submenu";
}

export function useNarrowShellViewport(): boolean {
  const [narrow, setNarrow] = useState(isNarrowShellViewport);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      setNarrow(isNarrowShellViewport());
    };
    update();
    const media =
      typeof window.matchMedia === "function" ? window.matchMedia(NARROW_SHELL_MEDIA_QUERY) : null;
    media?.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      media?.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return narrow;
}
