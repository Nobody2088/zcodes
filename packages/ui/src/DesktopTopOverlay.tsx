import type { IPlatformService, UpdateStatePayload } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  MessageCirclePlus,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { UpdateStatusButton } from "@/UpdateStatusButton.js";
import { shouldShowDesktopUpdateEntry } from "@/lib/desktopUpdateMenu.js";
import { DesktopTopOverlayActionButton } from "@/DesktopTopOverlayActionButton.js";
import {
  createWindowsCaptionControlsStyle,
  WINDOWS_CAPTION_CONTROLS_RIGHT_INSET_VAR,
} from "@/windowCaptionControls.js";

interface DesktopTopOverlayProps {
  workspaceAbsPath: string;
  isMacDesktop?: boolean;
  isMacFullscreen?: boolean;
  isWindowsDesktop?: boolean;
  isDesktop?: boolean;
  /** 窄屏叠层侧栏：面板 CSS 宽为 0，顶部浮层不能再按该变量裁剪。 */
  isNarrowShell?: boolean;
  macWindowControlsLeftPaddingPx?: number;
  windowsWindowControlsRightPaddingPx?: number;
  isSidebarVisible: boolean;
  updateReadyVersion: string | null;
  updateState: UpdateStatePayload | null;
  toggleSidebarShortcutLabel: string;
  newTaskShortcutLabel: string;
  goBackShortcutLabel: string;
  goForwardShortcutLabel: string;
  canTaskNavBack: boolean;
  canTaskNavForward: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  showNewTaskButton?: boolean;
  appLogoUrl: string;
  platform: IPlatformService;
  onToggleSidebar: () => void;
  onCreateTask: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  hideTaskNavigationButtons?: boolean;
  newTaskDisabledReason?: string;
}

export function DesktopTopOverlay({
  workspaceAbsPath: _workspaceAbsPath,
  isMacDesktop,
  isMacFullscreen,
  isWindowsDesktop,
  isDesktop,
  isNarrowShell = false,
  macWindowControlsLeftPaddingPx,
  windowsWindowControlsRightPaddingPx,
  isSidebarVisible,
  updateReadyVersion,
  updateState,
  toggleSidebarShortcutLabel,
  newTaskShortcutLabel,
  goBackShortcutLabel,
  goForwardShortcutLabel,
  canTaskNavBack,
  canTaskNavForward,
  canGoBack: _canGoBack,
  canGoForward: _canGoForward,
  showNewTaskButton,
  appLogoUrl,
  platform,
  onToggleSidebar,
  onCreateTask,
  onGoBack,
  onGoForward,
  hideTaskNavigationButtons = false,
  newTaskDisabledReason,
}: DesktopTopOverlayProps) {
  const { intl } = useZCodeIntl();
  const SidebarToggleIcon = isSidebarVisible ? PanelLeftClose : PanelLeftOpen;
  const isLinuxDesktop = Boolean(isDesktop && !isMacDesktop && !isWindowsDesktop);
  const usesCustomCaptionArea = isWindowsDesktop || isLinuxDesktop;
  const toggleSidebarTitle = intl.formatMessage({
    id: "workspaceSidebar.toggleSidebar",
  });
  const newTaskTitle = intl.formatMessage({ id: "sidebar.newTask" });
  const taskBackTitle = intl.formatMessage({ id: "taskNav.back" });
  const taskForwardTitle = intl.formatMessage({ id: "taskNav.forward" });
  const isNewTaskButtonVisible = showNewTaskButton ?? !isSidebarVisible;
  const macTopOverlayPaddingStyle =
    isMacDesktop && !isMacFullscreen && Number.isFinite(macWindowControlsLeftPaddingPx)
      ? { paddingLeft: `${Math.round(macWindowControlsLeftPaddingPx ?? 96)}px` }
      : undefined;
  const windowsTopOverlayPaddingStyle = isWindowsDesktop
    ? {
        ...createWindowsCaptionControlsStyle(windowsWindowControlsRightPaddingPx),
        paddingRight: WINDOWS_CAPTION_CONTROLS_RIGHT_INSET_VAR,
      }
    : undefined;
  // 窄屏叠层侧栏把 --workspace-sidebar-panel-width 置 0，若仍按该变量裁剪会把展开按钮压没。
  const topOverlayWidthStyle =
    isSidebarVisible && !isNarrowShell
      ? { width: "var(--workspace-sidebar-panel-width)" }
      : undefined;

  return (
    <div
      style={topOverlayWidthStyle}
      className={cn(
        "@container/topoverlayer pointer-events-none absolute left-0 top-0 z-40 flex h-14 w-fit",
        // Windows/Linux 主面板新增 4px 留白及 1px 边框，左侧工具组需同步偏移才能对齐 Header 中心线。
        usesCustomCaptionArea && "top-1 mt-px",
        isNarrowShell &&
          // 外层高度 = 顶部安全区 + 56px 按钮行;原来的 h-14 被安全区内边距挤压。
          "h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] pl-[max(0.5rem,env(safe-area-inset-left))]",
      )}
    >
      <div
        style={{
          ...macTopOverlayPaddingStyle,
          ...windowsTopOverlayPaddingStyle,
        }}
        className={cn(
          "flex items-center",
          isMacDesktop && "h-14",
          usesCustomCaptionArea && "h-12",
          isNarrowShell && !isMacDesktop && !usesCustomCaptionArea && "h-14",
          // Windows/Linux 工具组计入 4px 外沿留白和 1px 边框，较 8px 左边距右移 5px。
          usesCustomCaptionArea && "pl-3 ml-px",
          isMacDesktop &&
            (isMacFullscreen ? (!isSidebarVisible ? "pl-5 pt-1" : "pl-3 pt-1") : "pt-1"),
          isNarrowShell && !isMacDesktop && !usesCustomCaptionArea && "pl-1",
        )}
      >
        <div
          className={cn(
            // 顶部浮层按钮虽然单个按钮打了 no-drag，但外层容器本身仍悬在窗口标题区上方。
            // Electron 在这类覆盖层上会优先按父级命中拖拽区域，导致点击被窗口拖动吞掉。
            // 这里把整块交互容器一起标成 no-drag，确保展开/收起和新建 task 都能稳定点击。
            "pointer-events-auto flex items-center gap-1 shrink-0 [app-region:no-drag]",
          )}
        >
          {usesCustomCaptionArea && (
            <DesktopTopOverlayActionButton
              title={toggleSidebarTitle}
              shortcut={toggleSidebarShortcutLabel}
              ariaLabel={toggleSidebarTitle}
              buttonClassName="group relative overflow-hidden rounded-lg"
              onClick={onToggleSidebar}
            >
              <img
                src={appLogoUrl}
                alt="ZCode"
                className="size-5 transition-opacity duration-150 group-hover:opacity-0"
                draggable={false}
              />
              <SidebarToggleIcon className="absolute inset-0 m-auto size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
            </DesktopTopOverlayActionButton>
          )}

          {isMacDesktop && (
            <DesktopTopOverlayActionButton
              title={toggleSidebarTitle}
              shortcut={toggleSidebarShortcutLabel}
              ariaLabel={toggleSidebarTitle}
              onClick={onToggleSidebar}
            >
              <SidebarToggleIcon className="size-4 max-md:size-5" />
            </DesktopTopOverlayActionButton>
          )}

          {!isMacDesktop && !usesCustomCaptionArea ? (
            <DesktopTopOverlayActionButton
              title={toggleSidebarTitle}
              shortcut={toggleSidebarShortcutLabel}
              ariaLabel={toggleSidebarTitle}
              testId="mobile-sidebar-toggle"
              onClick={onToggleSidebar}
            >
              <SidebarToggleIcon className="size-4 max-md:size-5" />
            </DesktopTopOverlayActionButton>
          ) : null}

          {/* 远程控制移动端左上角空间有限，任务前进/后退在这里会与主操作拥挤重叠。*/}
          {hideTaskNavigationButtons ? null : (
            <>
              <DesktopTopOverlayActionButton
                title={taskBackTitle}
                shortcut={goBackShortcutLabel}
                ariaLabel={taskBackTitle}
                testId="desktop-top-nav-back"
                disabled={!canTaskNavBack}
                onClick={onGoBack}
              >
                <ArrowLeftIcon className="size-4" />
              </DesktopTopOverlayActionButton>
              <DesktopTopOverlayActionButton
                title={taskForwardTitle}
                shortcut={goForwardShortcutLabel}
                ariaLabel={taskForwardTitle}
                disabled={!canTaskNavForward}
                onClick={onGoForward}
              >
                <ArrowRightIcon className="size-4" />
              </DesktopTopOverlayActionButton>
            </>
          )}

          <div
            aria-hidden={!isNewTaskButtonVisible}
            className={cn(
              "inline-flex overflow-hidden transition-[opacity,width] duration-300 ease-out",
              isNewTaskButtonVisible
                ? "w-7 opacity-100 max-md:w-11"
                : "pointer-events-none w-0 opacity-0",
            )}
          >
            <DesktopTopOverlayActionButton
              title={newTaskDisabledReason ?? newTaskTitle}
              shortcut={newTaskShortcutLabel}
              ariaLabel={newTaskTitle}
              disabled={Boolean(newTaskDisabledReason)}
              onClick={onCreateTask}
            >
              <MessageCirclePlus className="size-4 max-md:size-5" />
            </DesktopTopOverlayActionButton>
          </div>

          {/* <div className="flex items-center [app-region:no-drag]"> */}
          {/* 侧栏收起后，更新按钮之前会跟着“展开态的容器宽度阈值”一起被隐藏。
                  但收起态本身已经改成把操作集中到顶部浮层里，如果这里还继续依赖侧栏宽度判断，
                  用户就会在最需要全局入口的时候反而看不到更新按钮。
                  所以展开态继续走容器查询，收起态则强制显示。 */}
          {/* FORK F-disable-in-app-update：不挂载绿色更新入口，避免用户打开更新窗口覆盖安装包。 */}
          {shouldShowDesktopUpdateEntry() ? (
            <UpdateStatusButton
              platform={platform}
              version={updateReadyVersion}
              updateState={updateState}
              isMacDesktop={isMacDesktop}
              isWindowsDesktop={isWindowsDesktop}
            />
          ) : null}
          {/* </div> */}
        </div>
      </div>
    </div>
  );
}
