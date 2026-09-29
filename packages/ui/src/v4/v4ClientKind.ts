export type V4ClientKind = "desktop" | "web" | "mobileRemote" | "mobileApp";

let clientKindOverride: V4ClientKind | undefined;

/** 局域网手机壳在握手前声明 mobileApp。桌面不设置覆盖。 */
export function setV4ClientKindOverride(kind: V4ClientKind | undefined): void {
  clientKindOverride = kind;
}

export function resolveV4ClientKind(
  clientMode: "desktop-continuous" | "web-remote-replayable",
): V4ClientKind {
  if (clientKindOverride) return clientKindOverride;
  return clientMode === "desktop-continuous" ? "desktop" : "web";
}
