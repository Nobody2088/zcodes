import { ZCODE_PRODUCT_FLAVOR, type ZCodeProductFlavor } from "./env.js";

/**
 * FORK F-disable-in-app-update
 * 本 fork 关闭应用内 electron-updater。官方更新会覆盖已安装的 ZCode.app 并抹掉打包魔改。
 * 合并官方后若要恢复：改回 true（仍仅 production flavor 启用，Preview 身份继续禁用）。
 */
export const FORK_DESKTOP_IN_APP_UPDATE_ENABLED = false;

export function isDesktopInAppUpdateEnabled(
  flavor: ZCodeProductFlavor = ZCODE_PRODUCT_FLAVOR,
  forkEnabled = FORK_DESKTOP_IN_APP_UPDATE_ENABLED,
): boolean {
  return forkEnabled && flavor === "production";
}
