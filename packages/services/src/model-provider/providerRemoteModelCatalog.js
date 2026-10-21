import { resolveOpenCodeApiKeyPoolFamily, } from "./providerApiKeyPool.js";
export const REMOTE_MODEL_CATALOG_IMPORT_LIMIT = 200;
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function readPositiveInteger(...candidates) {
    for (const candidate of candidates) {
        if (isPositiveInteger(candidate))
            return candidate;
        if (typeof candidate === "string" && /^\d+$/.test(candidate.trim())) {
            const parsed = Number.parseInt(candidate.trim(), 10);
            if (parsed > 0)
                return parsed;
        }
    }
    return undefined;
}
export function resolveRemoteModelCatalogUrl(apiType, baseUrl) {
    const root = trimTrailingSlash(baseUrl.trim());
    if (!root)
        throw new Error("Provider Base URL 不能为空");
    if (apiType === "anthropic-messages") {
        return root.endsWith("/v1") ? `${root}/models` : `${root}/v1/models`;
    }
    return `${root}/models`;
}
export function buildRemoteModelCatalogHeaders(apiType, apiKey, extraHeaders) {
    const headers = extraHeaders ? { ...extraHeaders } : {};
    const key = apiKey?.trim();
    if (apiType === "anthropic-messages") {
        headers["anthropic-version"] ??= "2023-06-01";
        if (key)
            headers["x-api-key"] = key;
        return headers;
    }
    if (key)
        headers.Authorization = `Bearer ${key}`;
    return headers;
}
function parseInputFormat(modalities) {
    if (!Array.isArray(modalities) || modalities.length === 0)
        return undefined;
    const set = new Set(modalities
        .filter((item) => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean));
    if (set.size === 0)
        return undefined;
    return {
        supportsText: set.has("text"),
        supportsImage: set.has("image"),
        supportsVideo: set.has("video"),
        supportsAudio: set.has("audio"),
        supportsPdf: set.has("pdf"),
    };
}
function parseCatalogRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    const modelId = typeof record.id === "string" ? record.id.trim() : "";
    if (!modelId)
        return null;
    const topProvider = record.top_provider && typeof record.top_provider === "object"
        ? record.top_provider
        : undefined;
    const architecture = record.architecture && typeof record.architecture === "object"
        ? record.architecture
        : undefined;
    const contextWindow = readPositiveInteger(record.context_length, record.context_window, record.max_context_length, record.max_model_len);
    const maxOutputTokens = readPositiveInteger(topProvider?.max_completion_tokens, record.max_completion_tokens, record.max_output_tokens);
    const inputFormat = parseInputFormat(architecture?.input_modalities ?? record.input_modalities);
    return {
        modelId,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
        ...(inputFormat === undefined ? {} : { inputFormat }),
    };
}
export function parseRemoteModelCatalog(payload) {
    const records = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object"
            ? (payload.data ??
                payload.models)
            : undefined;
    if (!Array.isArray(records))
        return [];
    const seen = new Set();
    const entries = [];
    for (const record of records) {
        const entry = parseCatalogRecord(record);
        if (!entry || seen.has(entry.modelId))
            continue;
        seen.add(entry.modelId);
        entries.push(entry);
    }
    return entries;
}
export function buildRecommendedModelConfigFromCatalogEntry(entry) {
    const properties = entry.contextWindow === undefined && entry.inputFormat === undefined
        ? undefined
        : {
            ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
            ...(entry.inputFormat === undefined ? {} : { inputFormat: entry.inputFormat }),
        };
    const optionSpecs = entry.maxOutputTokens === undefined
        ? undefined
        : { maxOutputTokens: { max: entry.maxOutputTokens } };
    return {
        enabled: true,
        ...(properties === undefined ? {} : { properties }),
        ...(optionSpecs === undefined ? {} : { optionSpecs }),
    };
}
export function shouldAutoImportRemoteModelCatalog(existingModelIds) {
    return existingModelIds.length === 0;
}
export function isRemoteModelCatalogConnectionComplete(snapshot) {
    return (snapshot.group === "standard-personal" &&
        Boolean(snapshot.apiType) &&
        Boolean(snapshot.baseUrl?.trim()));
}
export function shouldAutoSyncRemoteModelCatalogAfterConnectionSave(previous, next) {
    if (!isRemoteModelCatalogConnectionComplete(next))
        return false;
    return (previous.apiType !== next.apiType ||
        (previous.baseUrl ?? "").trim() !== (next.baseUrl ?? "").trim() ||
        (previous.apiKey ?? "") !== (next.apiKey ?? ""));
}
function catalogEntryHasMetadata(entry) {
    return (entry.contextWindow !== undefined ||
        entry.maxOutputTokens !== undefined ||
        entry.inputFormat !== undefined);
}
function existingNeedsCatalogUpdate(existing, entry) {
    if (existing.useRecommendedConfig === false)
        return false;
    if (!catalogEntryHasMetadata(entry))
        return false;
    return ((entry.contextWindow !== undefined &&
        existing.effectiveContextWindow !== entry.contextWindow) ||
        (entry.maxOutputTokens !== undefined &&
            existing.effectiveMaxOutputTokens !== entry.maxOutputTokens));
}
export function buildOpenCodeModelApiTypeIndex(templates, family) {
    const assigned = new Map();
    const conflicts = new Set();
    for (const template of templates) {
        if (resolveOpenCodeApiKeyPoolFamily(template.templateId) !== family)
            continue;
        const apiType = template.apiType;
        if (!apiType)
            continue;
        for (const rawId of template.builtinModelIds ?? []) {
            const modelId = rawId.trim();
            if (!modelId || conflicts.has(modelId))
                continue;
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
export function catalogModelMatchesProviderApiType(input) {
    const index = input.modelApiTypeById;
    const providerApiType = input.providerApiType;
    if (!index || !providerApiType)
        return true;
    const modelApiType = index.get(input.modelId);
    if (modelApiType == null)
        return input.failClosedWhenUnindexed !== true;
    return modelApiType === providerApiType;
}
export function planOpenCodeMismatchedPersonalModelIds(input) {
    const removed = [];
    for (const model of input.existing) {
        if (model.builtin)
            continue;
        const modelApiType = input.modelApiTypeById.get(model.modelId);
        if (modelApiType != null && modelApiType !== input.providerApiType) {
            removed.push(model.modelId);
        }
    }
    return removed;
}
export function planRemoteModelCatalogSync(input) {
    const allowed = (modelId) => catalogModelMatchesProviderApiType({
        modelId,
        providerApiType: input.providerApiType,
        modelApiTypeById: input.modelApiTypeById,
        failClosedWhenUnindexed: input.failClosedWhenUnindexed,
    });
    const remove = input.failClosedWhenUnindexed === true && input.providerApiType && input.modelApiTypeById
        ? planOpenCodeMismatchedPersonalModelIds({
            existing: input.existing,
            providerApiType: input.providerApiType,
            modelApiTypeById: input.modelApiTypeById,
        })
        : [];
    const removedIds = new Set(remove);
    const existingById = new Map(input.existing.map((model) => [model.modelId, model]));
    const update = [];
    const add = [];
    for (const entry of input.catalog) {
        if (!allowed(entry.modelId) || removedIds.has(entry.modelId))
            continue;
        const current = existingById.get(entry.modelId);
        if (current) {
            if (existingNeedsCatalogUpdate(current, entry))
                update.push(entry);
            continue;
        }
        if (input.importNewModels && add.length < REMOTE_MODEL_CATALOG_IMPORT_LIMIT) {
            add.push(entry);
        }
    }
    return { add, update, remove };
}
