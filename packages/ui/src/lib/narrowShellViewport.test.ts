import assert from "node:assert/strict";
import test from "node:test";
import {
  isLanRemoteShell,
  isNarrowShellViewport,
  NARROW_SHELL_MEDIA_QUERY,
  shouldFlattenModelProviderMenu,
} from "./narrowShellViewport.js";

type FakeWindow = {
  innerWidth?: number;
  matchMedia?: (query: string) => { matches: boolean };
  visualViewport?: { width?: number };
  screen?: { width?: number; height?: number };
  location?: { search?: string };
  sessionStorage?: { getItem: (key: string) => string | null };
};

type FakeDocument = {
  documentElement?: {
    clientWidth?: number;
    style?: { getPropertyValue: (name: string) => string };
  };
};

function withWindow(fake: FakeWindow, documentFake: FakeDocument | undefined, run: () => void) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    window: fake,
    document: documentFake ?? { documentElement: { clientWidth: fake.innerWidth } },
  });
  try {
    run();
  } finally {
    Object.assign(globalThis, { window: previousWindow, document: previousDocument });
  }
}

test("phone-width viewport starts as a narrow shell", () => {
  withWindow(
    {
      matchMedia(query: string) {
        return { matches: query === NARROW_SHELL_MEDIA_QUERY };
      },
      location: { search: "" },
      sessionStorage: { getItem: () => null },
    },
    {
      documentElement: {
        style: { getPropertyValue: () => "" },
      },
    },
    () => {
      assert.equal(isNarrowShellViewport(), true);
      assert.equal(shouldFlattenModelProviderMenu(), "flat");
    },
  );
});

test("desktop-width viewport keeps the sidebar column", () => {
  withWindow(
    {
      innerWidth: 1280,
      screen: { width: 1280, height: 800 },
      matchMedia() {
        return { matches: false };
      },
      location: { search: "" },
      sessionStorage: { getItem: () => null },
    },
    {
      documentElement: {
        clientWidth: 1280,
        style: { getPropertyValue: () => "" },
      },
    },
    () => {
      assert.equal(isNarrowShellViewport(), false);
      assert.equal(shouldFlattenModelProviderMenu(), "submenu");
    },
  );
});

test("stale matchMedia still treats a 390px visible width as narrow", () => {
  withWindow(
    {
      innerWidth: 980,
      visualViewport: { width: 390 },
      screen: { width: 980, height: 980 },
      matchMedia() {
        return { matches: false };
      },
      location: { search: "" },
      sessionStorage: { getItem: () => null },
    },
    {
      documentElement: {
        clientWidth: 980,
        style: { getPropertyValue: () => "" },
      },
    },
    () => {
      assert.equal(isNarrowShellViewport(), true);
      assert.equal(shouldFlattenModelProviderMenu(), "flat");
    },
  );
});

test("wide layout viewport on a phone screen still flattens the model menu", () => {
  // 真实 iPhone 远控曾把 layout 报成 ≥768，旧的 innerWidth/visualViewport 判定全绿，
  // 仍走 DropdownMenuSub，侧栏被屏幕裁切。screen 短边才是机宽。
  withWindow(
    {
      innerWidth: 980,
      visualViewport: { width: 980 },
      screen: { width: 390, height: 844 },
      matchMedia() {
        return { matches: false };
      },
      location: { search: "" },
      sessionStorage: { getItem: () => null },
    },
    {
      documentElement: {
        clientWidth: 980,
        style: { getPropertyValue: () => "" },
      },
    },
    () => {
      assert.equal(isNarrowShellViewport(), true);
      assert.equal(shouldFlattenModelProviderMenu({ narrowShell: true }), "flat");
      assert.equal(shouldFlattenModelProviderMenu({ narrowShell: false }), "flat");
    },
  );
});

test("lan=1 remote shell flattens even when every width looks desktop", () => {
  withWindow(
    {
      innerWidth: 1280,
      visualViewport: { width: 1280 },
      screen: { width: 1280, height: 800 },
      matchMedia() {
        return { matches: false };
      },
      location: { search: "?lan=1" },
      sessionStorage: { getItem: () => null },
    },
    {
      documentElement: {
        clientWidth: 1280,
        style: { getPropertyValue: () => "" },
      },
    },
    () => {
      assert.equal(isLanRemoteShell(), true);
      assert.equal(isNarrowShellViewport(), true);
      assert.equal(shouldFlattenModelProviderMenu(), "flat");
    },
  );
});

test("lan remote sessionStorage flattens the model menu", () => {
  withWindow(
    {
      innerWidth: 1280,
      visualViewport: { width: 1280 },
      screen: { width: 1280, height: 800 },
      matchMedia() {
        return { matches: false };
      },
      location: { search: "" },
      sessionStorage: {
        getItem(key: string) {
          return key === "zcode:lan-remote-session" ? '{"token":"x"}' : null;
        },
      },
    },
    {
      documentElement: {
        clientWidth: 1280,
        style: { getPropertyValue: () => "" },
      },
    },
    () => {
      assert.equal(isLanRemoteShell(), true);
      assert.equal(shouldFlattenModelProviderMenu(), "flat");
    },
  );
});

test("1280px visible width stays a desktop shell when matchMedia is false", () => {
  withWindow(
    {
      innerWidth: 1280,
      visualViewport: { width: 1280 },
      screen: { width: 1280, height: 800 },
      matchMedia() {
        return { matches: false };
      },
      location: { search: "" },
      sessionStorage: { getItem: () => null },
    },
    {
      documentElement: {
        clientWidth: 1280,
        style: { getPropertyValue: () => "" },
      },
    },
    () => {
      assert.equal(isNarrowShellViewport(), false);
      assert.equal(shouldFlattenModelProviderMenu({ narrowShell: false }), "submenu");
      assert.equal(shouldFlattenModelProviderMenu({ directItems: true }), "flat");
    },
  );
});
