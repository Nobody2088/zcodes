import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOpenCodeKeyProbe,
  deriveRemainingMs,
  maskApiKey,
  parseBatchApiKeys,
  parseOpenCodeGoUsage,
  parsePooledRequestFailureStatus,
  readPooledRequestFailureFromTurnError,
  resolveActiveApiKeyId,
  hasLeftApiKeyPool,
  resolveBalanceQuotaUrl,
  resolveOpenCodeApiKeyPoolFamily,
  resolveProviderApiKeyPoolQuotaQuery,
  shouldReprobeCoolingKey,
  supportsProviderApiKeyPool,
} from "../src/model-provider/providerApiKeyPool.js";
import { probeProviderApiKey } from "../src/model-provider/providerApiKeyPoolProbe.js";
import { resolveRemoteModelCatalogUrl } from "../src/model-provider/providerRemoteModelCatalog.js";

const EXISTING = new Set(["sk-test-existing-key"]);

test("parses batch lines: trim, skip empty, dedupe, report invalid", () => {
  const result = parseBatchApiKeys(
    "  sk-test-new-key-one  \n\nsk-test-existing-key\nsk-test-new-key-one\nbad key\nshort\n",
    EXISTING,
  );
  assert.deepEqual(result.added, [{ secret: "sk-test-new-key-one", label: null }]);
  assert.deepEqual(result.duplicate, ["sk-test-existing-key", "sk-test-new-key-one"]);
  assert.deepEqual(result.invalid, ["bad key", "short"]);
  assert.equal(result.skippedEmpty, 1);
});

test("parses a #label after the key and ignores the label when deduping", () => {
  const result = parseBatchApiKeys(
    "sk-test-labeled-key#admin\nsk-test-labeled-key#other\nsk-test-spaced#  my name  \nsk-test-bare#\n",
    new Set(["sk-test-labeled-key"]),
  );
  assert.deepEqual(result.duplicate, ["sk-test-labeled-key", "sk-test-labeled-key"]);
  assert.deepEqual(result.added, [
    { secret: "sk-test-spaced", label: "my name" },
    { secret: "sk-test-bare", label: null },
  ]);
});

test("masks keys with prefix and suffix and never returns the full secret", () => {
  const secret = "sk-test-abcdef123456";
  const masked = maskApiKey(secret);
  assert.equal(masked.startsWith("sk-t"), true);
  assert.equal(masked.endsWith("3456"), true);
  assert.equal(masked.includes(secret), false);
  assert.equal(maskApiKey("abcd"), "••••");
});

test("OpenCode Go and Zen template ids resolve usage families; other templates stay null", () => {
  assert.equal(resolveOpenCodeApiKeyPoolFamily("opencode-go-chat"), "opencode-go");
  assert.equal(resolveOpenCodeApiKeyPoolFamily("opencode-go-messages"), "opencode-go");
  assert.equal(resolveOpenCodeApiKeyPoolFamily("opencode-go-responses"), "opencode-go");
  assert.equal(resolveOpenCodeApiKeyPoolFamily("opencode-zen-chat"), "opencode-zen");
  assert.equal(resolveOpenCodeApiKeyPoolFamily("opencode-zen-messages"), "opencode-zen");
  assert.equal(resolveOpenCodeApiKeyPoolFamily("opencode-zen-responses"), "opencode-zen");
  assert.equal(resolveOpenCodeApiKeyPoolFamily("openrouter"), null);
  assert.equal(resolveOpenCodeApiKeyPoolFamily("zai-api"), null);
  assert.equal(resolveOpenCodeApiKeyPoolFamily("bigmodel-api"), null);
  assert.equal(resolveOpenCodeApiKeyPoolFamily("openai"), null);
  assert.equal(resolveOpenCodeApiKeyPoolFamily(null), null);
});

test("resolveProviderApiKeyPoolQuotaQuery maps OpenCode, channel, and custom templates", () => {
  assert.equal(resolveProviderApiKeyPoolQuotaQuery("opencode-go-responses"), "opencode");
  assert.equal(resolveProviderApiKeyPoolQuotaQuery("openai"), "channel");
  assert.equal(resolveProviderApiKeyPoolQuotaQuery(null), "none");
  assert.equal(resolveProviderApiKeyPoolQuotaQuery(""), "none");
});

test("balance hosts are detected by hostname and OpenCode templates stay on usage", () => {
  assert.equal(resolveBalanceQuotaUrl("https://api.b.ai/v1"), "https://api.b.ai/v1/balance");
  assert.equal(resolveBalanceQuotaUrl("https://api.b.ai"), "https://api.b.ai/v1/balance");
  assert.equal(
    resolveBalanceQuotaUrl("https://api.b.ai/v1/chat/completions"),
    "https://api.b.ai/v1/balance",
  );
  assert.equal(resolveBalanceQuotaUrl("https://api.b.ai.example.com/v1"), null);
  assert.equal(resolveBalanceQuotaUrl("not a url"), null);
  assert.equal(
    resolveProviderApiKeyPoolQuotaQuery("opencode-go-responses", "https://api.b.ai/v1"),
    "opencode",
  );
  assert.equal(
    resolveProviderApiKeyPoolQuotaQuery(null, "https://api.b.ai/v1/chat/completions"),
    "balance",
  );
  assert.equal(
    resolveProviderApiKeyPoolQuotaQuery("openai", "https://api.b.ai/v1"),
    "balance",
  );
  assert.equal(resolveProviderApiKeyPoolQuotaQuery(null, "https://example.com/v1"), "none");
  assert.equal(
    resolveProviderApiKeyPoolQuotaQuery("openai", "https://api.openai.com/v1"),
    "channel",
  );
});

test("personal balance of zero is exhausted and is not reprobed as cooling", () => {
  const classified = classifyOpenCodeKeyProbe({
    family: null,
    quotaQuery: "balance",
    probes: [
      {
        kind: "http",
        urlKind: "balance",
        status: 200,
        json: {
          success: true,
          data: { api_key_type: "personal", personal_balance: 0 },
        },
      },
    ],
  });
  assert.equal(classified.group, "exhausted");
  assert.equal(classified.remainingPercent, 0);
  assert.equal(classified.balance?.credits, 0);
  assert.equal(classified.windows, undefined);
  assert.equal(classified.availableAt, null);
  assert.equal(hasLeftApiKeyPool("exhausted"), true);
  assert.equal(
    shouldReprobeCoolingKey({ group: "exhausted", availableAt: 1 }, 10_000),
    false,
  );
});

test("positive personal balance stays in the pool without usage windows", () => {
  const classified = classifyOpenCodeKeyProbe({
    family: null,
    quotaQuery: "balance",
    probes: [
      {
        kind: "http",
        urlKind: "balance",
        status: 200,
        json: {
          success: true,
          data: { api_key_type: "personal", personal_balance: 12 },
        },
      },
    ],
  });
  assert.equal(classified.group, "pool");
  assert.equal(classified.remainingPercent, null);
  assert.equal(classified.balance?.credits, 12);
  assert.equal(classified.windows, undefined);
});

test("team limited quota uses remaining credits and reset time", () => {
  const resetAt = "2026-10-01T00:00:00.000Z";
  const classified = classifyOpenCodeKeyProbe({
    family: null,
    quotaQuery: "balance",
    probes: [
      {
        kind: "http",
        urlKind: "balance",
        status: 200,
        json: {
          success: true,
          data: {
            api_key_type: "team",
            quota_limit_type: "limited",
            member_quota_limit: 100,
            member_quota_used: 100,
            quota_reset_at: resetAt,
          },
        },
      },
    ],
  });
  assert.equal(classified.group, "cooling");
  assert.equal(classified.balance?.credits, 0);
  assert.equal(classified.availableAt, Date.parse(resetAt));
  assert.equal(classified.remainingPercent, 0);

  const partial = classifyOpenCodeKeyProbe({
    family: null,
    quotaQuery: "balance",
    probes: [
      {
        kind: "http",
        urlKind: "balance",
        status: 200,
        json: {
          success: true,
          data: {
            api_key_type: "team",
            quota_limit_type: "limited",
            member_quota_limit: 100,
            member_quota_used: 25,
          },
        },
      },
    ],
  });
  assert.equal(partial.group, "pool");
  assert.equal(partial.balance?.credits, 75);
  assert.equal(partial.remainingPercent, 75);
  assert.equal(partial.windows, undefined);
});

test("team unlimited balance stays in the pool without a fake credit number", () => {
  const classified = classifyOpenCodeKeyProbe({
    family: null,
    quotaQuery: "balance",
    probes: [
      {
        kind: "http",
        urlKind: "balance",
        status: 200,
        json: {
          success: true,
          data: { api_key_type: "team", quota_limit_type: "unlimited" },
        },
      },
    ],
  });
  assert.equal(classified.group, "pool");
  assert.equal(classified.balance?.credits, null);
  assert.equal(classified.remainingPercent, null);
  assert.equal(classified.windows, undefined);
});

test("balance success false keeps the previous group", () => {
  const classified = classifyOpenCodeKeyProbe({
    family: null,
    quotaQuery: "balance",
    previousGroup: "pool",
    previousRemainingPercent: null,
    probes: [
      {
        kind: "http",
        urlKind: "balance",
        status: 200,
        json: { success: false, message: "unavailable" },
      },
    ],
  });
  assert.equal(classified.group, "pool");
  assert.equal(classified.probeError, "http");
  assert.equal(classified.balance, undefined);
});

test("balance probe requests /v1/balance and OpenCode usage ignores that host", async () => {
  const requested: string[] = [];
  const fakeRequest = async (input: string | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
  };
  await probeProviderApiKey({
    family: null,
    quotaQuery: "balance",
    apiType: "openai-chat-completions",
    baseUrl: "https://api.b.ai/v1/chat/completions",
    secret: "sk-test-balance",
    request: fakeRequest,
  });
  assert.deepEqual(requested, ["https://api.b.ai/v1/balance"]);

  requested.length = 0;
  await probeProviderApiKey({
    family: "opencode-go",
    quotaQuery: "opencode",
    apiType: "openai-chat-completions",
    baseUrl: "https://api.b.ai/v1",
    secret: "sk-test-opencode-on-bai",
    request: fakeRequest,
  });
  assert.deepEqual(requested, ["https://api.b.ai/v1/usage"]);
});

test("family-null probe hits the provider models catalog and never opencode.ai", async () => {
  const requested: string[] = [];
  const fakeRequest = async (input: string | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const openaiBase = "https://api.example.com/v1";
  await probeProviderApiKey({
    family: null,
    apiType: "openai-chat-completions",
    baseUrl: openaiBase,
    secret: "sk-test-probe-openai",
    request: fakeRequest,
  });
  assert.deepEqual(requested, [`${openaiBase}/models`]);
  assert.equal(
    requested.some((url) => url.includes("opencode.ai")),
    false,
  );

  requested.length = 0;
  const anthropicBase = "https://api.example.com";
  const anthropicCatalog = resolveRemoteModelCatalogUrl("anthropic-messages", anthropicBase);
  await probeProviderApiKey({
    family: null,
    apiType: "anthropic-messages",
    baseUrl: anthropicBase,
    secret: "sk-test-probe-anthropic",
    request: fakeRequest,
  });
  assert.deepEqual(requested, [anthropicCatalog]);
  assert.equal(anthropicCatalog, "https://api.example.com/v1/models");
  assert.equal(
    requested.some((url) => url.includes("opencode.ai")),
    false,
  );
});

test("api-key access supports the unified pool; account coding plan does not", () => {
  assert.equal(supportsProviderApiKeyPool({ type: "api-key" }), true);
  assert.equal(supportsProviderApiKeyPool({ type: "zhipu-coding-plan-api-key" }), true);
  assert.equal(supportsProviderApiKeyPool({ type: "zhipu-account" }), false);
  assert.equal(supportsProviderApiKeyPool(null), false);
});

test("generic family null with models 200 enters pool without inventing usage windows", () => {
  const classified = classifyOpenCodeKeyProbe({
    family: null,
    probes: [{ kind: "http", urlKind: "models", status: 200, json: { data: [] } }],
  });
  assert.equal(classified.group, "pool");
  assert.equal(classified.remainingPercent, null);
  assert.equal(classified.windows, undefined);
});

test("generic family null with empty probes admits to pool until request failure", () => {
  const classified = classifyOpenCodeKeyProbe({
    family: null,
    probes: [],
  });
  assert.equal(classified.group, "pool");
  assert.equal(classified.remainingPercent, null);
});

test("Go usage with remaining quota groups into pool", () => {
  const parsed = parseOpenCodeGoUsage({
    usage: {
      rolling: { status: "ok", percent: 20, resetsAt: "2026-09-21T10:00:00.000Z" },
      weekly: { status: "ok", percent: 40, resetsAt: "2026-09-28T00:00:00.000Z" },
      monthly: { status: "ok", percent: 10, resetsAt: "2026-10-01T00:00:00.000Z" },
    },
  });
  assert.equal(parsed?.group, "pool");
  assert.equal(parsed?.remainingPercent, 60);
  assert.equal(parsed?.availableAt, null);
  assert.equal(parsed?.windows.rolling?.percent, 20);
  assert.equal(parsed?.windows.weekly?.percent, 40);
  assert.equal(parsed?.windows.monthly?.percent, 10);
  assert.equal(parsed?.windows.rolling?.resetsAt, Date.parse("2026-09-21T10:00:00.000Z"));
  assert.equal(parsed?.membership.state, "active");
  assert.equal(parsed?.membership.renewsAt, null);
});

test("usage probe does not invent renewsAt from monthly resetsAt", () => {
  const monthlyReset = "2026-09-22T11:32:00.000Z";
  const parsed = parseOpenCodeGoUsage({
    usage: {
      rolling: { status: "ok", percent: 1, resetsAt: "2026-09-22T09:00:00.000Z" },
      weekly: { status: "ok", percent: 2, resetsAt: "2026-09-28T00:00:00.000Z" },
      monthly: { status: "ok", percent: 3, resetsAt: monthlyReset },
    },
  });
  assert.equal(parsed?.membership.state, "active");
  assert.equal(parsed?.membership.renewsAt, null);
  assert.equal(parsed?.windows.monthly?.resetsAt, Date.parse(monthlyReset));
  assert.notEqual(parsed?.membership.renewsAt, parsed?.windows.monthly?.resetsAt);
});

test("subscription renewsAt is the membership date and monthly reset is not", () => {
  const parsed = parseOpenCodeGoUsage({
    usage: {
      rolling: { status: "ok", percent: 1, resetsAt: "2026-09-22T09:00:00.000Z" },
      weekly: { status: "ok", percent: 2, resetsAt: "2026-09-28T00:00:00.000Z" },
      monthly: { status: "ok", percent: 3, resetsAt: "2026-09-22T11:32:00.000Z" },
    },
    subscription: { renewsAt: "2026-10-14T08:00:00.000Z" },
  });
  assert.equal(parsed?.membership.renewsAt, Date.parse("2026-10-14T08:00:00.000Z"));
  assert.notEqual(parsed?.membership.renewsAt, parsed?.windows.monthly?.resetsAt);
});

test("console go status access.endsAt is the membership expiry", () => {
  const parsed = parseOpenCodeGoUsage({
    renewalAuthorizationRequired: true,
    access: { endsAt: "2026-10-14T08:18:34.000Z" },
    usage: {
      rolling: { status: "ok", percent: 0, resetsAt: "2026-09-22T09:00:00.000Z" },
      weekly: { status: "ok", percent: 0, resetsAt: "2026-09-28T00:00:00.000Z" },
      monthly: { status: "ok", percent: 23, resetsAt: "2026-09-22T11:32:00.000Z" },
    },
  });
  assert.equal(parsed?.membership.renewsAt, Date.parse("2026-10-14T08:18:34.000Z"));
  assert.equal(parsed?.membership.renewalAuthorizationRequired, true);
  assert.notEqual(parsed?.membership.renewsAt, parsed?.windows.monthly?.resetsAt);
});

test("Go usage with exhausted window groups into cooling and keeps resetAt", () => {
  const parsed = parseOpenCodeGoUsage({
    usage: {
      rolling: {
        status: "rate-limited",
        percent: 100,
        resetsAt: "2026-09-21T12:00:00.000Z",
      },
      weekly: { status: "ok", percent: 50, resetsAt: "2026-09-28T00:00:00.000Z" },
      monthly: { status: "ok", percent: 20, resetsAt: "2026-10-01T00:00:00.000Z" },
    },
  });
  assert.equal(parsed?.group, "cooling");
  assert.equal(parsed?.remainingPercent, 0);
  assert.equal(parsed?.availableAt, Date.parse("2026-09-21T12:00:00.000Z"));
  assert.equal(parsed?.resetAt, Date.parse("2026-09-21T12:00:00.000Z"));
});

test("UI remainingMs is derived from availableAt, not a timer", () => {
  const availableAt = 1_000_000;
  assert.equal(deriveRemainingMs(availableAt, 900_000), 100_000);
  assert.equal(deriveRemainingMs(availableAt, 1_000_000), 0);
  assert.equal(deriveRemainingMs(availableAt, 1_100_000), 0);
  assert.equal(deriveRemainingMs(null, 1), null);
});

test("cooling keys are re-probed when availableAt is due, then re-admitted only after a usable probe", () => {
  assert.equal(shouldReprobeCoolingKey({ group: "cooling", availableAt: 10 }, 10), true);
  assert.equal(shouldReprobeCoolingKey({ group: "cooling", availableAt: 11 }, 10), false);
  assert.equal(shouldReprobeCoolingKey({ group: "pool", availableAt: 1 }, 10), false);

  const reAdmitted = classifyOpenCodeKeyProbe({
    family: "opencode-go",
    probes: [
      {
        kind: "http",
        urlKind: "usage",
        status: 200,
        json: {
          usage: {
            rolling: { status: "ok", percent: 5, resetsAt: "2026-09-21T18:00:00.000Z" },
            weekly: { status: "ok", percent: 5, resetsAt: "2026-09-28T00:00:00.000Z" },
            monthly: { status: "ok", percent: 5, resetsAt: "2026-10-01T00:00:00.000Z" },
          },
        },
      },
    ],
    previousGroup: "cooling",
  });
  assert.equal(reAdmitted.group, "pool");
  assert.equal(reAdmitted.availableAt, null);
  assert.equal(reAdmitted.remainingPercent, 95);
});

test("expired and disappeared keys group into expired or invalid", () => {
  const expired = classifyOpenCodeKeyProbe({
    family: "opencode-go",
    probes: [
      {
        kind: "http",
        urlKind: "usage",
        status: 401,
        json: {
          type: "error",
          error: { type: "AuthError", message: "API key expired" },
        },
      },
    ],
  });
  assert.equal(expired.group, "expired");

  const gone = classifyOpenCodeKeyProbe({
    family: "opencode-go",
    probes: [
      {
        kind: "http",
        urlKind: "usage",
        status: 401,
        json: {
          type: "error",
          error: { type: "AuthError", message: "Unauthorized" },
        },
      },
    ],
  });
  assert.equal(gone.group, "invalid");
});

test("Go usage 403 keeps the previous group instead of invalidating the key", () => {
  const result = classifyOpenCodeKeyProbe({
    family: "opencode-go",
    probes: [
      {
        kind: "http",
        urlKind: "usage",
        status: 403,
        json: { error: { message: "RegionError" } },
      },
    ],
    previousGroup: "pool",
    previousRemainingPercent: 12,
  });
  assert.equal(result.group, "pool");
  assert.equal(result.remainingPercent, 12);
  assert.notEqual(result.probeError, "auth");
});

test("Go usage EntitlementError marks the membership inactive without inventing an expiry time", () => {
  const result = classifyOpenCodeKeyProbe({
    family: "opencode-go",
    probes: [
      {
        kind: "http",
        urlKind: "usage",
        status: 403,
        json: {
          type: "error",
          error: { type: "EntitlementError", message: "OpenCode Go subscription required." },
        },
      },
    ],
    previousGroup: "pool",
    previousRemainingPercent: 12,
  });
  assert.equal(result.group, "expired");
  assert.equal(result.membership?.state, "inactive");
  assert.equal(result.membership?.renewsAt, null);
});

test("Zen without Go usage still pools on a successful models probe and does not invent remaining quota", () => {
  const result = classifyOpenCodeKeyProbe({
    family: "opencode-zen",
    probes: [
      {
        kind: "http",
        urlKind: "usage",
        status: 403,
        json: {
          type: "error",
          error: { type: "EntitlementError", message: "OpenCode Go subscription required." },
        },
      },
      {
        kind: "http",
        urlKind: "models",
        status: 200,
        json: { data: [{ id: "gpt-5.4" }] },
      },
    ],
  });
  assert.equal(result.group, "pool");
  assert.equal(result.remainingPercent, null);
});

test("probe transport failure keeps previous group and does not fake remaining quota", () => {
  const result = classifyOpenCodeKeyProbe({
    family: "opencode-go",
    probes: [{ kind: "network", message: "fetch failed" }],
    previousGroup: "pool",
    previousRemainingPercent: 42,
  });
  assert.equal(result.group, "pool");
  assert.equal(result.remainingPercent, 42);
  assert.equal(result.probeError, "network");
});

test("probe transport failure keeps previous cooling availableAt instead of wiping the countdown", () => {
  const result = classifyOpenCodeKeyProbe({
    family: "opencode-go",
    probes: [{ kind: "network", message: "fetch failed" }],
    previousGroup: "cooling",
    previousRemainingPercent: 0,
    previousAvailableAt: 1_000_000,
  });
  assert.equal(result.group, "cooling");
  assert.equal(result.remainingPercent, 0);
  assert.equal(result.availableAt, 1_000_000);
  assert.equal(result.probeError, "network");
});

function poolKey(
  id: string,
  remainingPercent: number | null = 80,
): {
  id: string;
  group: "pool" | "cooling" | "expired" | "invalid";
  remainingPercent: number | null;
} {
  return { id, group: "pool", remainingPercent };
}

test("resolveActiveApiKeyId keeps the current pool key instead of jumping to a higher remaining key", () => {
  assert.equal(
    resolveActiveApiKeyId({
      keys: [poolKey("low", 20), poolKey("high", 90)],
      currentKeyId: "low",
    }),
    "low",
  );
});

test("resolveActiveApiKeyId keeps an unprobed overlay current instead of the highest remaining pool key", () => {
  assert.equal(
    resolveActiveApiKeyId({
      keys: [{ id: "overlay", group: "unknown", remainingPercent: null }, poolKey("high", 90)],
      currentKeyId: "overlay",
    }),
    "overlay",
  );
});

test("resolveActiveApiKeyId keeps an unknown overlay when the pool is still empty", () => {
  assert.equal(
    resolveActiveApiKeyId({
      keys: [{ id: "overlay", group: "unknown", remainingPercent: null }],
      currentKeyId: "overlay",
    }),
    "overlay",
  );
});

test("resolveActiveApiKeyId switches to the highest remaining pool key when the current key leaves the pool", () => {
  assert.equal(
    resolveActiveApiKeyId({
      keys: [
        { id: "spent", group: "cooling", remainingPercent: 0 },
        poolKey("mid", 40),
        poolKey("high", 90),
      ],
      currentKeyId: "spent",
    }),
    "high",
  );
});

test("resolveActiveApiKeyId treats a requested pool key as the sticky current key", () => {
  assert.equal(
    resolveActiveApiKeyId({
      keys: [poolKey("alpha", 10), poolKey("beta", 90)],
      currentKeyId: "alpha",
      requestedKeyId: "beta",
    }),
    "beta",
  );
});

test("resolveActiveApiKeyId ignores a requested cooling key and keeps the current pool key", () => {
  assert.equal(
    resolveActiveApiKeyId({
      keys: [poolKey("alpha", 10), { id: "beta", group: "cooling", remainingPercent: 0 }],
      currentKeyId: "alpha",
      requestedKeyId: "beta",
    }),
    "alpha",
  );
});

test("resolveActiveApiKeyId returns null when the pool is empty", () => {
  assert.equal(
    resolveActiveApiKeyId({
      keys: [{ id: "spent", group: "cooling", remainingPercent: 0 }],
      currentKeyId: "spent",
    }),
    null,
  );
});

test("resolveActiveApiKeyId prefers a null remainingPercent pool key over a lower numeric remainder", () => {
  assert.equal(
    resolveActiveApiKeyId({
      keys: [poolKey("numeric", 40), poolKey("zen", null)],
      currentKeyId: "spent",
    }),
    "zen",
  );
});

test("parsePooledRequestFailureStatus reads HTTP codes from Host error messages", () => {
  assert.equal(parsePooledRequestFailureStatus("Provider returned 403 RegionError"), 403);
  assert.equal(parsePooledRequestFailureStatus("HTTP 401 Unauthorized"), 401);
  assert.equal(parsePooledRequestFailureStatus("429 Too Many Requests"), 429);
  assert.equal(parsePooledRequestFailureStatus("Provider returned a server error."), null);
});

test("readPooledRequestFailureFromTurnError reads chat turn attribution without rotating mid-SSE", () => {
  assert.deepEqual(
    readPooledRequestFailureFromTurnError({
      message: "Turn execution failed",
      attribution: {
        providerId: "opencode-go-responses",
        statusCode: 403,
      },
    }),
    { providerId: "opencode-go-responses", status: 403 },
  );
  assert.equal(
    readPooledRequestFailureFromTurnError({
      message: "Turn execution failed",
      attribution: { providerId: "opencode-go-responses", statusCode: 500 },
    }),
    null,
  );
  assert.deepEqual(
    readPooledRequestFailureFromTurnError({
      message: "Turn execution failed",
      cause: {
        message: "Provider authentication failed.",
        cause: {
          message:
            "Upstream request failed: An active OpenCode Go subscription is required to use Go models.",
          attribution: { providerId: "opencode-go-responses", statusCode: 403 },
        },
      },
    }),
    { providerId: "opencode-go-responses", status: 403 },
  );
});

test("excluded pool keys switch to another pool key and never clear overlay while pool remains", () => {
  assert.equal(
    resolveActiveApiKeyId({
      keys: [poolKey("sdac", 77), poolKey("skz3", 74)],
      currentKeyId: "sdac",
      excludedKeyIds: ["sdac"],
    }),
    "skz3",
  );
  assert.equal(
    resolveActiveApiKeyId({
      keys: [poolKey("only", 77)],
      currentKeyId: "only",
      excludedKeyIds: ["only"],
    }),
    "only",
  );
  assert.equal(
    resolveActiveApiKeyId({
      keys: [{ id: "overlay", group: "unknown", remainingPercent: null }],
      currentKeyId: "overlay",
      excludedKeyIds: ["overlay"],
    }),
    "overlay",
  );
});
