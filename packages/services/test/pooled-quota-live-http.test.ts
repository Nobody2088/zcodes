import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { apiKeyPoolKeyId } from "@zcode/shared/node";
import type { ModelInvocationContext } from "../../../apps/zcode-cli/packages/contracts/src/model/invocation-context.ts";
import type { ICredentialService } from "../src/credential/credential.js";
import type {
  IProviderSettingsService,
  ProviderSettingsView,
} from "../src/model-provider/providerFacadeServices.js";
import {
  createProviderApiKeyPoolService,
  type IProviderApiKeyPoolService,
} from "../src/model-provider/providerApiKeyPoolService.js";
import { runWithModelInvocationContext } from "../../../apps/zcode-cli/packages/contracts/dist/model/invocation-context.js";
import { AiSdkModelAdapter } from "../../../apps/zcode-cli/packages/adapters/src/model/runner.js";

const KEY_ALPHA = "sk-live-quota-alpha-aaaa";
const KEY_BETA = "sk-live-quota-beta-bbbb";
const QUOTA_BODY = {
  error: {
    message: "credit insufficient balance: balance=24368 required=74552",
    type: "new_api_error",
    code: "insufficient_user_quota",
  },
};

type Mode = "switch" | "plain" | "both";

function createMemoryCredentials(): ICredentialService {
  const values = new Map<string, string>();
  return {
    async load(key) {
      return values.get(key) ?? null;
    },
    async save(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

function createSettings(baseUrl: string) {
  const keys = new Map<string, string>();
  const settings = {
    async getView(): Promise<ProviderSettingsView> {
      const providers = [...keys.keys()].map((providerId) => {
        const access = { type: "api-key" as const, apiKey: keys.get(providerId) || null };
        const api = { type: "openai-chat-completions" as const, baseUrl };
        return {
          providerId,
          templateId: "",
          providerName: providerId,
          enabled: true,
          executable: true,
          personalConfig: { access, api },
          effectiveConfig: { access, api },
          issues: [],
          models: [],
        };
      });
      return {
        revision: 1,
        providerTemplates: [],
        providerOrder: [...keys.keys()],
        providers,
      };
    },
    async savePersonalProviderOverlay(providerId: string, config: unknown) {
      const apiKey =
        typeof config === "object" &&
        config !== null &&
        "access" in config &&
        typeof (config as { access?: { apiKey?: string } }).access?.apiKey === "string"
          ? (config as { access: { apiKey: string } }).access.apiKey
          : "";
      keys.set(providerId, apiKey);
      return this.getView();
    },
  } satisfies Pick<IProviderSettingsService, "getView" | "savePersonalProviderOverlay">;
  return {
    settings,
    ensure(providerId: string) {
      if (!keys.has(providerId)) keys.set(providerId, "");
    },
  };
}

function bearer(request: IncomingMessage): string {
  return (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function startGateway() {
  const calls: string[] = [];
  let mode: Mode = "switch";
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const key = bearer(request);
    calls.push(key);
    const streaming = body.includes('"stream":true');
    writeGatewayResponse(response, mode, key, streaming);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    calls,
    setMode(next: Mode) {
      mode = next;
      calls.length = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function writeGatewayResponse(
  response: ServerResponse,
  mode: Mode,
  key: string,
  streaming: boolean,
): void {
  if (mode === "plain") {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: {
          message: "Invalid parameter: temperature",
          type: "invalid_request_error",
          code: "invalid_request_error",
        },
      }),
    );
    return;
  }
  if (mode === "both" || key === KEY_ALPHA) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify(QUOTA_BODY));
    return;
  }
  if (streaming) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({
        id: "chatcmpl-live",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content: "switched-ok" }, finish_reason: null }],
      })}\n\ndata: ${JSON.stringify({
        id: "chatcmpl-live",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\ndata: [DONE]\n\n`,
    );
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id: "chatcmpl-live",
      object: "chat.completion",
      created: 0,
      model: "deepseek-v4.1-flash",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "switched-ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }),
  );
}

function tail(secret: string): string {
  return secret.slice(-6);
}

const modelConfig = {
  properties: {
    requiresMfjsToolSchema: false,
    contextWindow: 8192,
    inputFormat: {
      supportsText: true,
      supportsImage: false,
      supportsVideo: false,
      supportsAudio: false,
      supportsPdf: false,
    },
    outputFormat: { supportsText: true },
    supportsToolCall: false,
    supportsJsonSchemaOutput: false,
    supportsNativeWebSearch: false,
    supportsMidConversationSystem: true,
  },
  optionSpecs: {
    reasoningLevel: { values: ["off"], map: "{}" },
    maxOutputTokens: { max: 64, map: "{'max_tokens': maxOutputTokens}" },
  },
} as const;

function poolContext(service: IProviderApiKeyPoolService): ModelInvocationContext {
  return {
    readActivePooledApiKey: ({ providerId }) => service.readActiveKey(providerId),
    claimNextPooledApiKey: async ({ providerId, failedKeyId, status }) => {
      const next = await service.claimNextKeyAfterFailure(providerId, failedKeyId, status);
      if (!next.rotated || !next.apiKey || !next.keyId) return null;
      return { apiKey: next.apiKey, keyId: next.keyId };
    },
  };
}

test("live HTTP: insufficient balance switches keys for generate and stream", async () => {
  const gateway = await startGateway();
  const { settings, ensure } = createSettings(gateway.baseUrl);
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
  });
  const adapter = new AiSdkModelAdapter({
    retry: { backoffFactor: 1, baseDelayMs: 1, jitter: false, maxAttempts: 1, maxDelayMs: 1 },
  });
  const createLiveModel = (providerId: string) =>
    adapter.createModel({
      providerId,
      modelId: "deepseek-v4.1-flash",
      providerConfig: {
        access: { type: "api-key", apiKey: KEY_ALPHA },
        api: { type: "openai-chat-completions", baseUrl: gateway.baseUrl },
      } as never,
      modelConfig: modelConfig as never,
    });
  const request = {
    messages: [{ role: "user" as const, content: "ping" }],
    options: { maxOutputTokens: 16, reasoningLevel: "off" },
  };

  try {
    const providerId = "live-quota-provider";
    ensure(providerId);
    const added = await service.addKeys(providerId, `${KEY_ALPHA}\n${KEY_BETA}`);
    assert.equal(added.added, 2);
    gateway.setMode("switch");
    const switched = await runWithModelInvocationContext(poolContext(service), () =>
      createLiveModel(providerId).generateText(request),
    );
    assert.equal(switched.text, "switched-ok");
    assert.deepEqual(gateway.calls.map(tail), [tail(KEY_ALPHA), tail(KEY_BETA)]);
    const afterSwitch = await service.getView(providerId);
    assert.equal(
      afterSwitch.keys.find((item) => item.keyId === apiKeyPoolKeyId(KEY_ALPHA))?.group,
      "exhausted",
    );
    assert.equal(
      afterSwitch.keys.find((item) => item.keyId === apiKeyPoolKeyId(KEY_BETA))?.group,
      "pool",
    );
    const streamId = "live-quota-stream";
    ensure(streamId);
    await service.addKeys(streamId, `${KEY_ALPHA}\n${KEY_BETA}`);
    gateway.setMode("switch");
    let streamed = "";
    const events = await runWithModelInvocationContext(poolContext(service), () =>
      createLiveModel(streamId).streamText(request),
    );
    for await (const event of events) {
      if (event.type === "text_delta") streamed += event.text;
    }
    assert.equal(streamed, "switched-ok");
    assert.deepEqual(gateway.calls.map(tail), [tail(KEY_ALPHA), tail(KEY_BETA)]);
    const afterStream = await service.getView(streamId);
    assert.equal(
      afterStream.keys.find((item) => item.keyId === apiKeyPoolKeyId(KEY_ALPHA))?.group,
      "exhausted",
    );
    const plainId = "live-plain-400";
    ensure(plainId);
    await service.addKeys(plainId, `${KEY_ALPHA}\n${KEY_BETA}`);
    gateway.setMode("plain");
    await assert.rejects(() =>
      runWithModelInvocationContext(poolContext(service), () =>
        createLiveModel(plainId).generateText(request),
      ),
    );
    assert.deepEqual(gateway.calls.map(tail), [tail(KEY_ALPHA)]);
    const afterPlain = await service.getView(plainId);
    assert.equal(
      afterPlain.keys.every((item) => item.group === "pool"),
      true,
    );
    const bothId = "live-both-exhausted";
    ensure(bothId);
    await service.addKeys(bothId, `${KEY_ALPHA}\n${KEY_BETA}`);
    gateway.setMode("both");
    await assert.rejects(() =>
      runWithModelInvocationContext(poolContext(service), () =>
        createLiveModel(bothId).generateText(request),
      ),
    );
    assert.deepEqual(gateway.calls.map(tail), [tail(KEY_ALPHA), tail(KEY_BETA)]);
    const afterBoth = await service.getView(bothId);
    assert.equal(
      afterBoth.keys.every((item) => item.group === "exhausted"),
      true,
    );
  } finally {
    await gateway.close();
  }
});
