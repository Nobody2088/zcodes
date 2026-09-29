import {
  deriveRemainingMs,
  type ApiKeyPoolGroup,
  type ProviderApiKeyPoolKeyView,
  type ProviderApiKeyPoolQuotaQuery,
  type ProviderApiKeyPoolUsageWindowId,
  type ProviderApiKeyPoolUsageWindowView,
} from "@zcode/services";

export const API_KEY_POOL_GROUPS = [
  "pool",
  "cooling",
  "exhausted",
  "expired",
  "invalid",
  "unknown",
] as const satisfies readonly ApiKeyPoolGroup[];

export type ApiKeyPoolLane = (typeof API_KEY_POOL_GROUPS)[number];

export function countApiKeyPoolGroups(
  keys: readonly ProviderApiKeyPoolKeyView[],
): Record<ApiKeyPoolLane, number> {
  const counts = {
    pool: 0,
    cooling: 0,
    exhausted: 0,
    expired: 0,
    invalid: 0,
    unknown: 0,
  };
  for (const key of keys) {
    counts[key.group] += 1;
  }
  return counts;
}

export function findActiveApiKey(
  keys: readonly ProviderApiKeyPoolKeyView[],
  activeKeyId: string | null | undefined,
): ProviderApiKeyPoolKeyView | null {
  if (!activeKeyId) return null;
  return keys.find((item) => item.keyId === activeKeyId) ?? null;
}

/** 「没有额度」只在余额渠道或该组已有 Key 时出现，避免 OpenCode 页签多出一个空组。 */
export function visibleApiKeyPoolGroups(
  counts: Record<ApiKeyPoolLane, number>,
  quotaQuery: ProviderApiKeyPoolQuotaQuery | null | undefined,
): ApiKeyPoolLane[] {
  return API_KEY_POOL_GROUPS.filter((lane) => {
    if (lane === "unknown") return counts.unknown > 0;
    if (lane === "exhausted") return quotaQuery === "balance" || counts.exhausted > 0;
    return true;
  });
}

export function keysInApiKeyPoolGroup(
  keys: readonly ProviderApiKeyPoolKeyView[],
  group: ApiKeyPoolLane,
): ProviderApiKeyPoolKeyView[] {
  return keys.filter((item) => item.group === group);
}

export function formatApiKeyPoolCountdownParts(remainingMs: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function dueCoolingKeyIds(
  keys: readonly ProviderApiKeyPoolKeyView[],
  now: number,
): string[] {
  return keys.flatMap((key) => {
    if (key.group !== "cooling") return [];
    const remainingMs = deriveRemainingMs(key.availableAt, now);
    return remainingMs === 0 ? [key.keyId] : [];
  });
}

export const API_KEY_POOL_USAGE_WINDOW_IDS = [
  "rolling",
  "weekly",
  "monthly",
] as const satisfies readonly ProviderApiKeyPoolUsageWindowId[];

export function findUsageWindow(
  windows: readonly ProviderApiKeyPoolUsageWindowView[],
  windowId: ProviderApiKeyPoolUsageWindowId,
): ProviderApiKeyPoolUsageWindowView | undefined {
  return windows.find((item) => item.window === windowId);
}

export function usageWindowRemainingPercent(
  window: ProviderApiKeyPoolUsageWindowView | undefined,
): number | null {
  if (!window) return null;
  if (window.status === "rate-limited" || window.usedPercent >= 100) return 0;
  return Math.max(0, Math.min(100, 100 - window.usedPercent));
}
