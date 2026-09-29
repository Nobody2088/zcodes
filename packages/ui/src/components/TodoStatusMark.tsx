import { CheckIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";

export type TodoStatusMarkStatus = "pending" | "in_progress" | "inProgress" | "completed";

export function TodoStatusMark({
  className,
  status,
}: {
  className?: string;
  status: TodoStatusMarkStatus;
}) {
  const completed = status === "completed";
  const active = status === "in_progress" || status === "inProgress";

  return (
    <span
      aria-hidden
      data-todo-status={completed ? "completed" : active ? "in_progress" : "pending"}
      data-todo-checked={completed ? "true" : "false"}
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border",
        completed
          ? "border-primary bg-primary text-primary-foreground"
          : active
            ? "border-primary bg-primary/15"
            : "border-input-border bg-background",
        className,
      )}
    >
      {completed ? <CheckIcon className="size-3" strokeWidth={2.75} /> : null}
    </span>
  );
}
