import { createContext, useContext, type ReactNode } from "react";
import type { PlanState } from "@zcode/shared/zcode-protocol-v4";

const LiveTodoPlanContext = createContext<PlanState | null>(null);

export function LiveTodoPlanProvider({
  children,
  plan,
}: {
  children: ReactNode;
  plan: PlanState | null;
}) {
  return <LiveTodoPlanContext.Provider value={plan}>{children}</LiveTodoPlanContext.Provider>;
}

export function useLiveTodoPlan(): PlanState | null {
  return useContext(LiveTodoPlanContext);
}
