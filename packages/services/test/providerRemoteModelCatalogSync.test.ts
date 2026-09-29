import assert from "node:assert/strict";
import test from "node:test";
import type {
  ModelConfigObject,
  ProviderSettingsFacade,
  ProviderSettingsView,
} from "@zcode/provider";
import {
  reconcileOpenCodePersonalCatalogMembership,
  scheduleOpenCodePersonalCatalogReconcileAfterReady,
  syncRemoteProviderModelsFromCatalog,
} from "../src/model-provider/providerRemoteModelCatalogSync.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createView(overrides?: {
  readonly providerId?: string;
  readonly templateId?: string;
  readonly group?: string;
  readonly apiType?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly models?: readonly {
    readonly modelId: string;
    readonly builtin?: boolean;
    readonly useRecommendedConfig?: boolean;
    readonly contextWindow?: number;
  }[];
  readonly providerTemplates?: ProviderSettingsView["providerTemplates"];
}): ProviderSettingsView {
  const providerId = overrides?.providerId ?? "personal-1";
  return {
    revision: 1,
    providerTemplates: overrides?.providerTemplates ?? [],
    providerOrder: [providerId],
    providers: [
      {
        providerId,
        templateId: overrides?.templateId,
        providerName: "Custom",
        enabled: true,
        executable: true,
        issues: [],
        effectiveConfig: {
          group: overrides?.group ?? "standard-personal",
          api: {
            type: (overrides?.apiType ?? "openai-chat-completions") as "openai-chat-completions",
            baseUrl: overrides?.baseUrl ?? "https://provider.example/v1",
          },
          access: {
            type: "api-key",
            apiKey: overrides?.apiKey ?? "sk-live",
          },
        },
        models: (overrides?.models ?? []).map((model) => ({
          kind: "candidate" as const,
          modelId: model.modelId,
          builtin: model.builtin ?? false,
          effectiveBuiltinConfig: {},
          personalExactConfig: {},
          useRecommendedConfig: model.useRecommendedConfig,
          effectiveConfig: {
            properties:
              model.contextWindow === undefined
                ? undefined
                : { contextWindow: model.contextWindow },
          },
          enabled: true,
          executable: true,
          selectable: true,
          issues: [],
        })),
      },
    ],
  };
}

function createFacade(initial: ProviderSettingsView) {
  let view = initial;
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const facade = {
    getView: () => view,
    waitForProviderOperations: async () => undefined,
    addPersonalModel: async (
      providerId: string,
      modelId: string,
      config: ModelConfigObject,
      useRecommendedConfig?: boolean,
    ) => {
      added.push(modelId);
      const provider = view.providers[0]!;
      view = {
        ...view,
        revision: view.revision + 1,
        providers: [
          {
            ...provider,
            models: [
              ...provider.models,
              {
                kind: "candidate",
                modelId,
                builtin: false,
                effectiveBuiltinConfig: config,
                personalExactConfig: config,
                useRecommendedConfig,
                effectiveConfig: config,
                enabled: true,
                executable: true,
                selectable: true,
                issues: [],
              },
            ],
          },
        ],
      };
      assert.equal(providerId, provider.providerId);
      return view;
    },
    savePersonalModelDraft: async (input: {
      readonly originalModelId: string;
      readonly personalConfig: ModelConfigObject;
    }) => {
      updated.push(input.originalModelId);
      view = { ...view, revision: view.revision + 1 };
      return view;
    },
    deletePersonalModel: async (providerId: string, modelId: string) => {
      removed.push(modelId);
      const provider = view.providers[0]!;
      view = {
        ...view,
        revision: view.revision + 1,
        providers: [
          {
            ...provider,
            models: provider.models.filter((model) => model.modelId !== modelId),
          },
        ],
      };
      assert.equal(providerId, provider.providerId);
      return view;
    },
  };
  return {
    facade: facade as unknown as ProviderSettingsFacade,
    added,
    updated,
    removed,
    getView: () => view,
  };
}

test("sync imports an empty personal provider catalog and writes recommended context leaves", async () => {
  const { facade, added } = createFacade(createView());
  const result = await syncRemoteProviderModelsFromCatalog({
    facade,
    providerId: "personal-1",
    request: async (input) => {
      assert.equal(String(input), "https://provider.example/v1/models");
      return jsonResponse({
        data: [
          {
            id: "glm-5",
            context_length: 128000,
            top_provider: { max_completion_tokens: 16000 },
          },
        ],
      });
    },
  });
  assert.equal(result.status, "synced");
  assert.equal(result.addedCount, 1);
  assert.equal(result.removedCount, 0);
  assert.deepEqual(added, ["glm-5"]);
  assert.equal(
    result.view.providers[0]?.models[0]?.effectiveConfig.properties?.contextWindow,
    128000,
  );
});

test("sync skips incomplete connections without requesting the catalog", async () => {
  const { facade } = createFacade(createView({ baseUrl: "" }));
  let requested = false;
  const result = await syncRemoteProviderModelsFromCatalog({
    facade,
    providerId: "personal-1",
    request: async () => {
      requested = true;
      return jsonResponse({ data: [] });
    },
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "incomplete-connection");
  assert.equal(requested, false);
});

test("explicit import adds new catalog IDs and updates existing recommended context", async () => {
  const { facade, added, updated } = createFacade(
    createView({
      models: [
        { modelId: "keep-me", useRecommendedConfig: true, contextWindow: 8000 },
        { modelId: "manual-one", useRecommendedConfig: false, contextWindow: 8000 },
      ],
    }),
  );
  const result = await syncRemoteProviderModelsFromCatalog({
    facade,
    providerId: "personal-1",
    importNewModels: true,
    request: async () =>
      jsonResponse({
        data: [
          { id: "keep-me", context_length: 200000 },
          { id: "manual-one", context_length: 64000 },
          { id: "new-a", context_length: 32000 },
        ],
      }),
  });
  assert.equal(result.status, "synced");
  assert.deepEqual(added, ["new-a"]);
  assert.deepEqual(updated, ["keep-me"]);
  assert.equal(result.addedCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.removedCount, 0);
});

test("catalog HTTP failure throws and does not add models", async () => {
  const { facade, added } = createFacade(createView());
  await assert.rejects(
    () =>
      syncRemoteProviderModelsFromCatalog({
        facade,
        providerId: "personal-1",
        request: async () => jsonResponse({ error: "unauthorized" }, 401),
      }),
    /unauthorized/,
  );
  assert.deepEqual(added, []);
});

const OPENCODE_TEMPLATES: ProviderSettingsView["providerTemplates"] = [
  {
    templateId: "opencode-go-chat",
    templateNameMap: { "en-US": "Chat", "zh-CN": "Chat" },
    config: {
      api: { type: "openai-chat-completions", baseUrl: "https://opencode.ai/zen/go/v1" },
      builtinModelIds: ["glm-5.3-flash", "deepseek-v4.1-flash"],
    },
  },
  {
    templateId: "opencode-go-responses",
    templateNameMap: { "en-US": "Responses", "zh-CN": "Responses" },
    config: {
      api: { type: "openai-responses", baseUrl: "https://opencode.ai/zen/go/v1" },
      builtinModelIds: ["gpt-5.6-luna", "grok-4.6"],
    },
  },
];

test("OpenCode responses sync drops chat-only personal models and does not import them", async () => {
  const { facade, added, removed } = createFacade(
    createView({
      templateId: "opencode-go-responses",
      apiType: "openai-responses",
      providerTemplates: OPENCODE_TEMPLATES,
      models: [
        { modelId: "glm-5.3-flash", builtin: false },
        { modelId: "grok-4.6", builtin: true },
      ],
    }),
  );
  const result = await syncRemoteProviderModelsFromCatalog({
    facade,
    providerId: "personal-1",
    importNewModels: true,
    request: async () =>
      jsonResponse({
        data: [
          { id: "glm-5.3-flash", context_length: 128000 },
          { id: "grok-4.6", context_length: 196608 },
          { id: "gpt-5.6-luna" },
          { id: "kimi-k3" },
        ],
      }),
  });
  assert.equal(result.status, "synced");
  assert.deepEqual(removed, ["glm-5.3-flash"]);
  assert.deepEqual(added, ["gpt-5.6-luna"]);
  assert.equal(result.removedCount, 1);
  assert.equal(
    result.view.providers[0]?.models.some((model) => model.modelId === "glm-5.3-flash"),
    false,
  );
});

test("startup reconcile drops mismatched OpenCode personal models without fetching the catalog", async () => {
  const { facade, removed } = createFacade(
    createView({
      templateId: "opencode-go-responses",
      apiType: "openai-responses",
      providerTemplates: OPENCODE_TEMPLATES,
      models: [
        { modelId: "glm-5.3-flash", builtin: false },
        { modelId: "deepseek-v4.1-flash", builtin: false },
        { modelId: "grok-4.6", builtin: true },
      ],
    }),
  );
  const count = await reconcileOpenCodePersonalCatalogMembership(facade);
  assert.equal(count, 2);
  assert.deepEqual(removed, ["glm-5.3-flash", "deepseek-v4.1-flash"]);
});

test("startup reconcile after ready does not block the ready promise when prune hangs", async () => {
  const { facade } = createFacade(createView());
  let readyResolved = false;
  const ready = Promise.resolve().then(() => {
    readyResolved = true;
  });
  let pruneStarted = false;
  scheduleOpenCodePersonalCatalogReconcileAfterReady({
    ready,
    facade,
    run: () =>
      new Promise(() => {
        pruneStarted = true;
      }),
    onError: () => {
      throw new Error("hanging prune must not reject ready");
    },
  });
  await ready;
  assert.equal(readyResolved, true);
  await Promise.resolve();
  assert.equal(pruneStarted, true);
});

test("startup reconcile after ready reports prune errors without rejecting ready", async () => {
  const { facade } = createFacade(createView());
  const ready = Promise.resolve();
  const seen: unknown[] = [];
  scheduleOpenCodePersonalCatalogReconcileAfterReady({
    ready,
    facade,
    run: async () => {
      throw new Error("prune boom");
    },
    onError: (error) => {
      seen.push(error);
    },
  });
  await ready;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(seen.length, 1);
  assert.equal(seen[0] instanceof Error && (seen[0] as Error).message, "prune boom");
});
