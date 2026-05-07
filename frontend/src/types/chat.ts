/**
 * Chat-related type definitions
 * Extracted from ChatPageClient.tsx for reusability
 */

export type Thread = {
  id: number;
  owner_id: string;
  title: string;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BackendMessage = {
  id: number;
  thread_id: number;
  role: "system" | "user" | "assistant";
  content: string;
  created_at: string;
  latency_ms?: number | null;
};

/** Discriminated union for chat message types */
export type ChatMessageType =
  | "typing"
  | "typing_text"
  | "error"
  | "result_table"
  | "link_list"
  | "suggestions"
  | "text"
  | "system";

/** Content payload for chat messages */
export type ChatMessageContent = {
  text?: string;
  responseTimeMs?: number;
  modelLabel?: string | null;
  /** Token usage from pipeline metadata */
  tokenInfo?: { input: number; output: number; reasoning: number; total: number } | null;
  ui?: MalikaUiMetaV1;
  errorType?: "network" | "timeout" | "server" | "unknown";
  isFailed?: boolean;
};

export type ChatUiMessage = {
  _id: string;
  type: ChatMessageType;
  content: ChatMessageContent;
  position?: "left" | "right" | "center";
  createdAt?: number;
  hasTime?: boolean;
};

export type CandidateItem = {
  id: number;
  name: string;
  type: string;
  score: number;
  latest: string | null;
  href: string;
};

export type KnowledgeCandidate = {
  id: number;
  name: string;
  type: "brs" | "publication" | "other";
  category: string;
  similarity: number;
  href: string;
};

export type SourceItem = {
  type: "brs" | "publication";
  id: number;
  title: string;
  similarity: number;
  category: string;
};

export type ExternalLink = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedDate?: string | null;
  trustBadge: "Kementerian" | "Lembaga" | "Pemerintah";
  matchedGeo?: string | null;
};

export type Recommendation = {
  id: string;
  topic: string;
  label: string;
  reason: string;
  queryHint: string;
};

export type ConfidenceInfo = {
  level: "high" | "medium" | "low";
  score: number;
  hasDataPreview: boolean;
  hasKnowledge: boolean;
};

export type TableData = {
  kind?: "data" | "search";
  title?: string;
  columns: string[];
  rows: any[];
  total_rows?: number;
  periodRange?: {
    requested?: { start: number; end: number; isSpecificYears?: boolean };
    available?: number[];
  } | null;
  /** EXIM group type (hs2, ctr, pod) */
  eximGroup?: string | null;
  /** EXIM mode (ekspor, impor) — null for non-EXIM tables */
  eximMode?: "ekspor" | "impor" | null;
  /** BPS website URL for this datasource */
  bps_web_url?: string | null;
  /** Datasource ID for API lookups */
  source_id?: number | null;
  /** All rows across all years (includes "Tahun" column) — for modal year tabs */
  allRows?: any[] | null;
  /** Columns for allRows (includes "Tahun" at front) */
  allColumns?: string[] | null;
  /** Available years for year-tab navigation */
  availableYears?: string[] | null;
  /** Default year to show when modal opens */
  defaultYear?: string | null;
};

/** LLM-generated chart configuration from the Chart Agent (Stage 5.5) */
export type ChartAgentOutput = {
  should_render: boolean;
  render_reason: string;
  chart_type: "line" | "bar" | "pie" | "area" | "stacked-bar" | "grouped-bar";
  x_axis: {
    column: string;
    label: string;
    type: "category" | "datetime" | "numeric";
  };
  series: Array<{
    column: string;
    label: string;
    type: "primary" | "secondary";
  }>;
  y_axis: {
    label: string;
    format: "number" | "percentage" | "currency" | "index";
  };
  options: {
    stacked: boolean;
    show_legend: boolean;
    show_data_labels: boolean;
    orientation: "horizontal" | "vertical";
    color_scheme: "default" | "categorical" | "sequential" | "diverging";
  };
  chart_title: string;
  chart_subtitle: string | null;
  alternative: {
    chart_type: "line" | "bar" | "pie" | "area";
    reason: string;
  } | null;
};

export type MalikaUiMetaV1 = {
  v: 1;
  query?: string;
  preview_mode?: "auto" | "confirm" | "none";
  preview_queries?: Array<{ label: string; q: string }>;
  preferred_data_link?: string;
  requested?: { year: number | null; month: number | null; geo: string | null };
  lowConfidence?: boolean;
  table?: TableData;
  /** Secondary table for dual EXIM (ekspor + impor) or multi-datasource queries */
  table2?: TableData;
  candidates?: CandidateItem[];
  knowledgeCandidates?: KnowledgeCandidate[] | null;
  links?: Array<{ label: string; href: string }>;
  suggestions?: string[];
  sources?: SourceItem[] | null;
  externalLinks?: ExternalLink[] | null;
  recommendations?: Recommendation[] | null;
  confidence?: ConfidenceInfo | null;
  /** LLM Chart Agent output — chart configuration for ChatChart component */
  chart?: ChartAgentOutput | null;
  /** DNA Nucleus BPS metadata — definitions, concepts, methodology */
  dnaMetadata?: DnaUiMetadata | null;
  /** Persisted thinking timeline items (restored on thread load) */
  thinkingItems?: ThinkingItem[] | null;
  /** v2 pipeline metadata — present when CHAT_PIPELINE_V2=true */
  metadata?: MessageMetadata | null;
};

/** DNA metadata item from BPS DNA Nucleus API */
export type DnaUiItem = {
  type: "variable" | "indicator" | "kegiatan";
  nama: string;
  alias: string | null;
  definisi: string | null;
  konsep: string | null;
  satuan: string | null;
  ukuran: string | null;
  referensiWaktu: string | null;
  tujuan: string | null;
  metode: string | null;
  frekuensi: string | null;
  isBps: boolean;
};

export type DnaUiMetadata = {
  items: DnaUiItem[];
};

/**
 * Per-message metadata from v2 pipeline.
 * Provides token usage, model info, latency, and pipeline timings.
 */
export type MessageMetadata = {
  model: string;
  tier: "greeting" | "simple" | "complex" | "deep" | "user_override";
  reasoning: boolean;
  reasoning_effort: "low" | "medium" | "high" | null;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    total: number;
  } | null;
  latency_ms: number;
  pipeline_ms: Record<string, number>;
};

/**
 * Chat status (4-state model matching Vercel AI SDK).
 */
export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export type KnowledgeDocument = {
  title: string;
  abstract?: string;
  pdf?: string;
  thumbnail?: string;
  release_date?: string;
  doc_type: "brs" | "publication" | "custom";
};

/**
 * Known thinking step types emitted by the backend pipeline.
 */
export type ThinkingStepType =
  | "query"
  | "context"
  | "dna"
  | "sources"
  | "knowledge"
  | "data"
  | "reasoning"
  | "strategy"
  | "orchestrator-sub"
  | "thinking-delta"
  | "parse-error";

/**
 * Structured thinking event from the SSE pipeline.
 * Canonical type — used by chatTransport, ProcessIndicator, and AssistantThread.
 */
export interface ThinkingItem {
  /** Thinking step type */
  step?: ThinkingStepType | (string & {});
  icon?: string;
  label?: string;
  detail?: string;
  tags?: string[];
  count?: number;
  brsCount?: number;
  pubCount?: number;
  model?: string;
  tier?: string;
  /** Per-step elapsed time in milliseconds */
  elapsedMs?: number;
  /** Legacy plain-text fallback */
  content?: string;
  /** Legacy plain-text fallback (alias) */
  text?: string;
}
