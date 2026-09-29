import {
  isApiKeyAccess,
  type ModelConfigObject,
  type ProviderApiType,
  type ProviderSettingsFacade,
} from "@zcode/provider";
import { ApiError, type ApiClient } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { readApiJson } from "../providers/api/apiJson.js";
import type {
  ProviderSettingsView,
  SyncRemoteProviderModelsOptions,
  SyncRemoteProviderModelsResult,
} from "./providerFacadeServices.js";
import { resolveOpenCodeApiKeyPoolFamily } from "./providerApiKeyPool.js";
import {
  buildOpenCodeModelApiTypeIndex,
  buildRecommendedModelConfigFromCatalogEntry,
  buildRemoteModelCatalogHeaders,
  isRemoteModelCatalogConnectionComplete,
  parseRemoteModelCatalog,
  planRemoteModelCatalogSync,
  resolveRemoteModelCatalogUrl,
  shouldAutoImportRemoteModelCatalog,
  type OpenCodeCatalogTemplateSnapshot,
  type RemoteModelCatalogEntry,
} from "./providerRemoteModelCatalog.js";

export type { SyncRemoteProviderModelsOptions, SyncRemoteProviderModelsResult };

const log = createServiceLogger("provider-remote-model-catalog");

function skippedResult(
  view: ProviderSettingsView,
  reason: NonNullable<SyncRemoteProviderModelsResult["reason"]>,
): SyncRemoteProviderModelsResult {
  return { status: "skipped", reason, addedCount: 0, updatedCount: 0, removedCount: 0, view };
}

function openCodeCatalogIndexFromView(
  view: ProviderSettingsView,
  templateId: string | null | undefined,
): {
  readonly family: NonNullable<ReturnType<typeof resolveOpenCodeApiKeyPoolFamily>>;
  readonly templates: OpenCodeCatalogTemplateSnapshot[];
} | null {
  const family = resolveOpenCodeApiKeyPoolFamily(templateId);
  if (!family) return null;
  return {
    family,
    templates: view.providerTemplates.map((template) => ({
      templateId: template.templateId,
      apiType: template.config.api?.type,
      builtinModelIds: template.config.builtinModelIds,
    })),
  };
}

type CatalogRequest = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

async function deleteMismatchedPersonalModels(
  facade: ProviderSettingsFacade,
  providerId: string,
  modelIds: readonly string[],
): Promise<ProviderSettingsView> {
  let view = facade.getView();
  for (const modelId of modelIds) {
    view = await facade.deletePersonalModel(providerId, modelId);
  }
  return view;
}

function createCatalogApiClient(request: CatalogRequest): ApiClient {
  return {
    request: (input, init) => {
      const { timeoutMs, ...rest } = init ?? {};
      return request(input, {
        ...rest,
        signal: rest.signal ?? AbortSignal.timeout(timeoutMs ?? 15_000),
      });
    },
  };
}

function mergeRecommendedOverlay(
  current: ModelConfigObject | undefined,
  catalog: ModelConfigObject,
): ModelConfigObject {
  return {
    ...current,
    ...catalog,
    enabled: true,
    properties: {
      ...current?.properties,
      ...catalog.properties,
      ...(current?.properties?.inputFormat || catalog.properties?.inputFormat
        ? {
            inputFormat: {
              ...current?.properties?.inputFormat,
              ...catalog.properties?.inputFormat,
            },
          }
        : {}),
    },
  };
}

async function fetchRemoteModelCatalog(input: {
  readonly apiType: ProviderApiType;
  readonly baseUrl: string;
  readonly apiKey?: string | null;
  readonly extraHeaders?: Readonly<Record<string, string>> | null;
  readonly request: CatalogRequest;
}): Promise<RemoteModelCatalogEntry[]> {
  const url = resolveRemoteModelCatalogUrl(input.apiType, input.baseUrl);
  const payload = await readApiJson<unknown>(createCatalogApiClient(input.request), url, {
    method: "GET",
    headers: buildRemoteModelCatalogHeaders(input.apiType, input.apiKey, input.extraHeaders),
    timeoutMs: 15_000,
  });
  return parseRemoteModelCatalog(payload);
}

export async function syncRemoteProviderModelsFromCatalog(input: {
  readonly facade: ProviderSettingsFacade;
  readonly providerId: string;
  readonly importNewModels?: boolean;
  readonly request?: CatalogRequest;
}): Promise<SyncRemoteProviderModelsResult> {
  const request = input.request ?? globalThis.fetch.bind(globalThis);
  let view = input.facade.getView();
  const provider = view.providers.find((item) => item.providerId === input.providerId);
  if (!provider) {
    return skippedResult(view, "provider-missing");
  }
  const apiType = provider.effectiveConfig.api?.type;
  const baseUrl = provider.effectiveConfig.api?.baseUrl;
  const apiKey = isApiKeyAccess(provider.effectiveConfig.access)
    ? provider.effectiveConfig.access.apiKey
    : undefined;
  const connection = {
    group: provider.effectiveConfig.group,
    apiType,
    baseUrl,
    apiKey,
  };
  if (!apiType || !isRemoteModelCatalogConnectionComplete(connection)) {
    return skippedResult(view, "incomplete-connection");
  }

  const openCode = openCodeCatalogIndexFromView(view, provider.templateId);
  const modelApiTypeById = openCode
    ? buildOpenCodeModelApiTypeIndex(openCode.templates, openCode.family)
    : null;
  const existing = () => {
    const current = view.providers.find((item) => item.providerId === input.providerId);
    return (current?.models ?? []).map((model) => ({
      modelId: model.modelId,
      builtin: model.builtin,
      useRecommendedConfig: model.useRecommendedConfig,
      effectiveContextWindow: model.effectiveConfig.properties?.contextWindow ?? undefined,
      effectiveMaxOutputTokens:
        model.effectiveConfig.optionSpecs?.maxOutputTokens?.max ?? undefined,
    }));
  };

  // glm-5.3-flash 在 OpenCode /responses 上 HTTP 500，同一把 Key 打 /chat/completions 为 200。
  // GET /models 没有 API type，先按同 family 模板 builtin 索引删掉协议不匹配的 Personal 成员。
  const localPlan = planRemoteModelCatalogSync({
    existing: existing(),
    catalog: [],
    importNewModels: false,
    providerApiType: apiType,
    modelApiTypeById,
    failClosedWhenUnindexed: Boolean(openCode),
  });
  if (localPlan.remove.length > 0) {
    view = await deleteMismatchedPersonalModels(input.facade, input.providerId, localPlan.remove);
  }

  let catalog: RemoteModelCatalogEntry[];
  try {
    catalog = await fetchRemoteModelCatalog({
      apiType,
      baseUrl: baseUrl!,
      apiKey,
      extraHeaders: provider.effectiveConfig.api?.headers,
      request,
    });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : String(error);
    throw new Error(message);
  }

  const snapshot = existing();
  const plan = planRemoteModelCatalogSync({
    existing: snapshot,
    catalog,
    importNewModels:
      input.importNewModels ??
      shouldAutoImportRemoteModelCatalog(snapshot.map((model) => model.modelId)),
    providerApiType: apiType,
    modelApiTypeById,
    failClosedWhenUnindexed: Boolean(openCode),
  });

  for (const entry of plan.add) {
    view = await input.facade.addPersonalModel(
      input.providerId,
      entry.modelId,
      buildRecommendedModelConfigFromCatalogEntry(entry),
      true,
    );
  }
  for (const entry of plan.update) {
    const current = view.providers
      .find((item) => item.providerId === input.providerId)
      ?.models.find((model) => model.modelId === entry.modelId);
    view = await input.facade.savePersonalModelDraft({
      providerId: input.providerId,
      originalModelId: entry.modelId,
      nextModelId: entry.modelId,
      personalConfig: mergeRecommendedOverlay(
        current?.personalExactConfig,
        buildRecommendedModelConfigFromCatalogEntry(entry),
      ),
      useRecommendedConfig: true,
      basedOnRevision: view.revision,
    });
  }

  return {
    status: "synced",
    addedCount: plan.add.length,
    updatedCount: plan.update.length,
    removedCount: localPlan.remove.length,
    view,
  };
}

export function scheduleOpenCodePersonalCatalogReconcileAfterReady(input: {
  readonly ready: Promise<void>;
  readonly run?: (facade: ProviderSettingsFacade) => Promise<unknown>;
  readonly facade: ProviderSettingsFacade;
  readonly onError: (error: unknown) => void;
}): void {
  const run = input.run ?? reconcileOpenCodePersonalCatalogMembership;
  void input.ready.then(() => {
    void run(input.facade).catch(input.onError);
  });
}

export async function reconcileOpenCodePersonalCatalogMembership(
  facade: ProviderSettingsFacade,
): Promise<number> {
  let removed = 0;
  const initial = facade.getView();
  for (const provider of initial.providers) {
    const openCode = openCodeCatalogIndexFromView(initial, provider.templateId);
    const apiType = provider.effectiveConfig.api?.type;
    if (!openCode || !apiType) continue;
    try {
      await facade.waitForProviderOperations(provider.providerId);
      const view = facade.getView();
      const current = view.providers.find((item) => item.providerId === provider.providerId);
      if (!current) continue;
      const modelApiTypeById = buildOpenCodeModelApiTypeIndex(openCode.templates, openCode.family);
      const plan = planRemoteModelCatalogSync({
        existing: current.models.map((model) => ({
          modelId: model.modelId,
          builtin: model.builtin,
        })),
        catalog: [],
        importNewModels: false,
        providerApiType: apiType,
        modelApiTypeById,
        failClosedWhenUnindexed: true,
      });
      if (plan.remove.length === 0) continue;
      await deleteMismatchedPersonalModels(facade, provider.providerId, plan.remove);
      removed += plan.remove.length;
    } catch (error) {
      log.warn(undefined, "failed to drop mismatched OpenCode catalog models", {
        providerId: provider.providerId,
        error: error instanceof Error ? error.message : "reconcile",
      });
    }
  }
  return removed;
}
