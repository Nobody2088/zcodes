/* oxlint-disable eslint(max-lines) -- 号池 admission、探测和当前钥投影必须留在同一个服务里，避免第二份 activeKey 真相。 */
import type { Event } from "@zcode/rpc";
import type { ProviderApiType } from "@zcode/provider";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ICredentialService } from "../credential/credential.js";
import type { IProviderSettingsService } from "./providerFacadeServices.js";
import {
  classifyOpenCodeKeyProbe,
  parseBatchApiKeys,
  REQUEST_FAILURE_COOLING_MS,
  hasLeftApiKeyPool,
  resolveActiveApiKeyId,
  resolveOpenCodeApiKeyPoolFamily,
  resolveProviderApiKeyPoolQuotaQuery,
  shouldReprobeCoolingKey,
  supportsProviderApiKeyPool,
  type OpenCodeApiKeyPoolFamily,
  type OpenCodeKeyProbeAttempt,
  type ProviderApiKeyPoolQuotaQuery,
} from "./providerApiKeyPool.js";
import {
  type IProviderApiKeyPoolService,
  type ProviderApiKeyPoolAddResult,
  type ProviderApiKeyPoolView,
} from "./providerApiKeyPoolContract.js";
import {
  applyClassification,
  createStoredKey,
  importOverlayKey,
  loadApiKeyPoolStore,
  projectApiKeyPoolView,
  promoteNoneQuotaQueryKeys,
  resolveCurrentKeyId,
  saveApiKeyPoolStore,
  syncActiveOverlay,
  type StoredApiKey,
} from "./providerApiKeyPoolPersistence.js";
import { probeProviderApiKey } from "./providerApiKeyPoolProbe.js";

export {
  IProviderApiKeyPoolService,
  type ProviderApiKeyPoolAddResult,
  type ProviderApiKeyPoolKeyView,
  type ProviderApiKeyPoolView,
} from "./providerApiKeyPoolContract.js";

const PROBE_CONCURRENCY = 4;
const log = createServiceLogger("provider-api-key-pool");

export type ProviderApiKeyPoolProbe = (input: {
  readonly family: OpenCodeApiKeyPoolFamily | null;
  readonly quotaQuery: ProviderApiKeyPoolQuotaQuery;
  readonly apiType: ProviderApiType;
  readonly baseUrl: string;
  readonly extraHeaders?: Readonly<Record<string, string>> | null;
  readonly secret: string;
}) => Promise<readonly OpenCodeKeyProbeAttempt[]>;

export interface ProviderApiKeyPoolServiceDependencies {
  readonly credentialService: Pick<ICredentialService, "load" | "save">;
  readonly providerSettings: Pick<
    IProviderSettingsService,
    "getView" | "savePersonalProviderOverlay"
  >;
  readonly probe?: ProviderApiKeyPoolProbe;
  readonly now?: () => number;
  /** Host 启动后预热并每 5 分钟刷新 OpenCode Go/Zen 号池。测试不开启。 */
  readonly maintainOpenCodePools?: boolean;
}

export function createProviderApiKeyPoolService(
  dependencies: ProviderApiKeyPoolServiceDependencies,
): IProviderApiKeyPoolService {
  const now = dependencies.now ?? Date.now;
  const probe = dependencies.probe ?? defaultProbe;
  const listeners = new Set<(view: ProviderApiKeyPoolView) => void>();
  const tails = new Map<string, Promise<unknown>>();
  const revisions = new Map<string, number>();

  const enqueue = <T>(providerId: string, work: () => Promise<T>): Promise<T> => {
    const previous = tails.get(providerId) ?? Promise.resolve();
    const current = previous.then(work, work);
    tails.set(
      providerId,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  };

  const loadContext = async (providerId: string) => {
    const settingsView = await dependencies.providerSettings.getView();
    const provider = settingsView.providers.find((item) => item.providerId === providerId);
    const access = provider?.effectiveConfig.access ?? provider?.personalConfig?.access;
    const supported = supportsProviderApiKeyPool(access);
    const family = resolveOpenCodeApiKeyPoolFamily(provider?.templateId);
    const quotaQuery = resolveProviderApiKeyPoolQuotaQuery(
      provider?.templateId,
      provider?.effectiveConfig.api?.baseUrl,
    );
    const store = await loadApiKeyPoolStore(dependencies.credentialService, providerId);
    if (supported) {
      importOverlayKey(store.keys, provider?.effectiveConfig, now());
    }
    const currentKeyId = supported
      ? resolveCurrentKeyId(store.keys, store.activeKeyId, provider?.effectiveConfig)
      : null;
    return {
      provider,
      family,
      quotaQuery,
      supported,
      keys: store.keys,
      currentKeyId,
      settingsView,
    };
  };

  const persistAndProject = async (
    providerId: string,
    family: OpenCodeApiKeyPoolFamily | null,
    quotaQuery: ProviderApiKeyPoolQuotaQuery,
    keys: StoredApiKey[],
    supported: boolean,
    currentKeyId: string | null,
    requestedKeyId?: string | null,
    excludedKeyIds?: readonly string[],
  ): Promise<ProviderApiKeyPoolView> => {
    const activeKeyId = supported
      ? resolveActiveApiKeyId({
          keys: keys.map((item) => ({
            id: item.keyId,
            group: item.group,
            remainingPercent: item.remainingPercent,
          })),
          currentKeyId,
          requestedKeyId,
          excludedKeyIds,
        })
      : null;
    await saveApiKeyPoolStore(dependencies.credentialService, providerId, keys, activeKeyId);
    if (supported) {
      await syncActiveOverlay(dependencies.providerSettings, providerId, keys, activeKeyId);
    }
    const revision = (revisions.get(providerId) ?? 0) + 1;
    revisions.set(providerId, revision);
    const view = projectApiKeyPoolView(
      providerId,
      family,
      keys,
      supported,
      revision,
      activeKeyId,
      quotaQuery,
    );
    for (const listener of listeners) listener(view);
    return view;
  };

  const probeRecords = async (
    family: OpenCodeApiKeyPoolFamily | null,
    quotaQuery: ProviderApiKeyPoolQuotaQuery,
    provider: NonNullable<Awaited<ReturnType<typeof loadContext>>["provider"]>,
    records: StoredApiKey[],
  ): Promise<void> => {
    const apiType = provider.effectiveConfig.api?.type ?? "openai-chat-completions";
    const baseUrl = provider.effectiveConfig.api?.baseUrl?.trim() ?? "";
    const extraHeaders = provider.effectiveConfig.api?.headers ?? null;
    await mapBounded(records, PROBE_CONCURRENCY, async (record) => {
      try {
        const attempts = await probe({
          family,
          quotaQuery,
          apiType,
          baseUrl,
          extraHeaders,
          secret: record.secret,
        });
        const classified = classifyOpenCodeKeyProbe({
          family,
          quotaQuery,
          probes: attempts,
          previousGroup: record.group,
          previousRemainingPercent: record.remainingPercent,
          previousAvailableAt: record.availableAt,
        });
        applyClassification(record, classified, now());
      } catch (error) {
        log.warn(undefined, "quota probe failed; keeping stored key", {
          keyId: record.keyId,
          error: error instanceof Error ? error.message : "probe",
        });
        record.probeError = "network";
        record.lastCheckedAt = now();
      }
    });
  };

  const requireSupported = (supported: boolean): void => {
    if (!supported) {
      throw new Error("Provider 不支持 API Key 池");
    }
  };

  const OPENCODE_POOL_PREHEAT_DELAY_MS = 2_000;
  const OPENCODE_POOL_REFRESH_MS = 5 * 60 * 1000;
  const warmOpenCodePools = async (): Promise<void> => {
    let providerIds: string[] = [];
    try {
      const settingsView = await dependencies.providerSettings.getView();
      providerIds = settingsView.providers.flatMap((item) => {
        const quotaQuery = resolveProviderApiKeyPoolQuotaQuery(
          item.templateId,
          item.effectiveConfig.api?.baseUrl,
        );
        return quotaQuery === "opencode" || quotaQuery === "balance" ? [item.providerId] : [];
      });
    } catch (error) {
      log.warn(undefined, "预热 OpenCode 号池时读取供应商失败", error);
      return;
    }
    await Promise.all(
      providerIds.map((providerId) =>
        enqueue(providerId, async () => {
          const { provider, family, quotaQuery, supported, keys, currentKeyId } =
            await loadContext(providerId);
          if (!provider || !supported || keys.length === 0) return;
          if (quotaQuery !== "opencode" && quotaQuery !== "balance") return;
          await probeRecords(family, quotaQuery, provider, keys);
          await persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
        }).catch((error) => {
          log.warn(undefined, "刷新 OpenCode 号池失败", error);
        }),
      ),
    );
  };
  if (dependencies.maintainOpenCodePools) {
    const preheatTimer = setTimeout(() => {
      void warmOpenCodePools();
    }, OPENCODE_POOL_PREHEAT_DELAY_MS);
    const refreshTimer = setInterval(() => {
      void warmOpenCodePools();
    }, OPENCODE_POOL_REFRESH_MS);
    preheatTimer.unref?.();
    refreshTimer.unref?.();
  }

  return {
    onDidChange: toEvent((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    getView: (providerId) =>
      enqueue(providerId, async () => {
        const { provider, family, quotaQuery, supported, keys, currentKeyId } =
          await loadContext(providerId);
        if (!provider || !supported) {
          return projectApiKeyPoolView(
            providerId,
            family,
            [],
            false,
            revisions.get(providerId) ?? 0,
            null,
            quotaQuery,
          );
        }
        if (quotaQuery === "none") {
          promoteNoneQuotaQueryKeys(keys, now());
          return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
        }
        const due = keys.filter(
          (record) => record.group === "unknown" || shouldReprobeCoolingKey(record, now()),
        );
        if (due.length > 0) {
          await probeRecords(family, quotaQuery, provider, due);
        }
        return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
      }),
    addKeys: (providerId, text) =>
      enqueue(providerId, async () => {
        const { provider, family, quotaQuery, supported, keys, currentKeyId } =
          await loadContext(providerId);
        requireSupported(Boolean(provider) && supported);
        const parsed = parseBatchApiKeys(text, new Set(keys.map((item) => item.secret)));
        const addedAt = now();
        const addedRecords = parsed.added.map((item) =>
          createStoredKey(item.secret, addedAt, item.label),
        );
        keys.push(...addedRecords);
        await saveApiKeyPoolStore(dependencies.credentialService, providerId, keys, currentKeyId);
        log.info("batch add api keys", {
          providerId,
          added: parsed.added.length,
          duplicate: parsed.duplicate.length,
          invalid: parsed.invalid.length,
        });
        if (quotaQuery === "none") {
          // 自定义渠道不发 HTTP：新钥与历史 unknown 本地入池，避免误走 OpenCode/models。
          promoteNoneQuotaQueryKeys(keys, now());
        } else if (addedRecords.length > 0 && provider) {
          await probeRecords(family, quotaQuery, provider, addedRecords);
        }
        const view = await persistAndProject(
          providerId,
          family,
          quotaQuery,
          keys,
          true,
          currentKeyId,
        );
        return {
          added: parsed.added.length,
          duplicate: parsed.duplicate.length,
          invalid: parsed.invalid.length,
          view,
        } satisfies ProviderApiKeyPoolAddResult;
      }),
    deleteKeys: (providerId, keyIds) =>
      enqueue(providerId, async () => {
        const { family, quotaQuery, supported, keys, currentKeyId } = await loadContext(providerId);
        requireSupported(supported);
        const remove = new Set(keyIds);
        const next = keys.filter((item) => !remove.has(item.keyId));
        log.info("delete api keys", { providerId, count: keys.length - next.length });
        return persistAndProject(providerId, family, quotaQuery, next, true, currentKeyId);
      }),
    probeKeys: (providerId, keyIds) =>
      enqueue(providerId, async () => {
        const { provider, family, quotaQuery, supported, keys, currentKeyId } =
          await loadContext(providerId);
        requireSupported(Boolean(provider) && supported);
        if (quotaQuery === "none") {
          promoteNoneQuotaQueryKeys(keys, now());
          return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
        }
        const selected = keyIds?.length ? keys.filter((item) => keyIds.includes(item.keyId)) : keys;
        if (provider) {
          await probeRecords(family, quotaQuery, provider, selected);
        }
        return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
      }),
    selectActiveKey: (providerId, keyId) =>
      enqueue(providerId, async () => {
        const { family, quotaQuery, supported, keys, currentKeyId } = await loadContext(providerId);
        requireSupported(supported);
        const requested = keys.find((item) => item.keyId === keyId);
        if (!requested || requested.group !== "pool") {
          throw new Error("只能切换到号池中的密钥");
        }
        return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId, keyId);
      }),
    noteRequestFailure: (providerId, status) =>
      enqueue(providerId, async () => {
        const { provider, family, quotaQuery, supported, keys, currentKeyId } =
          await loadContext(providerId);
        requireSupported(supported);
        const current = currentKeyId ? keys.find((item) => item.keyId === currentKeyId) : undefined;
        if (!current) {
          return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
        }
        const checkedAt = now();
        if (status === 401) {
          applyClassification(
            current,
            {
              group: "invalid",
              remainingPercent: null,
              resetAt: null,
              availableAt: null,
              probeError: "auth",
            },
            checkedAt,
          );
          return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
        }
        if (status === 429) {
          const availableAt = checkedAt + REQUEST_FAILURE_COOLING_MS;
          applyClassification(
            current,
            {
              group: "cooling",
              remainingPercent: 0,
              resetAt: availableAt,
              availableAt,
              probeError: null,
            },
            checkedAt,
          );
          return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
        }
        if (status === 403) {
          // OpenCode 先复检 /usage；余额渠道先复检 /balance。余额为 0 会离开号池并改选。
          if (provider && current && (family != null || quotaQuery === "balance")) {
            await probeRecords(family, quotaQuery, provider, [current]);
          }
          if (current && hasLeftApiKeyPool(current.group)) {
            return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
          }
          // 只有当前钥已在号池、且还有别的号池成员时才改下一跳。unknown overlay 或仅剩一把时保持明文。
          const otherPool = keys.some(
            (item) => item.group === "pool" && item.keyId !== current.keyId,
          );
          if (current.group === "pool" && otherPool) {
            return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId, null, [
              current.keyId,
            ]);
          }
          return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
        }
        return persistAndProject(providerId, family, quotaQuery, keys, true, currentKeyId);
      }),
    revealKey: (providerId, keyId) =>
      enqueue(providerId, async () => {
        const { keys, supported } = await loadContext(providerId);
        requireSupported(supported);
        const record = keys.find((item) => item.keyId === keyId);
        if (!record) throw new Error("API Key 不存在");
        return record.secret;
      }),
  };
}

function defaultProbe(
  input: Parameters<ProviderApiKeyPoolProbe>[0],
): ReturnType<ProviderApiKeyPoolProbe> {
  return probeProviderApiKey(input);
}

async function mapBounded<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const run = async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
}

function toEvent<T>(subscribe: (listener: (event: T) => void) => () => void): Event<T> {
  return (listener) => {
    const dispose = subscribe(listener);
    return { dispose };
  };
}
