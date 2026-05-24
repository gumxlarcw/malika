export type Overall = "UP" | "DEGRADED" | "DOWN" | "UNKNOWN";
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
export type ProbeKind = "scheduled" | "manual" | "recovery";
export type EndpointFamily = "domain" | "var" | "th" | "pressrelease";
export type ErrorCode =
  | "HTML_RESPONSE" | "AUTH_INVALID" | "RATE_LIMITED"
  | "HTTP_5XX" | "HTTP_4XX" | "TIMEOUT" | "NETWORK"
  | "UNKNOWN_STATUS" | "INTERNAL" | "API_KEY_MISSING";

export interface PerFamilySummary {
  family: EndpointFamily;
  lastOk: boolean | null;
  lastLatencyMs: number | null;
  lastErrorCode: ErrorCode | null;
  lastCheckedAt: string | null;
}

export interface CircuitSummary {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: string | null;
  nextAttemptAt: string | null;
}

export interface StatusResponse {
  overall: Overall;
  lastProbeAt: string | null;
  lastProbeRunId: string | null;
  uptime24h: number | null;
  p50LatencyMs24h: number | null;
  p95LatencyMs24h: number | null;
  totalProbes24h: number;
  failedProbes24h: number;
  perFamily: PerFamilySummary[];
  circuit: CircuitSummary;
  apiKeyPresent: boolean;
}

export interface HistoryBucket {
  t: string;
  probes: number;
  failed: number;
  p95LatencyMs: number | null;
}

export interface HistoryResponse {
  bucket: "5m" | "15m" | "1h";
  hours: number;
  buckets: HistoryBucket[];
}

export interface ProbeLog {
  id: number;
  run_id: string;
  probe_kind: ProbeKind;
  endpoint_family: EndpointFamily;
  url_template: string;
  http_status: number | null;
  latency_ms: number | null;
  ok: 0 | 1;
  error_code: ErrorCode | null;
  error_message: string | null;
  bytes_received: number | null;
  created_at: string;
}

export interface LogsResponse {
  total: number;
  limit: number;
  offset: number;
  logs: ProbeLog[];
}

export interface ProbeResult {
  runId: string;
  overall: Overall;
  durationMs: number;
  perFamily: Array<{
    family: EndpointFamily;
    ok: 0 | 1;
    latencyMs: number | null;
    httpStatus: number | null;
    errorCode: ErrorCode | null;
  }>;
}
