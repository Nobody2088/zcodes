import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME_BY_EXT: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentTypeFor(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function resolveSafeFile(webRoot: string, pathname: string): string | undefined {
  const decoded = decodeURIComponent(pathname.split("?")[0] ?? "/");
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\//, "");
  const candidate = normalize(join(webRoot, relative));
  const rootResolved = resolve(webRoot);
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + sep)) {
    return undefined;
  }
  return candidate;
}

function cacheControlFor(filePath: string): string {
  // 手机 WebView 会把带 max-age 的脚本留一小时。设置页因此一直是旧包，清理按钮继续按「没有桌面函数」禁用。
  return filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")
    ? "no-store"
    : "public, max-age=3600";
}

function sendFile(res: ServerResponse, filePath: string, status = 200): void {
  const size = statSync(filePath).size;
  res.writeHead(status, {
    "content-type": contentTypeFor(filePath),
    "content-length": size,
    "cache-control": cacheControlFor(filePath),
    "access-control-allow-origin": "*",
  });
  createReadStream(filePath).pipe(res);
}

/** 向手机提供与配对同源的 Web UI；缺失产物时返回 false，由调用方回 404。 */
export function tryServeLanWebUi(
  req: IncomingMessage,
  res: ServerResponse,
  webRoot: string | undefined,
): boolean {
  if (!webRoot || (req.method !== "GET" && req.method !== "HEAD")) {
    return false;
  }
  const url = new URL(req.url ?? "/", "https://lan.local");
  if (url.pathname.startsWith("/lan/")) {
    return false;
  }

  const direct = resolveSafeFile(webRoot, url.pathname);
  if (direct && existsSync(direct) && statSync(direct).isFile()) {
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "content-type": contentTypeFor(direct),
        "content-length": statSync(direct).size,
        "cache-control": cacheControlFor(direct),
      });
      res.end();
      return true;
    }
    sendFile(res, direct);
    return true;
  }

  // SPA：未知路径回退 index.html，便于后续客户端路由。
  const indexPath = join(webRoot, "index.html");
  if (!existsSync(indexPath)) {
    return false;
  }
  if (req.method === "HEAD") {
    res.writeHead(200, {
      "content-type": contentTypeFor(indexPath),
      "content-length": statSync(indexPath).size,
      "cache-control": "no-store",
    });
    res.end();
    return true;
  }
  sendFile(res, indexPath);
  return true;
}
