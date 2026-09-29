import assert from "node:assert/strict";
import test from "node:test";
import type { ICredentialService } from "../src/credential/credential.js";
import type {
  IProviderSettingsService,
  ProviderSettingsView,
} from "../src/model-provider/providerFacadeServices.js";
import { createProviderApiKeyPoolService } from "../src/model-provider/providerApiKeyPoolService.js";
import type { OpenCodeKeyProbeAttempt } from "../src/model-provider/providerApiKeyPool.js";

const PROVIDER_ID = "personal-opencode-go";

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

function createSettingsView(apiKey = ""): ProviderSettingsView {
  const access = { type: "api-key" as const, apiKey: apiKey || null };
  const api = {
    type: "openai-chat-completions" as const,
    baseUrl: "https://opencode.ai/zen/go/v1",
  };
  return {
    revision: 1,
    providerTemplates: [],
    providerOrder: [PROVIDER_ID],
    providers: [
      {
        providerId: PROVIDER_ID,
        templateId: "opencode-go-chat",
        providerName: "OpenCode Go (Chat)",
        enabled: true,
        executable: true,
        personalConfig: { access, api },
        effectiveConfig: { access, api },
        issues: [],
        models: [],
      },
    ],
  };
}

function createSettings(apiKey = "") {
  let view = createSettingsView(apiKey);
  const overlayWrites: unknown[] = [];
  const settings = {
    async getView() {
      return view;
    },
    async savePersonalProviderOverlay(providerId: string, config: unknown) {
      overlayWrites.push({ providerId, config });
      view = createSettingsView(
        typeof config === "object" &&
          config !== null &&
          "access" in config &&
          typeof (config as { access?: { apiKey?: string } }).access?.apiKey === "string"
          ? (config as { access: { apiKey: string } }).access.apiKey
          : "",
      );
      return view;
    },
  } satisfies Pick<IProviderSettingsService, "getView" | "savePersonalProviderOverlay">;
  return { settings, overlayWrites };
}

function poolUsage(percent: number, status: "ok" | "rate-limited" = "ok"): OpenCodeKeyProbeAttempt {
  return {
    kind: "http",
    urlKind: "usage",
    status: 200,
    json: {
      usage: {
        rolling: { status, percent, resetsAt: "2026-09-21T12:00:00.000Z" },
        weekly: {
          status: "ok",
          percent: Math.min(percent, 20),
          resetsAt: "2026-09-28T00:00:00.000Z",
        },
        monthly: {
          status: "ok",
          percent: Math.min(percent, 10),
          resetsAt: "2026-10-01T00:00:00.000Z",
        },
      },
    },
  };
}

test("batch add trims, skips empty, dedupes, and reports invalid without leaking secrets in the view", async () => {
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [poolUsage(15)],
  });
  const result = await service.addKeys(
    PROVIDER_ID,
    "  sk-test-pool-alpha  \n\nsk-test-pool-alpha\nbad key\n",
  );
  assert.equal(result.added, 1);
  assert.equal(result.duplicate, 1);
  assert.equal(result.invalid, 1);
  assert.equal(result.view.keys.length, 1);
  assert.equal(result.view.keys[0]?.group, "pool");
  assert.equal(JSON.stringify(result.view).includes("sk-test-pool-alpha"), false);
});

test("batch delete removes selected keys", async () => {
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [poolUsage(10)],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-one\nsk-test-pool-two");
  assert.equal(added.view.keys.length, 2);
  const remaining = await service.deleteKeys(PROVIDER_ID, [added.view.keys[0]!.keyId]);
  assert.equal(remaining.keys.length, 1);
  assert.equal(remaining.keys[0]?.keyId, added.view.keys[1]?.keyId);
});

test("probe failure does not roll back a successful batch add", async () => {
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => {
      throw new Error("quota endpoint unavailable");
    },
  });
  const result = await service.addKeys(PROVIDER_ID, "sk-test-pool-kept");
  assert.equal(result.added, 1);
  assert.equal(result.view.keys.length, 1);
  assert.equal(result.view.keys[0]?.maskedKey.includes("kept"), true);
  const view = await service.getView(PROVIDER_ID);
  assert.equal(view.keys.length, 1);
});

test("expired keys move to the expired group after probe", async () => {
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [
      {
        kind: "http",
        urlKind: "usage",
        status: 401,
        json: { error: { message: "API key expired" } },
      },
    ],
  });
  const result = await service.addKeys(PROVIDER_ID, "sk-test-pool-expired");
  assert.equal(result.view.keys[0]?.group, "expired");
});

test("cooling keys re-enter the pool after Host re-probe when availableAt is due", async () => {
  let now = 1_000;
  let remaining = 100;
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    now: () => now,
    probe: async () => [poolUsage(remaining, remaining >= 100 ? "rate-limited" : "ok")],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-cool");
  assert.equal(added.view.keys[0]?.group, "cooling");
  remaining = 8;
  now = (added.view.keys[0]?.availableAt ?? 0) + 1;
  const refreshed = await service.getView(PROVIDER_ID);
  assert.equal(refreshed.keys[0]?.group, "pool");
  assert.equal(refreshed.keys[0]?.availableAt, null);
});

function lastOverlayApiKey(writes: unknown[]): string | null {
  const last = writes.at(-1);
  if (!last || typeof last !== "object" || !("config" in last)) return null;
  const config = (last as { config?: { access?: { apiKey?: string | null } } }).config;
  return config?.access?.apiKey ?? null;
}

test("addKeys does not clobber an existing overlay with a higher remaining pool key", async () => {
  const overlay = "sk-test-overlay-m5yp";
  const { settings, overlayWrites } = createSettings(overlay);
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => [poolUsage(secret.includes("high") ? 10 : 88)],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-highquota");
  const overlayKey = added.view.keys.find((item) => item.maskedKey.endsWith("m5yp"));
  const highKey = added.view.keys.find((item) => item.keyId !== overlayKey?.keyId);
  assert.equal(overlayKey?.group, "unknown");
  assert.equal(highKey?.group, "pool");
  assert.equal(highKey?.remainingPercent, 90);
  assert.equal(added.view.activeKeyId, overlayKey?.keyId);
  const settingsView = await settings.getView();
  const access = settingsView.providers[0]?.personalConfig?.access;
  assert.equal(access && "apiKey" in access ? access.apiKey : null, overlay);
  assert.notEqual(lastOverlayApiKey(overlayWrites), "sk-test-pool-highquota");
});

test("exhausted current key auto-switches overlay to the highest remaining pool key", async () => {
  const { settings, overlayWrites } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => {
      if (secret.includes("spent")) return [poolUsage(100, "rate-limited")];
      if (secret.includes("mid")) return [poolUsage(60)];
      return [poolUsage(10)];
    },
  });
  const added = await service.addKeys(
    PROVIDER_ID,
    "sk-test-pool-spent\nsk-test-pool-mid\nsk-test-pool-high",
  );
  const high = added.view.keys.find((item) => item.remainingPercent === 90);
  assert.equal(high?.group, "pool");
  assert.equal(added.view.activeKeyId, high?.keyId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-pool-high");
});

test("current pool key stays sticky when a higher remaining key is added later", async () => {
  const { settings, overlayWrites } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => [poolUsage(secret.includes("alpha") ? 80 : 10)],
  });
  const first = await service.addKeys(PROVIDER_ID, "sk-test-pool-alpha");
  const second = await service.addKeys(PROVIDER_ID, "sk-test-pool-beta");
  assert.equal(second.view.activeKeyId, first.view.keys[0]?.keyId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-pool-alpha");
});

test("re-probe of an exhausted current key switches overlay to a remaining pool key", async () => {
  let spentCooling = false;
  const { settings, overlayWrites } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => {
      if (secret.includes("spent") && spentCooling) return [poolUsage(100, "rate-limited")];
      return [poolUsage(secret.includes("spent") ? 40 : 20)];
    },
  });
  const spentAdd = await service.addKeys(PROVIDER_ID, "sk-test-pool-spent");
  const liveAdd = await service.addKeys(PROVIDER_ID, "sk-test-pool-live");
  const spentId = spentAdd.view.keys[0]?.keyId;
  const liveId = liveAdd.view.keys.find((item) => item.keyId !== spentId)?.keyId;
  assert.equal(liveAdd.view.activeKeyId, spentId);
  const selected = await service.selectActiveKey(PROVIDER_ID, spentId!);
  assert.equal(selected.activeKeyId, spentId);
  spentCooling = true;
  const probed = await service.probeKeys(PROVIDER_ID, [spentId!]);
  assert.equal(probed.activeKeyId, liveId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-pool-live");
});

test("selectActiveKey switches overlay to the requested pool key and rejects cooling keys", async () => {
  const { settings, overlayWrites } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => {
      if (secret.includes("spent")) return [poolUsage(100, "rate-limited")];
      return [poolUsage(secret.includes("alpha") ? 80 : 10)];
    },
  });
  const added = await service.addKeys(
    PROVIDER_ID,
    "sk-test-pool-alpha\nsk-test-pool-beta\nsk-test-pool-spent",
  );
  const alpha = added.view.keys.find((item) => item.remainingPercent === 20);
  const beta = added.view.keys.find((item) => item.remainingPercent === 90);
  const spent = added.view.keys.find((item) => item.group === "cooling");
  const selected = await service.selectActiveKey(PROVIDER_ID, beta!.keyId);
  assert.equal(selected.activeKeyId, beta?.keyId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-pool-beta");
  await assert.rejects(() => service.selectActiveKey(PROVIDER_ID, spent!.keyId));
  const still = await service.getView(PROVIDER_ID);
  assert.equal(still.activeKeyId, beta?.keyId);
  assert.equal(alpha?.group, "pool");
});

test("cooling-only pool clears the runtime overlay instead of projecting a spent key", async () => {
  const { settings, overlayWrites } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [poolUsage(100, "rate-limited")],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-spent");
  assert.equal(added.view.activeKeyId, null);
  assert.equal(lastOverlayApiKey(overlayWrites), null);
});

test("noteRequestFailure 403 switches overlay to another pool key without invalidating the current key", async () => {
  const { settings, overlayWrites } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => [poolUsage(secret.includes("alpha") ? 20 : 10)],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-alpha\nsk-test-pool-beta");
  const alpha = added.view.keys.find((item) => item.remainingPercent === 80);
  const beta = added.view.keys.find((item) => item.remainingPercent === 90);
  await service.selectActiveKey(PROVIDER_ID, alpha!.keyId);
  const after = await service.noteRequestFailure(PROVIDER_ID, 403);
  const stillAlpha = after.keys.find((item) => item.keyId === alpha?.keyId);
  assert.equal(stillAlpha?.group, "pool");
  assert.equal(after.activeKeyId, beta?.keyId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-pool-beta");
});

test("noteRequestFailure 403 keeps the only remaining pool overlay instead of clearing it", async () => {
  const { settings, overlayWrites } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [poolUsage(10)],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-only");
  const after = await service.noteRequestFailure(PROVIDER_ID, 403);
  assert.equal(after.activeKeyId, added.view.keys[0]?.keyId);
  assert.equal(after.keys[0]?.group, "pool");
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-pool-only");
});

test("noteRequestFailure 401 invalidates the current key and switches overlay to another pool key", async () => {
  const { settings, overlayWrites } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => [poolUsage(secret.includes("alpha") ? 20 : 10)],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-alpha\nsk-test-pool-beta");
  const alpha = added.view.keys.find((item) => item.remainingPercent === 80);
  const beta = added.view.keys.find((item) => item.remainingPercent === 90);
  await service.selectActiveKey(PROVIDER_ID, alpha!.keyId);
  const after = await service.noteRequestFailure(PROVIDER_ID, 401);
  assert.equal(after.keys.find((item) => item.keyId === alpha?.keyId)?.group, "invalid");
  assert.equal(after.activeKeyId, beta?.keyId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-pool-beta");
});

test("noteRequestFailure 500 does not rotate the current pool key", async () => {
  const { settings, overlayWrites } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => [poolUsage(secret.includes("alpha") ? 20 : 10)],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-alpha\nsk-test-pool-beta");
  const alpha = added.view.keys.find((item) => item.remainingPercent === 80);
  await service.selectActiveKey(PROVIDER_ID, alpha!.keyId);
  const after = await service.noteRequestFailure(PROVIDER_ID, 500);
  assert.equal(after.activeKeyId, alpha?.keyId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-pool-alpha");
});

test("queried usage projects 5-hour, weekly, and monthly windows", async () => {
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [poolUsage(20)],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-windows");
  const key = added.view.keys[0];
  assert.equal(key?.remainingPercent, 80);
  assert.deepEqual(
    key?.windows.map((window) => ({
      window: window.window,
      usedPercent: window.usedPercent,
      status: window.status,
    })),
    [
      { window: "rolling", usedPercent: 20, status: "ok" },
      { window: "weekly", usedPercent: 20, status: "ok" },
      { window: "monthly", usedPercent: 10, status: "ok" },
    ],
  );
  assert.equal(key?.windows[0]?.resetsAt, Date.parse("2026-09-21T12:00:00.000Z"));
  assert.equal(key?.membership.state, "active");
  assert.equal(key?.membership.renewsAt, null);
});

test("a missing usage window is omitted and the other windows stay", async () => {
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [
      {
        kind: "http" as const,
        urlKind: "usage" as const,
        status: 200,
        json: {
          usage: {
            rolling: { status: "ok", percent: 4, resetsAt: "2026-09-21T16:00:00.000Z" },
            weekly: { status: "ok", percent: 3, resetsAt: "2026-09-28T00:00:00.000Z" },
          },
        },
      },
    ],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-partial");
  assert.deepEqual(
    added.view.keys[0]?.windows.map((window) => window.window),
    ["rolling", "weekly"],
  );
  assert.equal(added.view.keys[0]?.remainingPercent, 96);
});

test("getView keeps the overlay key when Go usage returns 403", async () => {
  const overlay = "sk-test-overlay-m5yp";
  const { settings, overlayWrites } = createSettings(overlay);
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => {
      if (secret === overlay) {
        return [
          {
            kind: "http" as const,
            urlKind: "usage" as const,
            status: 403,
            json: { error: { message: "RegionError" } },
          },
        ];
      }
      return [poolUsage(10)];
    },
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-highquota");
  const overlayKey = added.view.keys.find((item) => item.maskedKey.endsWith("m5yp"));
  assert.equal(added.view.activeKeyId, overlayKey?.keyId);
  const viewed = await service.getView(PROVIDER_ID);
  const overlayAfter = viewed.keys.find((item) => item.keyId === overlayKey?.keyId);
  assert.equal(overlayAfter?.group, "unknown");
  assert.equal(viewed.activeKeyId, overlayKey?.keyId);
  assert.notEqual(lastOverlayApiKey(overlayWrites), "sk-test-pool-highquota");
});

test("noteRequestFailure 403 keeps an unprobed overlay instead of clearing it", async () => {
  const overlay = "sk-test-overlay-only";
  const { settings, overlayWrites } = createSettings(overlay);
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => {
      throw new Error("quota endpoint unavailable");
    },
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-unprobed");
  const overlayKey = added.view.keys.find((item) => item.maskedKey.endsWith("only"));
  assert.equal(overlayKey?.group, "unknown");
  assert.equal(added.view.activeKeyId, overlayKey?.keyId);
  const after = await service.noteRequestFailure(PROVIDER_ID, 403);
  assert.equal(after.activeKeyId, overlayKey?.keyId);
  assert.equal(after.keys.find((item) => item.keyId === overlayKey?.keyId)?.group, "unknown");
  const settingsView = await settings.getView();
  const access = settingsView.providers[0]?.personalConfig?.access;
  assert.equal(access && "apiKey" in access ? access.apiKey : null, overlay);
  const written = lastOverlayApiKey(overlayWrites);
  if (written !== null) assert.equal(written, overlay);
});

test("EntitlementError expires the key and moves overlay to a membership that is still active", async () => {
  const overlay = "sk-test-overlay-ended";
  const { settings, overlayWrites } = createSettings(overlay);
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => {
      if (secret === overlay) {
        return [
          {
            kind: "http" as const,
            urlKind: "usage" as const,
            status: 403,
            json: {
              type: "error",
              error: { type: "EntitlementError", message: "OpenCode Go subscription required." },
            },
          },
        ];
      }
      return [poolUsage(10)];
    },
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-live");
  const viewed = await service.getView(PROVIDER_ID);
  const ended = viewed.keys.find((item) => item.maskedKey.endsWith("nded"));
  const live = viewed.keys.find((item) => item.maskedKey.endsWith("live"));
  assert.equal(ended?.group, "expired");
  assert.equal(ended?.membership.state, "inactive");
  assert.equal(ended?.membership.renewsAt, null);
  assert.equal(live?.membership.state, "active");
  assert.equal(viewed.activeKeyId, live?.keyId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-pool-live");
  assert.equal(added.view.activeKeyId, ended?.keyId);
});

test("a later quota probe without endsAt clears a prior console stamp", async () => {
  const expiresAt = "2026-10-14T08:18:34.000Z";
  let includeExpiry = true;
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [
      {
        kind: "http" as const,
        urlKind: "usage" as const,
        status: 200,
        json: includeExpiry
          ? {
              renewalAuthorizationRequired: true,
              access: { endsAt: expiresAt },
              usage: {
                rolling: { status: "ok", percent: 0, resetsAt: "2026-09-22T09:00:00.000Z" },
                weekly: { status: "ok", percent: 0, resetsAt: "2026-09-28T00:00:00.000Z" },
                monthly: { status: "ok", percent: 23, resetsAt: "2026-09-22T11:32:00.000Z" },
              },
            }
          : {
              usage: {
                rolling: { status: "ok", percent: 4, resetsAt: "2026-09-22T10:00:00.000Z" },
                weekly: { status: "ok", percent: 3, resetsAt: "2026-09-28T00:00:00.000Z" },
                monthly: { status: "ok", percent: 20, resetsAt: "2026-09-22T12:00:00.000Z" },
              },
            },
      },
    ],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-member");
  assert.equal(added.view.keys[0]?.membership.renewsAt, Date.parse(expiresAt));
  assert.equal(added.view.keys[0]?.membership.renewalAuthorizationRequired, true);
  includeExpiry = false;
  const probed = await service.probeKeys(PROVIDER_ID, [added.view.keys[0]!.keyId]);
  // 官方 /usage 没有 endsAt；不得把控制台 cookie 会话的日期继续挂在这把 Key 上。
  assert.equal(probed.keys[0]?.membership.renewsAt, null);
  assert.equal(probed.keys[0]?.membership.renewalAuthorizationRequired, false);
  assert.equal(probed.keys[0]?.remainingPercent, 80);
});

test("addKeys stores the #label and projects it without the secret", async () => {
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [poolUsage(10)],
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-named#admin");
  assert.equal(added.view.keys[0]?.label, "admin");
  assert.equal(JSON.stringify(added.view).includes("sk-test-pool-named"), false);
});

test("keys keep distinct access.endsAt values from their own probes", async () => {
  const firstEndsAt = "2026-10-01T00:00:00.000Z";
  const secondEndsAt = "2026-11-15T12:00:00.000Z";
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => {
      const endsAt = secret.includes("first") ? firstEndsAt : secondEndsAt;
      return [
        {
          kind: "http" as const,
          urlKind: "usage" as const,
          status: 200,
          json: {
            access: { endsAt },
            usage: {
              rolling: { status: "ok", percent: 1, resetsAt: "2026-09-22T09:00:00.000Z" },
              weekly: { status: "ok", percent: 2, resetsAt: "2026-09-28T00:00:00.000Z" },
              monthly: { status: "ok", percent: 3, resetsAt: "2026-09-22T11:32:00.000Z" },
            },
          },
        },
      ];
    },
  });
  const added = await service.addKeys(PROVIDER_ID, "sk-test-pool-first\nsk-test-pool-second");
  const first = added.view.keys.find((item) => item.maskedKey.endsWith("irst"));
  const second = added.view.keys.find((item) => item.maskedKey.endsWith("cond"));
  assert.equal(first?.membership.renewsAt, Date.parse(firstEndsAt));
  assert.equal(second?.membership.renewsAt, Date.parse(secondEndsAt));
  assert.notEqual(first?.membership.renewsAt, second?.membership.renewsAt);
});

test("a shared stamp is not applied to a key whose probe omitted endsAt", async () => {
  const sharedStamp = "2026-10-14T08:18:34.000Z";
  const { settings } = createSettings();
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ secret }) => {
      if (secret.endsWith("aaaa")) {
        return [
          {
            kind: "http" as const,
            urlKind: "usage" as const,
            status: 200,
            json: {
              renewalAuthorizationRequired: true,
              access: { endsAt: sharedStamp },
              usage: {
                rolling: { status: "ok", percent: 1, resetsAt: "2026-09-22T09:00:00.000Z" },
                weekly: { status: "ok", percent: 1, resetsAt: "2026-09-28T00:00:00.000Z" },
                monthly: { status: "ok", percent: 1, resetsAt: "2026-09-22T11:32:00.000Z" },
              },
            },
          },
        ];
      }
      return [
        {
          kind: "http" as const,
          urlKind: "usage" as const,
          status: 200,
          json: {
            usage: {
              rolling: { status: "ok", percent: 5, resetsAt: "2026-09-22T09:00:00.000Z" },
              weekly: { status: "ok", percent: 5, resetsAt: "2026-09-28T00:00:00.000Z" },
              monthly: { status: "ok", percent: 5, resetsAt: "2026-09-22T11:32:00.000Z" },
            },
          },
        },
      ];
    },
  });
  const added = await service.addKeys(
    PROVIDER_ID,
    "sk-test-pool-stamp-aaaa\nsk-test-pool-plain-bbbb",
  );
  const stamped = added.view.keys.find((item) => item.maskedKey.endsWith("aaaa"));
  const plain = added.view.keys.find((item) => item.maskedKey.endsWith("bbbb"));
  assert.equal(stamped?.membership.renewsAt, Date.parse(sharedStamp));
  assert.equal(stamped?.membership.renewalAuthorizationRequired, true);
  assert.equal(plain?.membership.renewsAt, null);
  assert.equal(plain?.membership.renewalAuthorizationRequired, false);
});

function createGenericSettingsView(input: {
  readonly providerId: string;
  readonly templateId: string | null;
  readonly baseUrl: string;
  readonly apiKey?: string;
}): ProviderSettingsView {
  const access = { type: "api-key" as const, apiKey: input.apiKey || null };
  const api = {
    type: "openai-chat-completions" as const,
    baseUrl: input.baseUrl,
  };
  return {
    revision: 1,
    providerTemplates: [],
    providerOrder: [input.providerId],
    providers: [
      {
        providerId: input.providerId,
        templateId: input.templateId,
        providerName: input.templateId ?? "Custom",
        enabled: true,
        executable: true,
        personalConfig: { access, api },
        effectiveConfig: { access, api, group: "standard-personal" },
        issues: [],
        models: [],
      },
    ],
  };
}

function createGenericSettings(input: {
  readonly providerId: string;
  readonly templateId: string | null;
  readonly baseUrl: string;
  readonly apiKey?: string;
}) {
  let view = createGenericSettingsView(input);
  const overlayWrites: unknown[] = [];
  const settings = {
    async getView() {
      return view;
    },
    async savePersonalProviderOverlay(providerId: string, config: unknown) {
      overlayWrites.push({ providerId, config });
      const nextKey =
        typeof config === "object" &&
        config !== null &&
        "access" in config &&
        typeof (config as { access?: { apiKey?: string } }).access?.apiKey === "string"
          ? (config as { access: { apiKey: string } }).access.apiKey
          : "";
      view = createGenericSettingsView({ ...input, apiKey: nextKey });
      return view;
    },
  } satisfies Pick<IProviderSettingsService, "getView" | "savePersonalProviderOverlay">;
  return { settings, overlayWrites };
}

function modelsOk(): OpenCodeKeyProbeAttempt {
  return { kind: "http", urlKind: "models", status: 200, json: { data: [] } };
}

test("openai template is supported with models probe and no invented usage windows", async () => {
  const providerId = "personal-openai";
  const { settings } = createGenericSettings({
    providerId,
    templateId: "openai",
    baseUrl: "https://api.openai.com/v1",
  });
  const probedFamilies: Array<string | null> = [];
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ family }) => {
      probedFamilies.push(family);
      return [modelsOk()];
    },
  });
  const result = await service.addKeys(providerId, "sk-test-openai-alpha");
  assert.equal(result.view.supported, true);
  assert.equal(result.view.family, null);
  assert.equal(result.view.quotaQuery, "channel");
  assert.equal(result.view.keys[0]?.group, "pool");
  assert.equal(result.view.keys[0]?.remainingPercent, null);
  assert.deepEqual(result.view.keys[0]?.windows, []);
  assert.deepEqual(probedFamilies, [null]);
});

test("custom standard-personal provider without templateId uses the unified pool", async () => {
  const providerId = "personal-custom";
  const { settings } = createGenericSettings({
    providerId,
    templateId: null,
    baseUrl: "https://example.com/v1",
  });
  let probeCalls = 0;
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => {
      probeCalls += 1;
      return [modelsOk()];
    },
  });
  const result = await service.addKeys(providerId, "sk-test-custom-alpha");
  assert.equal(result.view.supported, true);
  assert.equal(result.view.family, null);
  assert.equal(result.view.quotaQuery, "none");
  assert.equal(result.view.keys[0]?.group, "pool");
  assert.equal(probeCalls, 0);
});

test("custom getView promotes stored unknown keys to pool without probing", async () => {
  const providerId = "personal-custom-unknown";
  const credentials = createMemoryCredentials();
  await credentials.save(
    `provider-api-key-pool:${providerId}`,
    JSON.stringify({
      version: 1,
      activeKeyId: "deadbeefdeadbeef",
      keys: [
        {
          keyId: "deadbeefdeadbeef",
          secret: "sk-test-custom-unknown",
          addedAt: 1,
          lastCheckedAt: 2,
          group: "unknown",
          remainingPercent: null,
          resetAt: null,
          availableAt: null,
          probeError: "http",
          label: null,
        },
      ],
    }),
  );
  const { settings } = createGenericSettings({
    providerId,
    templateId: null,
    baseUrl: "https://example.com/v1",
  });
  let probeCalls = 0;
  const service = createProviderApiKeyPoolService({
    credentialService: credentials,
    providerSettings: settings,
    probe: async () => {
      probeCalls += 1;
      return [modelsOk()];
    },
  });
  const view = await service.getView(providerId);
  assert.equal(view.quotaQuery, "none");
  assert.equal(view.keys[0]?.group, "pool");
  assert.equal(view.keys[0]?.probeError, null);
  assert.equal(view.keys[0]?.lastCheckedAt, null);
  assert.equal(probeCalls, 0);
});

test("OpenCode addKeys still probes with an OpenCode usage family", async () => {
  const { settings } = createSettings();
  const probedFamilies: Array<string | null> = [];
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ family }) => {
      probedFamilies.push(family);
      return [poolUsage(12)];
    },
  });
  const result = await service.addKeys(PROVIDER_ID, "sk-test-pool-go-usage");
  assert.equal(result.view.family, "opencode-go");
  assert.equal(result.view.quotaQuery, "opencode");
  assert.equal(result.view.keys[0]?.group, "pool");
  assert.equal(result.view.keys[0]?.windows.length, 3);
  assert.deepEqual(probedFamilies, ["opencode-go"]);
});

test("non-OpenCode addKeys does not clobber an existing overlay", async () => {
  const providerId = "personal-openai";
  const overlay = "sk-test-openai-overlay";
  const { settings, overlayWrites } = createGenericSettings({
    providerId,
    templateId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: overlay,
  });
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [modelsOk()],
  });
  const added = await service.addKeys(providerId, "sk-test-openai-extra");
  const overlayKey = added.view.keys.find((item) => item.maskedKey.endsWith("rlay"));
  assert.ok(overlayKey);
  assert.equal(added.view.activeKeyId, overlayKey?.keyId);
  assert.notEqual(lastOverlayApiKey(overlayWrites), "sk-test-openai-extra");
});

test("non-OpenCode noteRequestFailure 429 switches overlay to another pool key", async () => {
  const providerId = "personal-openai";
  const { settings, overlayWrites } = createGenericSettings({
    providerId,
    templateId: "openai",
    baseUrl: "https://api.openai.com/v1",
  });
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [modelsOk()],
  });
  const added = await service.addKeys(providerId, "sk-test-openai-first\nsk-test-openai-second");
  const firstId = added.view.keys[0]?.keyId;
  const secondId = added.view.keys[1]?.keyId;
  assert.equal(added.view.activeKeyId, firstId);
  const after = await service.noteRequestFailure(providerId, 429);
  assert.equal(after.keys.find((item) => item.keyId === firstId)?.group, "cooling");
  assert.equal(after.activeKeyId, secondId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-openai-second");
});

function balanceBody(credits: number): OpenCodeKeyProbeAttempt {
  return {
    kind: "http",
    urlKind: "balance",
    status: 200,
    json: {
      success: true,
      data: { api_key_type: "personal", personal_balance: credits },
    },
  };
}

test("api.b.ai addKeys queries balance and groups a zero-credit key as exhausted", async () => {
  const providerId = "personal-bai";
  const { settings, overlayWrites } = createGenericSettings({
    providerId,
    templateId: null,
    baseUrl: "https://api.b.ai/v1/chat/completions",
  });
  const probed: Array<string | null> = [];
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ family, quotaQuery, secret }) => {
      probed.push(quotaQuery);
      assert.equal(family, null);
      return [balanceBody(secret.includes("spent") ? 0 : 80)];
    },
  });
  const added = await service.addKeys(providerId, "sk-test-bai-spent\nsk-test-bai-live");
  const spent = added.view.keys.find((item) => item.maskedKey.endsWith("pent"));
  const live = added.view.keys.find((item) => item.maskedKey.endsWith("live"));
  assert.equal(added.view.quotaQuery, "balance");
  assert.equal(added.view.family, null);
  assert.deepEqual(probed, ["balance", "balance"]);
  assert.equal(spent?.group, "exhausted");
  assert.equal(spent?.balance?.credits, 0);
  assert.deepEqual(spent?.windows, []);
  assert.equal(live?.group, "pool");
  assert.equal(live?.balance?.credits, 80);
  assert.equal(added.view.activeKeyId, live?.keyId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-bai-live");
});

test("balance 403 re-probe moves a spent key out and switches to a funded key", async () => {
  const providerId = "personal-bai-switch";
  const { settings, overlayWrites } = createGenericSettings({
    providerId,
    templateId: "openai",
    baseUrl: "https://api.b.ai/v1",
  });
  let failCurrent = false;
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async ({ quotaQuery, secret }) => {
      assert.equal(quotaQuery, "balance");
      const credits = failCurrent && secret.includes("alpha") ? 0 : 40;
      return [balanceBody(credits)];
    },
  });
  const added = await service.addKeys(providerId, "sk-test-bai-alpha\nsk-test-bai-beta");
  const alpha = added.view.keys.find((item) => item.maskedKey.endsWith("lpha"));
  const beta = added.view.keys.find((item) => item.maskedKey.endsWith("beta"));
  assert.equal(added.view.quotaQuery, "balance");
  await service.selectActiveKey(providerId, alpha!.keyId);
  failCurrent = true;
  const after = await service.noteRequestFailure(providerId, 403);
  assert.equal(after.keys.find((item) => item.keyId === alpha?.keyId)?.group, "exhausted");
  assert.equal(after.keys.find((item) => item.keyId === beta?.keyId)?.group, "pool");
  assert.equal(after.activeKeyId, beta?.keyId);
  assert.equal(lastOverlayApiKey(overlayWrites), "sk-test-bai-beta");
});

test("balance 403 with remaining credits keeps the key in the pool", async () => {
  const providerId = "personal-bai-region";
  const { settings } = createGenericSettings({
    providerId,
    templateId: null,
    baseUrl: "https://api.b.ai",
  });
  const service = createProviderApiKeyPoolService({
    credentialService: createMemoryCredentials(),
    providerSettings: settings,
    probe: async () => [balanceBody(15)],
  });
  const added = await service.addKeys(providerId, "sk-test-bai-only");
  const after = await service.noteRequestFailure(providerId, 403);
  assert.equal(after.keys[0]?.group, "pool");
  assert.equal(after.keys[0]?.balance?.credits, 15);
  assert.equal(after.activeKeyId, added.view.keys[0]?.keyId);
});
