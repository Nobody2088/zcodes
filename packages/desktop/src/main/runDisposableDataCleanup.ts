import { session } from "electron";
import { getDataBaseDir } from "@zcode/services/node";
import { clearEmbeddedBrowserData } from "./browserDataManager.js";
import {
  parseCleanupCategories,
  resetDisposableUserData,
  resolveZcodeRoots,
} from "./resetUserData.js";

interface CleanupLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

/** 桌面设置页和已配对手机共用这一条清理。账号、模型列表不在删除范围内。 */
export async function runDesktopDisposableDataCleanup(
  categoriesInput: unknown,
  logger: CleanupLogger,
): Promise<{ removed: number }> {
  const categories = parseCleanupCategories(categoriesInput);
  let removed = 0;
  if (categories.length > 0) {
    for (const root of resolveZcodeRoots(getDataBaseDir())) {
      removed += await resetDisposableUserData(root, categories);
    }
  }
  if (categories.includes("caches")) {
    try {
      await session.defaultSession.clearCache();
      await clearEmbeddedBrowserData({ logger, mode: "cache" });
    } catch (error) {
      logger.warn("[reset-user-data] cache clear failed", error);
    }
  }
  logger.info("[reset-user-data] removed disposable data", { removed, categories });
  return { removed };
}
