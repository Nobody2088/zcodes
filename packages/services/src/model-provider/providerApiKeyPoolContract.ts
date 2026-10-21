import type { Event } from "@zcode/rpc";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  ApiKeyPoolBalanceFact,
  ApiKeyPoolGroup,
  OpenCodeApiKeyPoolFamily,
  ProviderApiKeyPoolQuotaQuery,
} from "./providerApiKeyPool.js";

export type {
  ApiKeyPoolBalanceFact,
  ApiKeyPoolGroup,
  OpenCodeApiKeyPoolFamily,
  ParseBatchApiKeysResult,
  ProviderApiKeyPoolQuotaQuery,
} from "./providerApiKeyPool.js";

export type ProviderApiKeyPoolBalanceView = ApiKeyPoolBalanceFact;

export type ProviderApiKeyPoolUsageWindowId = "rolling" | "weekly" | "monthly";

export interface ProviderApiKeyPoolUsageWindowView {
  readonly window: ProviderApiKeyPoolUsageWindowId;
  readonly status: "ok" | "rate-limited";
  readonly usedPercent: number;
  readonly resetsAt: number;
}

export type ProviderApiKeyPoolMembershipState = "active" | "inactive" | "unknown";

export interface ProviderApiKeyPoolMembershipView {
  readonly state: ProviderApiKeyPoolMembershipState;
  readonly renewsAt: number | null;
  readonly renewalAuthorizationRequired: boolean;
}

export interface ProviderApiKeyPoolKeyView {
  readonly keyId: string;
  readonly maskedKey: string;
  readonly label: string | null;
  readonly group: ApiKeyPoolGroup;
  readonly lastCheckedAt: number | null;
  readonly remainingPercent: number | null;
  readonly resetAt: number | null;
  readonly availableAt: number | null;
  readonly probeError: "network" | "http" | "auth" | null;
  readonly windows: readonly ProviderApiKeyPoolUsageWindowView[];
  readonly membership: ProviderApiKeyPoolMembershipView;
  readonly balance: ProviderApiKeyPoolBalanceView | null;
}

export interface ProviderApiKeyPoolView {
  readonly providerId: string;
  readonly supported: boolean;
  readonly family: OpenCodeApiKeyPoolFamily | null;
  readonly quotaQuery: ProviderApiKeyPoolQuotaQuery;
  readonly keys: readonly ProviderApiKeyPoolKeyView[];
  readonly activeKeyId: string | null;
  readonly revision: number;
}

export interface ProviderApiKeyPoolAddResult {
  readonly added: number;
  readonly duplicate: number;
  readonly invalid: number;
  readonly view: ProviderApiKeyPoolView;
}

export interface ProviderApiKeyPoolActiveKey {
  readonly apiKey: string;
  readonly keyId: string;
}

/** 子代理换钥结果。rotated 为 false 时不带明文。 */
export interface ProviderApiKeyPoolFailoverResult {
  readonly rotated: boolean;
  readonly apiKey?: string;
  readonly keyId?: string;
}

export interface IProviderApiKeyPoolService {
  readonly onDidChange: Event<ProviderApiKeyPoolView>;
  getView(providerId: string): Promise<ProviderApiKeyPoolView>;
  addKeys(providerId: string, text: string): Promise<ProviderApiKeyPoolAddResult>;
  deleteKeys(providerId: string, keyIds: readonly string[]): Promise<ProviderApiKeyPoolView>;
  probeKeys(providerId: string, keyIds?: readonly string[]): Promise<ProviderApiKeyPoolView>;
  selectActiveKey(providerId: string, keyId: string): Promise<ProviderApiKeyPoolView>;
  noteRequestFailure(
    providerId: string,
    status: number,
    failedKeyId?: string,
  ): Promise<ProviderApiKeyPoolView>;
  /** 只读当前号池 Key。不探测、不改分组。 */
  readActiveKey(providerId: string): Promise<ProviderApiKeyPoolActiveKey | null>;
  /**
   * 失败后改选下一把 Key。分类对象是 failedKeyId，不是此刻的 overlay。
   * failedKeyId 缺省时与 noteRequestFailure 一样处理当前 overlay。
   * 只有改选到另一把仍可用的 Key 时 rotated 为 true。
   */
  claimNextKeyAfterFailure(
    providerId: string,
    failedKeyId: string | undefined,
    status: number,
  ): Promise<ProviderApiKeyPoolFailoverResult>;
  revealKey(providerId: string, keyId: string): Promise<string>;
}

export const IProviderApiKeyPoolService = createServiceDescriptor<IProviderApiKeyPoolService>(
  ServiceChannels.ProviderApiKeyPool,
);
