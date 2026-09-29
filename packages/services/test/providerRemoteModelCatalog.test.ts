import assert from "node:assert/strict";
import test from "node:test";
import {
  REMOTE_MODEL_CATALOG_IMPORT_LIMIT,
  buildOpenCodeModelApiTypeIndex,
  buildRemoteModelCatalogHeaders,
  buildRecommendedModelConfigFromCatalogEntry,
  catalogModelMatchesProviderApiType,
  parseRemoteModelCatalog,
  planOpenCodeMismatchedPersonalModelIds,
  planRemoteModelCatalogSync,
  resolveRemoteModelCatalogUrl,
  shouldAutoImportRemoteModelCatalog,
  shouldAutoSyncRemoteModelCatalogAfterConnectionSave,
} from "../src/model-provider/providerRemoteModelCatalog.js";

test("openai-compatible catalog URL appends /models to the chat root", () => {
  assert.equal(
    resolveRemoteModelCatalogUrl("openai-chat-completions", "https://api.openai.com/v1/"),
    "https://api.openai.com/v1/models",
  );
  assert.equal(
    resolveRemoteModelCatalogUrl("openai-responses", "https://api.openai.com/v1"),
    "https://api.openai.com/v1/models",
  );
});

test("anthropic catalog URL uses /v1/models when the base has no version suffix", () => {
  assert.equal(
    resolveRemoteModelCatalogUrl("anthropic-messages", "https://api.anthropic.com"),
    "https://api.anthropic.com/v1/models",
  );
  assert.equal(
    resolveRemoteModelCatalogUrl("anthropic-messages", "https://openrouter.ai/api"),
    "https://openrouter.ai/api/v1/models",
  );
  assert.equal(
    resolveRemoteModelCatalogUrl("anthropic-messages", "https://api.anthropic.com/v1"),
    "https://api.anthropic.com/v1/models",
  );
});

test("catalog headers follow the provider API format and keep custom headers", () => {
  assert.deepEqual(
    buildRemoteModelCatalogHeaders("openai-chat-completions", "sk-test", {
      "X-Title": "ZCode",
    }),
    {
      Authorization: "Bearer sk-test",
      "X-Title": "ZCode",
    },
  );
  assert.deepEqual(
    buildRemoteModelCatalogHeaders("anthropic-messages", "sk-ant"),
    {
      "x-api-key": "sk-ant",
      "anthropic-version": "2023-06-01",
    },
  );
});

test("parses OpenAI, Anthropic, OpenRouter, and raw catalog payloads", () => {
  assert.deepEqual(
    parseRemoteModelCatalog({
      data: [{ id: "gpt-5.4" }, { id: "  " }, { object: "model" }],
    }).map((entry) => entry.modelId),
    ["gpt-5.4"],
  );
  assert.deepEqual(
    parseRemoteModelCatalog({
      data: [{ id: "claude-sonnet-4-5", type: "model" }],
    }).map((entry) => entry.modelId),
    ["claude-sonnet-4-5"],
  );
  const openrouter = parseRemoteModelCatalog({
    data: [
      {
        id: "anthropic/claude-sonnet-4.5",
        context_length: 200000,
        architecture: { input_modalities: ["text", "image", "pdf"] },
        top_provider: { max_completion_tokens: 64000 },
      },
    ],
  });
  assert.deepEqual(openrouter, [
    {
      modelId: "anthropic/claude-sonnet-4.5",
      contextWindow: 200000,
      maxOutputTokens: 64000,
      inputFormat: {
        supportsText: true,
        supportsImage: true,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: true,
      },
    },
  ]);
  assert.deepEqual(
    parseRemoteModelCatalog([{ id: "local-model", context_window: 32768 }]),
    [{ modelId: "local-model", contextWindow: 32768 }],
  );
});

test("recommended overlay only copies catalog leaves that the remote actually sent", () => {
  assert.deepEqual(
    buildRecommendedModelConfigFromCatalogEntry({
      modelId: "gpt-5.4",
      contextWindow: 128000,
      maxOutputTokens: 16384,
      inputFormat: { supportsImage: true, supportsText: true },
    }),
    {
      enabled: true,
      properties: {
        contextWindow: 128000,
        inputFormat: { supportsImage: true, supportsText: true },
      },
      optionSpecs: { maxOutputTokens: { max: 16384 } },
    },
  );
  assert.deepEqual(buildRecommendedModelConfigFromCatalogEntry({ modelId: "plain" }), {
    enabled: true,
  });
});

test("auto-import only when the provider currently has no models", () => {
  assert.equal(shouldAutoImportRemoteModelCatalog([]), true);
  assert.equal(shouldAutoImportRemoteModelCatalog(["glm-5"]), false);
  assert.equal(REMOTE_MODEL_CATALOG_IMPORT_LIMIT, 200);
});

test("auto-sync after connection save requires a complete personal provider and a connection change", () => {
  const previous = {
    group: "standard-personal" as const,
    apiType: "openai-chat-completions" as const,
    baseUrl: "https://provider.example/v1",
    apiKey: "",
  };
  const next = { ...previous, apiKey: "sk-live" };
  assert.equal(shouldAutoSyncRemoteModelCatalogAfterConnectionSave(previous, next), true);
  assert.equal(shouldAutoSyncRemoteModelCatalogAfterConnectionSave(next, next), false);
  assert.equal(
    shouldAutoSyncRemoteModelCatalogAfterConnectionSave(previous, {
      ...next,
      group: "zai-family",
    }),
    false,
  );
  assert.equal(
    shouldAutoSyncRemoteModelCatalogAfterConnectionSave(previous, { ...previous, apiKey: "sk-live" }),
    true,
  );
  assert.equal(
    shouldAutoSyncRemoteModelCatalogAfterConnectionSave(previous, {
      ...previous,
      baseUrl: "",
      apiKey: "sk-live",
    }),
    false,
  );
});

test("sync plan imports new models up to the cap and updates existing recommended metadata", () => {
  const catalog = [
    { modelId: "keep-me", contextWindow: 200000 },
    { modelId: "new-a", contextWindow: 64000 },
    { modelId: "manual-one", contextWindow: 8000 },
    { modelId: "new-b" },
  ];
  const auto = planRemoteModelCatalogSync({
    existing: [
      {
        modelId: "keep-me",
        useRecommendedConfig: true,
        effectiveContextWindow: 128000,
        effectiveMaxOutputTokens: undefined,
      },
      {
        modelId: "manual-one",
        useRecommendedConfig: false,
        effectiveContextWindow: 8000,
        effectiveMaxOutputTokens: undefined,
      },
    ],
    catalog,
    importNewModels: false,
  });
  assert.deepEqual(
    auto.update.map((entry) => entry.modelId),
    ["keep-me"],
  );
  assert.deepEqual(auto.add, []);

  const existing = [
    {
      modelId: "keep-me",
      useRecommendedConfig: true,
      effectiveContextWindow: 128000,
      effectiveMaxOutputTokens: undefined,
    },
    {
      modelId: "manual-one",
      useRecommendedConfig: false,
      effectiveContextWindow: 8000,
      effectiveMaxOutputTokens: undefined,
    },
  ];
  const explicit = planRemoteModelCatalogSync({
    existing,
    catalog,
    importNewModels: true,
  });
  assert.deepEqual(
    explicit.add.map((entry) => entry.modelId),
    ["new-a", "new-b"],
  );
});

const OPENCODE_TEMPLATES = [
  {
    templateId: "opencode-go-chat",
    apiType: "openai-chat-completions" as const,
    builtinModelIds: ["glm-5.3-flash", "deepseek-v4.1-flash", "kimi-k3"],
  },
  {
    templateId: "opencode-go-responses",
    apiType: "openai-responses" as const,
    builtinModelIds: ["gpt-5.6-luna", "grok-4.6"],
  },
  {
    templateId: "opencode-go-messages",
    apiType: "anthropic-messages" as const,
    builtinModelIds: ["minimax-m3"],
  },
];

test("OpenCode catalog index maps builtin ids to the sibling template API type", () => {
  const index = buildOpenCodeModelApiTypeIndex(OPENCODE_TEMPLATES, "opencode-go");
  assert.equal(index.get("glm-5.3-flash"), "openai-chat-completions");
  assert.equal(index.get("grok-4.6"), "openai-responses");
  assert.equal(index.get("minimax-m3"), "anthropic-messages");
  assert.equal(index.has("muse-spark-1.3-contributor"), false);
});

test("OpenCode responses provider fail-closed: skip unindexed and mismatched API types", () => {
  const index = buildOpenCodeModelApiTypeIndex(OPENCODE_TEMPLATES, "opencode-go");
  assert.equal(
    catalogModelMatchesProviderApiType({
      modelId: "grok-4.6",
      providerApiType: "openai-responses",
      modelApiTypeById: index,
      failClosedWhenUnindexed: true,
    }),
    true,
  );
  assert.equal(
    catalogModelMatchesProviderApiType({
      modelId: "glm-5.3-flash",
      providerApiType: "openai-responses",
      modelApiTypeById: index,
      failClosedWhenUnindexed: true,
    }),
    false,
  );
  assert.equal(
    catalogModelMatchesProviderApiType({
      modelId: "muse-spark-1.3-contributor",
      providerApiType: "openai-responses",
      modelApiTypeById: index,
      failClosedWhenUnindexed: true,
    }),
    false,
  );
});

test("sync plan does not dump chat models onto a responses OpenCode provider and removes mismatches", () => {
  const index = buildOpenCodeModelApiTypeIndex(OPENCODE_TEMPLATES, "opencode-go");
  const plan = planRemoteModelCatalogSync({
    existing: [
      { modelId: "glm-5.3-flash", builtin: false },
      { modelId: "grok-4.6", builtin: true },
      { modelId: "muse-spark-1.3-contributor", builtin: false },
    ],
    catalog: [
      { modelId: "glm-5.3-flash", contextWindow: 128000 },
      { modelId: "grok-4.6", contextWindow: 196608 },
      { modelId: "gpt-5.6-luna" },
      { modelId: "kimi-k3" },
      { modelId: "muse-spark-1.3-contributor" },
    ],
    importNewModels: true,
    providerApiType: "openai-responses",
    modelApiTypeById: index,
    failClosedWhenUnindexed: true,
  });
  assert.deepEqual(plan.remove, ["glm-5.3-flash"]);
  assert.deepEqual(
    plan.add.map((entry) => entry.modelId),
    ["gpt-5.6-luna"],
  );
  assert.deepEqual(
    planOpenCodeMismatchedPersonalModelIds({
      existing: [
        { modelId: "glm-5.3-flash", builtin: false },
        { modelId: "grok-4.6", builtin: true },
      ],
      providerApiType: "openai-responses",
      modelApiTypeById: index,
    }),
    ["glm-5.3-flash"],
  );
});
