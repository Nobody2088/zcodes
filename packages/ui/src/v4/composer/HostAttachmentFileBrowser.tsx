import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "@zcode/shared";
import { FileIcon, FolderIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { canGoUp, isSameOrUnder, parentPath } from "@/v4/composer/hostAttachmentPaths.js";

/**
 * 从当前工作区 Host 的文件系统点选文件。
 * 目录只进入；选中的文件路径已经在 Agent 可读的磁盘上。
 */
export function HostAttachmentFileBrowser({
  workspacePath,
  onSelectFile,
  onCancel,
}: {
  workspacePath: string;
  onSelectFile: (path: string) => void;
  onCancel: () => void;
}) {
  const services = useServices();
  const { intl } = useZCodeIntl();
  const [homePath, setHomePath] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  async function navigateTo(path: string) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await services.fileService.readdir({ path, includeHidden: true });
      if (requestId !== requestIdRef.current) return;
      const next = result.toSorted((left, right) => {
        if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
      setEntries(next);
      setCurrentPath(path);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      logger.warn("[host-attachment-browser] 读取目录失败", err);
      setError(
        intl.formatMessage({ id: "directoryBrowser.errorReadDir" }, { error: String(err) }),
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void services.systemService
      .info()
      .then((info) => {
        if (cancelled) return;
        setHomePath(info.homedir);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.warn("[host-attachment-browser] 读取主目录失败", err);
      });
    void navigateTo(workspacePath);
    return () => {
      cancelled = true;
      requestIdRef.current += 1;
    };
    // 打开时从当前工作区进入一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  const showHome = homePath.length > 0 && !isSameOrUnder(currentPath, homePath);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onCancel()}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={intl.formatMessage({ id: "chat.attachments.clientBrowser.title" })}
        className="flex h-[min(36rem,calc(100vh-4rem))] w-[min(44rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-popover p-4 shadow-xl"
      >
        <div className="mb-2 text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "chat.attachments.clientBrowser.title" })}
        </div>
        <div className="mb-2 truncate text-ui-base text-foreground" title={currentPath}>
          {currentPath}
        </div>
        {error ? <div className="mb-2 text-ui-base text-destructive">{error}</div> : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-border bg-background">
          {showHome ? (
            <button
              type="button"
              className="flex h-10 w-full shrink-0 cursor-pointer items-center gap-2 border-b border-border px-3 text-left text-ui-base hover:bg-hover/50"
              onClick={() => void navigateTo(homePath)}
            >
              <FolderIcon className="size-4 shrink-0 text-foreground-subtle" />
              <span>{intl.formatMessage({ id: "chat.attachments.clientBrowser.home" })}</span>
            </button>
          ) : null}
          {canGoUp(currentPath, homePath) ? (
            <button
              type="button"
              className="flex h-10 w-full shrink-0 cursor-pointer items-center gap-2 border-b border-border px-3 text-left text-ui-base hover:bg-hover/50"
              onClick={() => void navigateTo(parentPath(currentPath))}
            >
              <FolderIcon className="size-4 shrink-0 text-foreground-subtle" />
              <span>..</span>
            </button>
          ) : null}
          {loading ? (
            <div className="p-4 text-center text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "common.loading" })}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-4 text-center text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "chat.attachments.clientBrowser.empty" })}
            </div>
          ) : (
            entries.map((entry) => {
              const isDirectory = entry.type === "directory";
              const Icon = isDirectory ? FolderIcon : FileIcon;
              return (
                <button
                  key={entry.path}
                  type="button"
                  className="flex w-full shrink-0 cursor-pointer items-center gap-2 px-3 py-2 text-left text-ui-base hover:bg-hover/50"
                  onClick={() => {
                    if (isDirectory) {
                      void navigateTo(entry.path);
                      return;
                    }
                    onSelectFile(entry.path);
                    onCancel();
                  }}
                >
                  <Icon className="size-4 shrink-0 text-foreground-subtle" />
                  <span className="truncate">{entry.name}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="mt-3 flex shrink-0 justify-end">
          <Button type="button" variant="secondary" size="lg" className="h-10 px-5 text-ui-base" onClick={onCancel}>
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
