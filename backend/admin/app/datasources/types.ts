export type DsType = "dynamic" | "static" | "interop" | "exim" | "pressrelease";

export type DataSourceRow = {
  id: number;
  name: string;
  description: string | null;
  aliases?: string | null;
  type: DsType;
  api_url: string;
  period_key: string | null;
  auto_period: boolean | null;
  status: boolean | null;
  visible: boolean | null;
  display_order: number | null;
  category: string | null;
};

export type PrepareResponse = {
  detectedType: DsType;
  suggested: Partial<DataSourceRow>;
  warnings: string[];
};

export type DuplicateNameError = {
  ok?: boolean;
  code?: string;
  message?: string;
  matches?: Array<{ id: number; name: string; type?: string; visible?: boolean | null; status?: boolean | null }>;
};

export type EximSeedJob = {
  jobId: string;
  status: "running" | "done" | "failed";
  started_at: string;
  finished_at: string | null;
  progress: {
    total: number;
    done: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    current: string | null;
  };
  logs: string[];
  error: string | null;
  result: unknown;
};

export type BulkImportResult = {
  inputUrl: string;
  status: "created" | "skipped" | "error";
  message: string;
  createdId?: number;
  detectedType?: DsType;
  api_url?: string;
  name?: string;
};
