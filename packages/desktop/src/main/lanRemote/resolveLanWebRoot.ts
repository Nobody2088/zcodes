import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

/**
 * 局域网远控 UI 根目录：正式包在 resources/lan-web；开发态回退 packages/web/dist。
 * 手机必须从配对桌面的 HTTPS 同源加载，不能指向 127.0.0.1。
 */
export function resolveLanWebRoot(options?: {
  isPackaged?: boolean;
  resourcesPath?: string;
}): string | undefined {
  const isPackaged = options?.isPackaged ?? app.isPackaged;
  const resourcesPath = options?.resourcesPath ?? process.resourcesPath;
  const candidates: string[] = [];
  if (isPackaged) {
    candidates.push(join(resourcesPath, "lan-web"));
  } else {
    // out/main/lanRemote -> packages/desktop -> packages/web/dist
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, "../../../../web/dist"));
    candidates.push(join(here, "../../../resources/lan-web"));
  }
  for (const root of candidates) {
    if (existsSync(join(root, "index.html"))) {
      return root;
    }
  }
  return undefined;
}
