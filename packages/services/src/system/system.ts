import type {
  IntegratedTerminalShellOption,
  IntranetProbeRequest,
  IntranetProbeResult,
  ProxyEndpointTestResult,
  SystemInfo,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface ISystemService {
  info(): Promise<SystemInfo>;
  listIntegratedTerminalShells(): Promise<IntegratedTerminalShellOption[]>;
  probeIntranet(request: IntranetProbeRequest): Promise<IntranetProbeResult>;
  /** 探测单条代理地址自身是否可达（TCP + 协议问候），fail-closed。 */
  testProxyEndpoint(proxyUrl: string): Promise<ProxyEndpointTestResult>;
}

export const ISystemService = createServiceDescriptor<ISystemService>(ServiceChannels.System);
