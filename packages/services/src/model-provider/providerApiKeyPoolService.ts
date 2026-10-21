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
  retainSoleApiKeyInDefaultGroup,
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
    // 自定义渠道的 unknown 提升不能只发生在 getView。claim 若先于打开设置页，
    // 刚导入的 overlay Key 会停在 unknown，402 之后选不中下一把。
    if (supported && quotaQuery === "none") {
      promoteNoneQuotaQueryKeys(store.keys, now());
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
    // 落盘前固定唯一 Key 的分组，覆盖探测和请求失败两条写入路径。
    retainSoleApiKeyInDefaultGroup(keys);
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

  /**
   * 按 HTTP 状态分类一把 Key 并改选 overlay。
   * explicitKeyId 缺省时就是当前 overlay（noteRequestFailure）。
   * 子代理传入失败的那把 Key，避免并发改选后误伤已经换上的下一把。
   * 找不到 explicitKeyId 时不写盘。
   */
  const settleRequestFailure = async (
    providerId: string,
    explicitKeyId: string | null,
    status: number,
  ): Promise<{
    view: ProviderApiKeyPoolView;
    keys: StoredApiKey[];
    targetKeyId: string | null;
  } | null> => {
    const { provider, family, quotaQuery, supported, keys, currentKeyId } =
      await loadContext(providerId);
    requireSupported(supported);
    const target = explicitKeyId
      ? keys.find((item) => item.keyId === explicitKeyId)
      : currentKeyId
        ? keys.find((item) => item.keyId === currentKeyId)
        : undefined;
    const project = async (
      targetKeyId: string | null,
      requestedKeyId?: string | null,
      excludedKeyIds?: readonly string[],
    ) => ({
      view: await persistAndProject(
        providerId,
        family,
        quotaQuery,
        keys,
        true,
        currentKeyId,
        requestedKeyId,
        excludedKeyIds,
      ),
      keys,
      targetKeyId,
    });
    if (explicitKeyId && !target) return null;
    if (!target) return project(null);
    const checkedAt = now();
    if (status === 402) {
      // 余额不足不是无效 Key。没有重置时间，进没有额度，并改选下一把。
      applyClassification(
        target,
        {
          group: "exhausted",
          remainingPercent: 0,
          resetAt: null,
          availableAt: null,
          probeError: null,
        },
        checkedAt,
      );
      return project(target.keyId);
    }
    if (status === 401) {
      applyClassification(
        target,
        {
          group: "invalid",
          remainingPercent: null,
          resetAt: null,
          availableAt: null,
          probeError: "auth",
        },
        checkedAt,
      );
      return project(target.keyId);
    }
    if (status === 429) {
      const availableAt = checkedAt + REQUEST_FAILURE_COOLING_MS;
      applyClassification(
        target,
        {
          group: "cooling",
          remainingPercent: 0,
          resetAt: availableAt,
          availableAt,
          probeError: null,
        },
        checkedAt,
      );
      return project(target.keyId);
    }
    if (status === 403) {
      // OpenCode 先复检 /usage；余额渠道先复检 /balance。余额为 0 会离开号池并改选。
      if (provider && (family != null || quotaQuery === "balance")) {
        await probeRecords(family, quotaQuery, provider, [target]);
      }
      if (hasLeftApiKeyPool(target.group)) return project(target.keyId);
      // 只有目标钥已在号池、且还有别的号池成员时才改下一跳。unknown overlay 或仅剩一把时保持明文。
      const otherPool = keys.some((item) => item.group === "pool" && item.keyId !== target.keyId);
      if (target.group === "pool" && otherPool) {
        return project(target.keyId, null, [target.keyId]);
      }
      return project(target.keyId);
    }
    return project(target.keyId);
  };

  const activeKeySecret = (
    keys: readonly StoredApiKey[],
    activeKeyId: string | null,
  ): { apiKey: string; keyId: string } | null => {
    if (!activeKeyId) return null;
    const selected = keys.find((item) => item.keyId === activeKeyId);
    if (!selected?.secret || hasLeftApiKeyPool(selected.group)) return null;
    return { apiKey: selected.secret, keyId: selected.keyId };
  };

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
    noteRequestFailure: (providerId, status, failedKeyId) =>
      enqueue(providerId, async () => {
        // 失败的是请求实际使用的那把 Key。并发子代理已经把 overlay 改走后，不能再按当前 Key 分类。
        const settled = await settleRequestFailure(providerId, failedKeyId?.trim() || null, status);
        if (settled) return settled.view;
        const current = await loadContext(providerId);
        return projectApiKeyPoolView(
          providerId,
          current.family,
          current.supported ? current.keys : [],
          current.supported,
          revisions.get(providerId) ?? 0,
          current.supported ? current.currentKeyId : null,
          current.quotaQuery,
        );
      }),
    readActiveKey: (providerId) =>
      enqueue(providerId, async () => {
        const { supported, keys, currentKeyId } = await loadContext(providerId);
        if (!supported) return null;
        return activeKeySecret(keys, currentKeyId);
      }),
    claimNextKeyAfterFailure: (providerId, failedKeyId, status) =>
      enqueue(providerId, async () => {
        if (status !== 401 && status !== 402 && status !== 403 && status !== 429) {
          return { rotated: false };
        }
        // failedKeyId 缺省时与 noteRequestFailure 一样处理当前 overlay。
        // 请求没带上 keyId 不能因此完全不换。
        const settled = await settleRequestFailure(providerId, failedKeyId?.trim() || null, status);
        if (!settled) return { rotated: false };
        const active = activeKeySecret(settled.keys, settled.view.activeKeyId);
        if (!active || settled.targetKeyId === null || active.keyId === settled.targetKeyId) {
          log.info("api key pool kept the failed key", {
            failedKeyId: settled.targetKeyId,
            providerId,
            status,
          });
          return { rotated: false };
        }
        log.info("api key pool switched to the next key", {
          activeKeyId: active.keyId,
          failedKeyId: settled.targetKeyId,
          providerId,
          status,
        });
        return { rotated: true, apiKey: active.apiKey, keyId: active.keyId };
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
