export type AutomationItem = {
  source: { id: number; name: string | null };
  datasource: { type: "dynamic" | "static" | "interop" | "exim" | string };
  production: {
    tableName: string | null;
    exists: boolean;
    rows: number;
    last_update: string | null;
    last_pulled_at: string | null;
    error?: string | null;
  };
  automation: {
    enabled: boolean;
    mode: "daily" | "smart";
    last_run_at: string | null;
    last_success_at: string | null;
    last_pull_started_at: string | null;
    last_pull_finished_at: string | null;
    last_bps_last_update: string | null;
    last_signature: string | null;
    last_error: string | null;
  };
  exim_pod_filter?: {
    enabled: boolean;
    pods_count: number;
    updated_at: string | null;
  } | null;
};

export type AutomationStatusResponse = {
  scheduler_enabled: boolean;
  poll_minutes: number;
  min_interval_hours: number;
  data_bps?: {
    available?: boolean;
    connected?: boolean;
    dbName?: string | null;
    error?: string | null;
  };
  items: AutomationItem[];
};

export type AutomationStatusJob = {
  jobId: string;
  status: "running" | "done" | "failed";
  started_at: string | null;
  finished_at: string | null;
  progress?: {
    total?: number;
    loaded?: number;
    percent?: number;
    message?: string;
  };
  data?: AutomationStatusResponse;
  error?: string | null;
};

export type AutomationStatusJobStartResponse = {
  ok: boolean;
  alreadyRunning?: boolean;
  job?: AutomationStatusJob;
  message?: string;
};

export type AutomationStatusJobStatusResponse = {
  ok: boolean;
  job?: AutomationStatusJob;
  message?: string;
};

export type SchedulerSettings = {
  mode: "daily" | "interval";
  interval_minutes: number | null;
  run_hour: number;
  run_minute: number;
};

export type SchedulerSettingsGetResponse = {
  ok: boolean;
  settings?: {
    automation?: SchedulerSettings | null;
    publication?: SchedulerSettings | null;
    mergedcache?: SchedulerSettings | null;
  };
  active?: {
    automation?: {
      enabled_env?: boolean;
      effective?: unknown;
      state?: unknown;
    } | null;
  };
  message?: string;
};

export type AutomationLastLogResponse = {
  ok?: boolean;
  mode?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  logs?: string[];
  message?: string;
};

export type EximPodFilterGetResponse = {
  ok: boolean;
  source_id?: number;
  enabled?: boolean;
  pods?: string[];
  updated_at?: string | null;
  message?: string;
};

export type EximPodFilterSaveResponse = {
  ok: boolean;
  source_id?: number;
  enabled?: boolean;
  pods?: string[];
  updated_at?: string | null;
  message?: string;
};

export type EximPodOptionsResponse = {
  ok: boolean;
  source_id?: number;
  table?: string;
  pods?: string[];
  message?: string;
};

export type AutomationRunJob = {
  jobId: string;
  source_id: number;
  mode: string;
  status: "running" | "done" | "failed";
  started_at: string | null;
  finished_at: string | null;
  progress?: {
    percent?: number;
    message?: string;
  };
  error?: string | null;
  logs?: string[];
};

export type AutomationRunJobStartResponse = {
  ok: boolean;
  alreadyRunning?: boolean;
  job?: AutomationRunJob;
  message?: string;
};

export type AutomationRunJobStatusResponse = {
  ok: boolean;
  job?: AutomationRunJob;
  message?: string;
};

export type BatchRunState = {
  active: boolean;
  total: number;
  done: number;
  failed: number;
};

export type PodPanelState = {
  loading: boolean;
  pods: string[];
  error: string;
};

export type PodSelectionState = {
  loading: boolean;
  pods: string[];
  saving: boolean;
  error: string;
};
