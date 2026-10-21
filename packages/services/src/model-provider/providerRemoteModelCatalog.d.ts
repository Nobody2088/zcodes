import type { ModelConfigObject, ProviderApiType } from "@zcode/provider";
import { type OpenCodeApiKeyPoolFamily } from "./providerApiKeyPool.js";
export declare const REMOTE_MODEL_CATALOG_IMPORT_LIMIT = 200;
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
export declare function resolveRemoteModelCatalogUrl(apiType: ProviderApiType, baseUrl: string): string;
export declare function buildRemoteModelCatalogHeaders(apiType: ProviderApiType, apiKey: string | null | undefined, extraHeaders?: Readonly<Record<string, string>> | null): Record<string, string>;
export declare function parseRemoteModelCatalog(payload: unknown): RemoteModelCatalogEntry[];
export declare function buildRecommendedModelConfigFromCatalogEntry(entry: RemoteModelCatalogEntry): ModelConfigObject;
export declare function shouldAutoImportRemoteModelCatalog(existingModelIds: readonly string[]): boolean;
export declare function isRemoteModelCatalogConnectionComplete(snapshot: RemoteModelCatalogConnectionSnapshot): boolean;
export declare function shouldAutoSyncRemoteModelCatalogAfterConnectionSave(previous: RemoteModelCatalogConnectionSnapshot, next: RemoteModelCatalogConnectionSnapshot): boolean;
export declare function buildOpenCodeModelApiTypeIndex(templates: readonly OpenCodeCatalogTemplateSnapshot[], family: OpenCodeApiKeyPoolFamily): ReadonlyMap<string, ProviderApiType>;
export declare function catalogModelMatchesProviderApiType(input: {
    readonly modelId: string;
    readonly providerApiType?: ProviderApiType | null;
    readonly modelApiTypeById?: ReadonlyMap<string, ProviderApiType> | null;
    readonly failClosedWhenUnindexed?: boolean;
}): boolean;
export declare function planOpenCodeMismatchedPersonalModelIds(input: {
    readonly existing: readonly RemoteModelCatalogExistingModel[];
    readonly providerApiType: ProviderApiType;
    readonly modelApiTypeById: ReadonlyMap<string, ProviderApiType>;
}): readonly string[];
export declare function planRemoteModelCatalogSync(input: {
    readonly existing: readonly RemoteModelCatalogExistingModel[];
    readonly catalog: readonly RemoteModelCatalogEntry[];
    readonly importNewModels: boolean;
    readonly providerApiType?: ProviderApiType | null;
    readonly modelApiTypeById?: ReadonlyMap<string, ProviderApiType> | null;
    readonly failClosedWhenUnindexed?: boolean;
}): RemoteModelCatalogSyncPlan;
//# sourceMappingURL=providerRemoteModelCatalog.d.ts.map