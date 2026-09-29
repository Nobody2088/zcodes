import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";

// 窄屏(max-md):按钮 32px、图标 16px;伪元素在外沿上下各延伸 6px,命中高度补到 44px。
// Button 基础类带 1px 边框,absolute 的 inset 以内边距盒为基准:只写 -inset-y-1.5 外沿只多 5px(42px),
// 再用 -my-px 各补 1px。偏移按间距刻度走,命中高度恒为 8 + 1.5 × 2 = 11 个间距单位(根字号 16px 时 44px)。
// 横向不延伸:同一行最多 3 个按钮,加宽会让相邻命中区重叠造成误触,也会挤掉任务标题。
// 宽度不足 44px 登记在 specs/mobile-narrow-shell.md 第 6 节;≥768px 类名不变。
const NARROW_ROW_ACTION_CLASS_NAME =
  "max-md:relative max-md:size-8 max-md:[&_svg]:size-4 max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-1.5 max-md:after:-my-px max-md:after:content-['']";

function TaskRowActionButton({
  label,
  children,
  className,
  onClick,
  showTooltip = false,
  disabledReason,
  testId,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  showTooltip?: boolean;
  disabledReason?: string;
  testId?: string;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(NARROW_ROW_ACTION_CLASS_NAME, className)}
      disabled={Boolean(disabledReason)}
      data-testid={testId}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        if (!disabledReason) {
          onClick(event);
        }
      }}
      aria-label={label}
    >
      {children}
    </Button>
  );
  if (!showTooltip) {
    return button;
  }
  return (
    <ControlHintTooltip title={disabledReason ?? label} side="top" sideOffset={2}>
      {/* 本地 absolute tooltip 会被分组折叠容器的 overflow-hidden 裁剪；
          使用可接收指针的真实 trigger 包裹 disabled button，再由共享 Portal 渲染提示。 */}
      <span className="inline-flex shrink-0">{button}</span>
    </ControlHintTooltip>
  );
}

export { TaskRowActionButton };
