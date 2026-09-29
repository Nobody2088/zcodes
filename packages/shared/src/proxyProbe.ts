/** 代理连通性 / 模型商延迟探测的结果类型（无密钥字段）。 */

export interface ProxyEndpointTestResult {
  readonly ok: boolean;
  /** 可达时的毫秒耗时；失败为 null */
  readonly latencyMs: number | null;
  readonly error?: string;
}

export interface ProviderApiLatencyProbeResult {
  readonly ok: boolean;
  readonly latencyMs: number | null;
  /** 收到 HTTP 响应时的状态码（含 401/403，仍计为路径可达） */
  readonly status?: number;
  readonly error?: string;
}
