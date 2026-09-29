import type { ModelConfigObject, ProviderApiType } from "@zcode/provider";
import {
  resolveOpenCodeApiKeyPoolFamily,
  type OpenCodeApiKeyPoolFamily,
} from "./providerApiKeyPool.js";

export const REMOTE_MODEL_CATALOG_IMPORT_LIMIT = 200;

export interface RemoteModelCatalogEntry {
  readonly modelId: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly inputFormat?: NonNullable<NonNullable<ModelConfigObject["properties"]>["inputFormat"]>;
}

export interface RemoteModelCatalogExistingModel {
  readonly modelId: string;
  readonly builtin?: boolean;
  readonly useRecommendedConfig?: boolean;
  readonly effectiveContextWindow?: number;
  readonly effectiveMaxOutputTokens?: number;
}

export interface OpenCodeCatalogTemplateSnapshot {
  readonly templateId: string;
  readonly apiType?: ProviderApiType | null;
  readonly builtinModelIds?: readonly string[] | null;
}

export interface RemoteModelCatalogConnectionSnapshot {
  readonly group?: string | null;
  readonly apiType?: ProviderApiType | null;
  readonly baseUrl?: string | null;
  readonly apiKey?: string | null;
}

export interface RemoteModelCatalogSyncPlan {
  readonly add: readonly RemoteModelCatalogEntry[];
  readonly update: readonly RemoteModelCatalogEntry[];
  readonly remove: readonly string[];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function readPositiveInteger(...candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (isPositiveInteger(candidate)) return candidate;
    if (typeof candidate === "string" && /^\d+$/.test(candidate.trim())) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (parsed > 0) return parsed;
    }
  }
  return undefined;
}

export function resolveRemoteModelCatalogUrl(
  apiType: ProviderApiType,
  baseUrl: string,
): string {
  const root = trimTrailingSlash(baseUrl.trim());
  if (!root) throw new Error("Provider Base URL 不能为空");
  if (apiType === "anthropic-messages") {
    return root.endsWith("/v1") ? `${root}/models` : `${root}/v1/models`;
  }
  return `${root}/models`;
}

export function buildRemoteModelCatalogHeaders(
  apiType: ProviderApiType,
  apiKey: string | null | undefined,
  extraHeaders?: Readonly<Record<string, string>> | null,
): Record<string, string> {
  const headers: Record<string, string> = extraHeaders ? { ...extraHeaders } : {};
  const key = apiKey?.trim();
  if (apiType === "anthropic-messages") {
    headers["anthropic-version"] ??= "2023-06-01";
    if (key) headers["x-api-key"] = key;
    return headers;
  }
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function parseInputFormat(
  modalities: unknown,
): RemoteModelCatalogEntry["inputFormat"] | undefined {
  if (!Array.isArray(modalities) || modalities.length === 0) return undefined;
  const set = new Set(
    modalities
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  if (set.size === 0) return undefined;
  return {
    supportsText: set.has("text"),
    supportsImage: set.has("image"),
    supportsVideo: set.has("video"),
    supportsAudio: set.has("audio"),
    supportsPdf: set.has("pdf"),
  };
}

function parseCatalogRecord(value: unknown): RemoteModelCatalogEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const modelId = typeof record.id === "string" ? record.id.trim() : "";
  if (!modelId) return null;
  const topProvider =
    record.top_provider && typeof record.top_provider === "object"
      ? (record.top_provider as Record<string, unknown>)
      : undefined;
  const architecture =
    record.architecture && typeof record.architecture === "object"
      ? (record.architecture as Record<string, unknown>)
      : undefined;
  const contextWindow = readPositiveInteger(
    record.context_length,
    record.context_window,
    record.max_context_length,
    record.max_model_len,
  );
  const maxOutputTokens = readPositiveInteger(
    topProvider?.max_completion_tokens,
    record.max_completion_tokens,
    record.max_output_tokens,
  );
  const inputFormat = parseInputFormat(architecture?.input_modalities ?? record.input_modalities);
  return {
    modelId,
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(inputFormat === undefined ? {} : { inputFormat }),
  };
}

export function parseRemoteModelCatalog(payload: unknown): RemoteModelCatalogEntry[] {
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? ((payload as { data?: unknown; models?: unknown }).data ??
        (payload as { models?: unknown }).models)
      : undefined;
  if (!Array.isArray(records)) return [];
  const seen = new Set<string>();
  const entries: RemoteModelCatalogEntry[] = [];
  for (const record of records) {
    const entry = parseCatalogRecord(record);
    if (!entry || seen.has(entry.modelId)) continue;
    seen.add(entry.modelId);
    entries.push(entry);
  }
  return entries;
}

export function buildRecommendedModelConfigFromCatalogEntry(
  entry: RemoteModelCatalogEntry,
): ModelConfigObject {
  const properties =
    entry.contextWindow === undefined && entry.inputFormat === undefined
      ? undefined
      : {
          ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
          ...(entry.inputFormat === undefined ? {} : { inputFormat: entry.inputFormat }),
        };
  const optionSpecs =
    entry.maxOutputTokens === undefined
      ? undefined
      : { maxOutputTokens: { max: entry.maxOutputTokens } };
  return {
    enabled: true,
    ...(properties === undefined ? {} : { properties }),
    ...(optionSpecs === undefined ? {} : { optionSpecs }),
  };
}

export function shouldAutoImportRemoteModelCatalog(
  existingModelIds: readonly string[],
): boolean {
  return existingModelIds.length === 0;
}

export function isRemoteModelCatalogConnectionComplete(
  snapshot: RemoteModelCatalogConnectionSnapshot,
): boolean {
  return (
    snapshot.group === "standard-personal" &&
    Boolean(snapshot.apiType) &&
    Boolean(snapshot.baseUrl?.trim())
  );
}

export function shouldAutoSyncRemoteModelCatalogAfterConnectionSave(
  previous: RemoteModelCatalogConnectionSnapshot,
  next: RemoteModelCatalogConnectionSnapshot,
): boolean {
  if (!isRemoteModelCatalogConnectionComplete(next)) return false;
  return (
    previous.apiType !== next.apiType ||
    (previous.baseUrl ?? "").trim() !== (next.baseUrl ?? "").trim() ||
    (previous.apiKey ?? "") !== (next.apiKey ?? "")
  );
}

function catalogEntryHasMetadata(entry: RemoteModelCatalogEntry): boolean {
  return (
    entry.contextWindow !== undefined ||
    entry.maxOutputTokens !== undefined ||
    entry.inputFormat !== undefined
  );
}

function existingNeedsCatalogUpdate(
  existing: RemoteModelCatalogExistingModel,
  entry: RemoteModelCatalogEntry,
): boolean {
  if (existing.useRecommendedConfig === false) return false;
  if (!catalogEntryHasMetadata(entry)) return false;
  return (
    (entry.contextWindow !== undefined &&
      existing.effectiveContextWindow !== entry.contextWindow) ||
    (entry.maxOutputTokens !== undefined &&
      existing.effectiveMaxOutputTokens !== entry.maxOutputTokens)
  );
}

export function buildOpenCodeModelApiTypeIndex(
  templates: readonly OpenCodeCatalogTemplateSnapshot[],
  family: OpenCodeApiKeyPoolFamily,
): ReadonlyMap<string, ProviderApiType> {
  const assigned = new Map<string, ProviderApiType>();
  const conflicts = new Set<string>();
  for (const template of templates) {
    if (resolveOpenCodeApiKeyPoolFamily(template.templateId) !== family) continue;
    const apiType = template.apiType;
    if (!apiType) continue;
    for (const rawId of template.builtinModelIds ?? []) {
      const modelId = rawId.trim();
      if (!modelId || conflicts.has(modelId)) continue;
      const previous = assigned.get(modelId);
      if (previous && previous !== apiType) {
        assigned.delete(modelId);
        conflicts.add(modelId);
        continue;
      }
      assigned.set(modelId, apiType);
    }
  }
  return assigned;
}

export function catalogModelMatchesProviderApiType(input: {
  readonly modelId: string;
  readonly providerApiType?: ProviderApiType | null;
  readonly modelApiTypeById?: ReadonlyMap<string, ProviderApiType> | null;
  readonly failClosedWhenUnindexed?: boolean;
}): boolean {
  const index = input.modelApiTypeById;
  const providerApiType = input.providerApiType;
  if (!index || !providerApiType) return true;
  const modelApiType = index.get(input.modelId);
  if (modelApiType == null) return input.failClosedWhenUnindexed !== true;
  return modelApiType === providerApiType;
}

export function planOpenCodeMismatchedPersonalModelIds(input: {
  readonly existing: readonly RemoteModelCatalogExistingModel[];
  readonly providerApiType: ProviderApiType;
  readonly modelApiTypeById: ReadonlyMap<string, ProviderApiType>;
}): readonly string[] {
  const removed: string[] = [];
  for (const model of input.existing) {
    if (model.builtin) continue;
    const modelApiType = input.modelApiTypeById.get(model.modelId);
    if (modelApiType != null && modelApiType !== input.providerApiType) {
      removed.push(model.modelId);
    }
  }
  return removed;
}

export function planRemoteModelCatalogSync(input: {
  readonly existing: readonly RemoteModelCatalogExistingModel[];
  readonly catalog: readonly RemoteModelCatalogEntry[];
  readonly importNewModels: boolean;
  readonly providerApiType?: ProviderApiType | null;
  readonly modelApiTypeById?: ReadonlyMap<string, ProviderApiType> | null;
  readonly failClosedWhenUnindexed?: boolean;
}): RemoteModelCatalogSyncPlan {
  const allowed = (modelId: string): boolean =>
    catalogModelMatchesProviderApiType({
      modelId,
      providerApiType: input.providerApiType,
      modelApiTypeById: input.modelApiTypeById,
      failClosedWhenUnindexed: input.failClosedWhenUnindexed,
    });
  const remove =
    input.failClosedWhenUnindexed === true && input.providerApiType && input.modelApiTypeById
      ? planOpenCodeMismatchedPersonalModelIds({
          existing: input.existing,
          providerApiType: input.providerApiType,
          modelApiTypeById: input.modelApiTypeById,
        })
      : [];
  const removedIds = new Set(remove);
  const existingById = new Map(input.existing.map((model) => [model.modelId, model]));
  const update: RemoteModelCatalogEntry[] = [];
  const add: RemoteModelCatalogEntry[] = [];
  for (const entry of input.catalog) {
    if (!allowed(entry.modelId) || removedIds.has(entry.modelId)) continue;
    const current = existingById.get(entry.modelId);
    if (current) {
      if (existingNeedsCatalogUpdate(current, entry)) update.push(entry);
      continue;
    }
    if (input.importNewModels && add.length < REMOTE_MODEL_CATALOG_IMPORT_LIMIT) {
      add.push(entry);
    }
  }
  return { add, update, remove };
}
