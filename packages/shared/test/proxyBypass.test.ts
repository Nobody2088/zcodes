import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCAL_PROXY_BYPASS,
  matchesProxyBypass,
  resolveEffectiveNoProxy,
  resolveProxyRouteDecision,
  validateNoProxyRules,
} from "../src/proxyBypass.js";

test("empty noProxy resolves to documented local defaults", () => {
  assert.equal(resolveEffectiveNoProxy(undefined), DEFAULT_LOCAL_PROXY_BYPASS);
  assert.equal(resolveEffectiveNoProxy(""), DEFAULT_LOCAL_PROXY_BYPASS);
  assert.equal(resolveEffectiveNoProxy("  "), DEFAULT_LOCAL_PROXY_BYPASS);
  assert.equal(
    DEFAULT_LOCAL_PROXY_BYPASS,
    "localhost,127.0.0.1,::1,169.254.0.0/16,fe80::/10",
  );
});

test("explicit noProxy is not merged with defaults", () => {
  assert.equal(resolveEffectiveNoProxy("api.corp.com"), "api.corp.com");
  assert.equal(matchesProxyBypass("http://127.0.0.1/", "api.corp.com"), false);
  assert.equal(matchesProxyBypass("https://api.corp.com/v1", "api.corp.com"), true);
});

test("default bypass covers loopback and link-local", () => {
  assert.equal(matchesProxyBypass("http://localhost:3000/"), true);
  assert.equal(matchesProxyBypass("http://127.0.0.1:7890/"), true);
  assert.equal(matchesProxyBypass("http://[::1]/"), true);
  assert.equal(matchesProxyBypass("http://169.254.10.2/"), true);
  assert.equal(matchesProxyBypass("http://[fe80::1]/"), true);
  assert.equal(matchesProxyBypass("https://api.openai.com/v1"), false);
});

test("IPv4 CIDR uses containment not string prefix", () => {
  const rules = "192.168.8.0/24";
  assert.equal(matchesProxyBypass("http://192.168.8.1/", rules), true);
  assert.equal(matchesProxyBypass("http://192.168.8.255/", rules), true);
  assert.equal(matchesProxyBypass("http://192.168.9.1/", rules), false);
  // 字符串前缀会误伤 192.168.80.x；CIDR 不得匹配
  assert.equal(matchesProxyBypass("http://192.168.80.1/", rules), false);
});

test("invalid CIDR is rejected by validation and ignored by matcher", () => {
  const validated = validateNoProxyRules("192.168.8.0/99,api.example.com");
  assert.equal(validated.ok, false);
  if (!validated.ok) {
    assert.deepEqual(validated.invalidRules, ["192.168.8.0/99"]);
  }
  assert.equal(matchesProxyBypass("http://192.168.8.1/", "192.168.8.0/99"), false);
  assert.equal(matchesProxyBypass("https://api.example.com/", "api.example.com"), true);
});

test("proxy vs direct decision", () => {
  assert.equal(
    resolveProxyRouteDecision("https://api.openai.com/", {
      httpProxy: "http://127.0.0.1:7890",
      noProxy: undefined,
    }),
    "proxy",
  );
  assert.equal(
    resolveProxyRouteDecision("http://127.0.0.1:3000/", {
      httpProxy: "http://127.0.0.1:7890",
      noProxy: undefined,
    }),
    "direct",
  );
  assert.equal(
    resolveProxyRouteDecision("http://192.168.8.20/", {
      httpProxy: "http://127.0.0.1:7890",
      noProxy: "192.168.8.0/24",
    }),
    "direct",
  );
  assert.equal(
    resolveProxyRouteDecision("https://api.openai.com/", {
      httpProxy: undefined,
      noProxy: undefined,
    }),
    "direct",
  );
});
