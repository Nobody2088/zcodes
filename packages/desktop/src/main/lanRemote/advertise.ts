import type { LanRemoteAnnouncement, LanRemoteMdnsSocket } from "./mdns.js";
import { publishLanRemoteMdns } from "./mdns.js";
import { canUseSystemBonjour, registerLanRemoteBonjour } from "./bonjour.js";

export interface StartLanRemoteAdvertisementOptions {
  platform?: NodeJS.Platform;
  openRawSocket?: () => Promise<LanRemoteMdnsSocket>;
  onBonjourError?: (error: unknown) => void;
}

/**
 * 发布 `_zcode._tcp` 通告。darwin 走系统 Bonjour（mDNSResponder），其它平台走 raw UDP。
 */
export async function startLanRemoteAdvertisement(
  announcement: LanRemoteAnnouncement,
  options: StartLanRemoteAdvertisementOptions = {},
): Promise<() => void> {
  const platform = options.platform ?? process.platform;
  if (canUseSystemBonjour(platform)) {
    return registerLanRemoteBonjour(announcement, { onError: options.onBonjourError });
  }
  if (!options.openRawSocket) {
    throw new Error("raw mDNS socket factory is required on non-darwin platforms");
  }
  return publishLanRemoteMdns(await options.openRawSocket(), announcement);
}
