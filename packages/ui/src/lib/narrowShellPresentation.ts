/**
 * 手机窄屏壳层(<768px)的表现类名,规范见 ../specs/mobile-narrow-shell.md。
 *
 * - 弹窗与通用触控命中区的类名一律带 `max-md:` 前缀:≥768px 时一个都不生效,桌面保持原样。
 *   基础组件把它们排在调用方 className 之前,调用方仍可用 `max-md:` 覆盖;例如全屏
 *   预览类弹窗传 `max-md:top-0 max-md:max-h-none` 就不会变成底部面板。
 * - 抽屉与抽屉遮罩、锚定菜单限高、模型菜单(含行高与连接胶囊命中区)的类名只在 useNarrowShellViewport() 为 true 时使用,不带前缀,
 *   宽度 ≥768px 的横屏手机与 lan 远控同样生效。抽屉的开合状态仍由 useAppPanels 的
 *   isSidebarVisible 唯一持有,这里只把「是否打开」映射成类名,不持有任何状态。
 * - 抽屉、底部面板和遮罩共用 300ms + ease-sheet(styles.css 窄屏段的 --ease-sheet:
 *   强减速、无回弹)。系统开启「减少动态效果」时去掉位移:底部面板只淡入淡出,
 *   抽屉直接出现和收起;遮罩的淡入淡出不是位移,照常保留。
 * - 以上约束由 narrowShellPresentation.test.ts 锁定。
 */

/** 遮罩与底部面板同节奏淡入淡出,避免面板还在下滑时遮罩已经消失。 */
export const NARROW_DIALOG_OVERLAY_CLASS_NAME = "max-md:duration-300 max-md:ease-sheet";

/**
 * 居中弹窗改为贴底的底部面板:全宽,顶部保留 rounded-2xl、贴底一侧去圆角,最高 90dvh 并在
 * 面板内滚动,底部让出 Home 指示条;取消桌面端的缩放,层级统一为 shadow-md。
 * 位移只挂在 motion-safe 上,不靠两条同名变量互相覆盖(胜负取决于生成 CSS 的先后)。
 */
export const NARROW_DIALOG_SHEET_CLASS_NAME = [
  "max-md:top-auto max-md:right-0 max-md:bottom-0 max-md:left-0 max-md:mx-auto",
  "max-md:translate-x-0 max-md:translate-y-0",
  "max-md:w-full max-md:max-w-none max-md:max-h-[90dvh]",
  "max-md:overflow-y-auto max-md:overscroll-contain",
  "max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:shadow-md",
  "max-md:pb-[calc(1rem+env(safe-area-inset-bottom))]",
  "max-md:duration-300 max-md:ease-sheet",
  "max-md:data-open:zoom-in-100 max-md:data-closed:zoom-out-100",
  "max-md:motion-safe:data-open:slide-in-from-bottom",
  "max-md:motion-safe:data-closed:slide-out-to-bottom",
].join(" ");

/** 右上角关闭按钮:命中区扩到 44px,图标从 12px 放大到 16px。 */
export const NARROW_DIALOG_CLOSE_BUTTON_CLASS_NAME =
  "max-md:top-2 max-md:right-2 max-md:size-11 max-md:[&_svg:not([class*='size-'])]:size-4";

/** 底部操作区:每个直接子项(通常是按钮)至少 44px 高;纵向排列时按钮自然撑满宽度。 */
export const NARROW_DIALOG_FOOTER_CLASS_NAME = "max-md:*:min-h-11";

/**
 * 触控命中区不小于 44px,给壳层自己的列表行用(抽屉行、设置导航行)。菜单、Select、右键菜单的
 * 选项在基础组件里直接内联同一个 max-md:min-h-11(规范第 1 节)。与 h-8 等固定高度同用时由
 * min-height 胜出,字号与内边距不变。
 */
export const NARROW_TOUCH_TARGET_CLASS_NAME = "max-md:min-h-11";

/**
 * 窄屏锚定菜单(模型选择器单面板)的最大高度。Radix 的 available-height 从触发器量到布局视口
 * 边缘;viewport-fit=cover 下视口顶端就是屏幕最上沿,从输入栏向上弹出的面板会伸进状态栏、顶栏
 * (WorkspaceHeader 窄屏高 3.5rem + 顶部安全区)和 iOS 原生会话按钮下面,列表滚到顶时第一项
 * 看不见也点不到。
 * - 向上弹出:再扣掉顶部安全区、3.5rem 顶栏和 0.5rem 间距,顶边落在顶栏下方。
 * - 向下弹出:扣掉底部安全区和 0.5rem,不压 Home 指示条。
 * - 外层 min 保证不超过 Radix 原本的可用高度,并封顶 16rem,手机上不要占满半屏;
 *   6rem 下限只在极矮视口(如横屏并弹出键盘)生效,此时优先保证菜单可用,允许压住部分顶栏。
 * 不加 max-md: 前缀:只在 useNarrowShellViewport() 为真时拼进 className,宽度 ≥768px 的横屏手机与 lan 远控同样生效。
 * 两条类名须整条写成字面量,Tailwind 才扫描得到;WorkspaceHeader 窄屏高度变动时同步这里。
 */
export const NARROW_ANCHORED_MENU_MAX_HEIGHT_CLASS_NAME = [
  "data-[side=top]:max-h-[min(var(--radix-dropdown-menu-content-available-height),max(6rem,calc(var(--radix-dropdown-menu-content-available-height)-env(safe-area-inset-top)-3.5rem-0.5rem)),16rem)]",
  "data-[side=bottom]:max-h-[min(var(--radix-dropdown-menu-content-available-height),max(6rem,calc(var(--radix-dropdown-menu-content-available-height)-env(safe-area-inset-bottom)-0.5rem)),16rem)]",
].join(" ");

/**
 * 窄屏抽屉(工作区侧栏):常驻绝对定位,靠位移滑入滑出,不用宽度过渡把会话区挤开。宽 86vw、最多
 * 24rem;自由边 rounded-2xl,贴屏幕的一侧不圆角;底部让出 Home 指示条,左侧让出横屏刘海,顶部由
 * 侧栏头部自己让出。关闭时去掉阴影,否则屏幕左缘会露出一道影子。
 */
export function resolveNarrowDrawerClassName(open: boolean): string {
  return [
    "absolute inset-y-0 left-0 z-30 h-full w-[86vw] max-w-sm overflow-hidden",
    "pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]",
    "rounded-r-2xl border-r border-border bg-background-win-alt",
    "transition-transform duration-300 ease-sheet motion-reduce:transition-none",
    open ? "translate-x-0 shadow-lg" : "pointer-events-none -translate-x-full shadow-none",
  ].join(" ");
}

/**
 * 抽屉遮罩:常驻渲染,与抽屉同节奏淡入淡出;颜色与 DialogOverlay 一致(DESIGN.md 没有单独
 * 的遮罩 token)。关闭时不可点,调用方同时设置 aria-hidden,并把 tabIndex 设为 -1。
 */
export function resolveNarrowDrawerScrimClassName(open: boolean): string {
  return [
    "absolute inset-0 z-20 bg-black/60",
    "transition-opacity duration-300 ease-sheet",
    open ? "opacity-100" : "pointer-events-none opacity-0",
  ].join(" ");
}

/**
 * 窄屏单面板模型菜单的 provider 小节标题:12px(text-ui-sm)、中等字重、三级文字色,与 14px 正文色的
 * 模型行拉开层级。有连接选项的 provider 由连接头兼任这一行,不再多渲染一行同名标题;
 * 连接头同样经 renderGroupLabel 套用本类名,名字与徽标(labelBadge)和普通小节标题同一套渲染与样式。
 * 本条与下面三条都只在 useNarrowShellViewport() 为真时拼进 className,不带 max-md:,横屏与 lan 远控同样生效。
 */
export const NARROW_MODEL_MENU_SECTION_TITLE_CLASS_NAME =
  "text-ui-sm font-medium text-foreground-subtlest";

/**
 * 窄屏单面板里自带 min-h-8 的三种行,行高都拉到不小于 44px:
 * - 模型行与底部操作行:基础菜单项的 max-md:min-h-11 只覆盖 <768px,行上的 min-h-8 会把 ≥768px 的横屏手机与
 *   lan 远控压回 32px。
 * - 连接头行:普通 div,本身不可点;拉到 44px 是为了装下连接胶囊扩出的命中区,见最后一条。
 * 不带前缀。cn 基于 tailwind-merge,会去掉同一元素上的 min-h-8;生成的 CSS 里 min-h-11 也排在 min-h-8 之后。
 */
export const NARROW_MODEL_MENU_ROW_CLASS_NAME = "min-h-9";

/** 窄屏模型名可换行、超长单词可断开,不用 truncate 省略号截断,保证模型名完整可见。 */
export const NARROW_MODEL_MENU_ITEM_NAME_CLASS_NAME = "min-w-0 whitespace-normal break-words";

/**
 * 窄屏连接方式胶囊(连接头里的 SelectTrigger,size="xs" 即 h-5,外高 20px)的命中区:伪元素在胶囊外沿上下
 * 各扩 12px,20 + 12 × 2 = 44px,与 min-h-11 一样。不直接给胶囊 min-h-11,那样会把它撑成 44px 高的大按钮;
 * 伪元素不改视觉。写法同抽屉行按钮和 TaskListItem 归档按钮(max-md:after:-inset-y-1.5 max-md:after:-my-px)。
 * - 写 -inset-y-3 再加 -my-px:触发器基础类带 1px 边框,absolute 的 inset 以胶囊的内边距盒为基准,
 *   只写 -inset-y-3 在外沿只多出 11px,命中高度 42px;-my-px 让伪元素上下再各伸 1px,正好抵掉边框。
 * - 不写 -inset-y-[13px]:13px 偏移与边框不随根字号缩放,h-5、min-h-11 会缩放。根字号 12px 时胶囊外高 15px、
 *   连接头行 33px,13px 写法的命中区有 39px,上下各越出本行 3px,压到相邻模型行;现写法的命中高度恒为
 *   5 + 3 × 2 = 11 个间距单位,与行同高(根字号 16px 时 44px)。
 * - 触发器基础类没有 relative,也没有 overflow-hidden:这里补 relative,扩出的部分不会被裁掉。
 * - Tailwind v4 的 after: 变体自带 content: var(--tw-content)(初始值为空串),不用再写 after:content-[...]。
 * - 须与 NARROW_MODEL_MENU_ROW_CLASS_NAME 同用:连接头行 44px、胶囊垂直居中,外沿上下正好各剩 12px,
 *   扩出的命中区落在本行内,不压相邻模型行。
 */
export const NARROW_MODEL_MENU_CONNECTION_TRIGGER_CLASS_NAME =
  "relative after:absolute after:inset-x-0 after:-inset-y-2 after:-my-px";
