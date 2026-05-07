/**
 * feedTypes — Types, constants, color maps, and tool metadata for UnifiedActivityFeed.
 *
 * Extracted from UnifiedActivityFeed.tsx to reduce file size and
 * enable reuse by child components without circular imports.
 */

import type { ThinkingItem } from "@/types/chat";
import type { TrackedToolCall } from "@/context/ChatProcessContext";

/* ================================================================== */
/*  Core types                                                         */
/* ================================================================== */
export interface ProcessStep {
  message: string;
  stage: string;
  status: "active" | "done" | "pending" | "error" | "skipped";
  startedAt: number;
  doneAt?: number;
  detail?: string;
  detailStatus?: "ok" | "warn" | "empty";
  errorMessage?: string;
}

export interface UnifiedActivityFeedProps {
  /* ── Live data (streaming mode) ── */
  steps: ProcessStep[];
  thinkingItems: ThinkingItem[];
  toolCalls?: TrackedToolCall[];
  isTyping: boolean;
  visible: boolean;
  fallbackLabel?: string;
  onStop?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  wasStopped?: boolean;

  /* ── Historical data (post-stream mode) ── */
  isHistorical?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  pipelineMs?: Record<string, number> | null;
  tokenInfo?: { input: number; output: number; reasoning: number; total: number } | null;

  /** Model ID for tier-aware styling (e.g. "claude-sonnet-4-6" for Deep) */
  modelId?: string;
}

/* ================================================================== */
/*  Pipeline stage config                                              */
/* ================================================================== */
export const PIPELINE_STAGES = [
  "normalize", "dna", "search", "knowledge", "preview", "model",
  "orchestrator", "generate", "composing",
];

export const STAGE_FRIENDLY: Record<string, { icon: string; label: string }> = {
  normalize:    { icon: "📝", label: "Memahami pertanyaan" },
  dna:          { icon: "🧬", label: "Analisis DNA data" },
  search:       { icon: "🔍", label: "Mencari indikator" },
  knowledge:    { icon: "📚", label: "Mencari referensi" },
  preview:      { icon: "📊", label: "Menyiapkan data" },
  model:        { icon: "🤖", label: "Menganalisis" },
  orchestrator: { icon: "🔬", label: "Sub-analisis mendalam" },
  generate:     { icon: "✍️", label: "Menyusun jawaban" },
  composing:    { icon: "📋", label: "Memformat hasil" },
  fallback:     { icon: "🔄", label: "Memproses" },
  analyst:      { icon: "📈", label: "Analisis konten" },
  thinking:     { icon: "💭", label: "Berpikir" },
};

/* ================================================================== */
/*  Thinking step colors                                               */
/* ================================================================== */
export const STEP_COLORS: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  query:     { dot: "bg-blue-400 dark:bg-blue-400",    text: "text-blue-600 dark:text-blue-300",    bg: "bg-blue-50 dark:bg-blue-950/40",       border: "border-blue-200 dark:border-blue-800/50" },
  context:   { dot: "bg-amber-400 dark:bg-amber-400",  text: "text-amber-600 dark:text-amber-300",  bg: "bg-amber-50 dark:bg-amber-950/40",     border: "border-amber-200 dark:border-amber-800/50" },
  dna:       { dot: "bg-emerald-400 dark:bg-emerald-400", text: "text-emerald-600 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-200 dark:border-emerald-800/50" },
  sources:   { dot: "bg-cyan-400 dark:bg-cyan-400",    text: "text-cyan-600 dark:text-cyan-300",    bg: "bg-cyan-50 dark:bg-cyan-950/40",       border: "border-cyan-200 dark:border-cyan-800/50" },
  knowledge: { dot: "bg-purple-400 dark:bg-purple-400", text: "text-purple-600 dark:text-purple-300", bg: "bg-purple-50 dark:bg-purple-950/40",   border: "border-purple-200 dark:border-purple-800/50" },
  data:      { dot: "bg-teal-400 dark:bg-teal-400",    text: "text-teal-600 dark:text-teal-300",    bg: "bg-teal-50 dark:bg-teal-950/40",       border: "border-teal-200 dark:border-teal-800/50" },
  reasoning: { dot: "bg-violet-400 dark:bg-violet-400", text: "text-violet-600 dark:text-violet-300", bg: "bg-violet-50 dark:bg-violet-950/40",   border: "border-violet-200 dark:border-violet-800/50" },
  strategy:  { dot: "bg-rose-400 dark:bg-rose-400",    text: "text-rose-600 dark:text-rose-300",    bg: "bg-rose-50 dark:bg-rose-950/40",       border: "border-rose-200 dark:border-rose-800/50" },
  "orchestrator-sub": { dot: "bg-indigo-400 dark:bg-indigo-400", text: "text-indigo-600 dark:text-indigo-300", bg: "bg-indigo-50 dark:bg-indigo-950/40", border: "border-indigo-200 dark:border-indigo-800/50" },
  "thinking-delta": { dot: "bg-violet-400 dark:bg-violet-400", text: "text-violet-600 dark:text-violet-300", bg: "bg-violet-50 dark:bg-violet-950/40", border: "border-violet-200 dark:border-violet-800/50" },
  "parse-error": { dot: "bg-orange-400 dark:bg-orange-400", text: "text-orange-600 dark:text-orange-300", bg: "bg-orange-50 dark:bg-orange-950/40", border: "border-orange-200 dark:border-orange-800/50" },
};
export const DEFAULT_STEP_COLORS = STEP_COLORS.reasoning;

/* ================================================================== */
/*  Tool call metadata                                                 */
/* ================================================================== */
export const TOOL_META: Record<string, { icon: string; label: string; color: string; bgLight: string; bgDark: string }> = {
  search_data:          { icon: "🔍", label: "Pencarian Indikator",   color: "text-blue-600 dark:text-blue-400",      bgLight: "bg-blue-50",    bgDark: "dark:bg-blue-950/30" },
  get_data_preview:     { icon: "📊", label: "Ambil Data Tabel",      color: "text-emerald-600 dark:text-emerald-400", bgLight: "bg-emerald-50", bgDark: "dark:bg-emerald-950/30" },
  search_knowledge:     { icon: "📚", label: "Pencarian Dokumen BPS", color: "text-purple-600 dark:text-purple-400",   bgLight: "bg-purple-50",  bgDark: "dark:bg-purple-950/30" },
  search_document_table:{ icon: "📋", label: "Cari Tabel Dokumen",    color: "text-amber-600 dark:text-amber-400",     bgLight: "bg-amber-50",   bgDark: "dark:bg-amber-950/30" },
  get_exim_data:        { icon: "🚢", label: "Data Perdagangan",      color: "text-teal-600 dark:text-teal-400",       bgLight: "bg-teal-50",    bgDark: "dark:bg-teal-950/30" },
  recall_memory:        { icon: "🧠", label: "Riwayat Percakapan",    color: "text-pink-600 dark:text-pink-400",       bgLight: "bg-pink-50",    bgDark: "dark:bg-pink-950/30" },
};
export const DEFAULT_TOOL_META = { icon: "⚙️", label: "Tool", color: "text-gray-600 dark:text-gray-400", bgLight: "bg-gray-50", bgDark: "dark:bg-gray-800/30" };

/* ================================================================== */
/*  Orchestrator badge colors                                          */
/* ================================================================== */
export const TYPE_BADGE_COLORS: Record<string, string> = {
  extraction: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  comparison: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  trend:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  ranking:    "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  analisis:   "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
};

/* ================================================================== */
/*  Feed segment types + thinking→pipeline mapping                     */
/* ================================================================== */

export const THINKING_TO_STAGE: Record<string, string> = {
  query:     "normalize",
  context:   "dna",
  dna:       "dna",
  sources:   "search",
  knowledge: "knowledge",
  data:      "preview",
  reasoning: "model",
  strategy:  "model",
  "orchestrator-sub": "orchestrator",
};

export type FeedSegment =
  | { type: "pipeline-step"; step: ProcessStep; idx: number; thinkingChildren: ThinkingItem[]; toolChildren: TrackedToolCall[]; orchChildren: ThinkingItem[] }
  | { type: "parallel-group"; label: string; stages: FeedSegment[] }
  | { type: "thinking"; item: ThinkingItem; idx: number }
  | { type: "orchestrator-card"; items: ThinkingItem[] }
  | { type: "tool-calls"; toolCalls: TrackedToolCall[] };

/** Stages that run in parallel and should be visually grouped */
export const PARALLEL_GROUPS: { stages: string[]; label: string }[] = [
  { stages: ["search", "knowledge", "preview"], label: "Pencarian data" },
];

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */
/** Check if a step status is terminal (no longer in progress) */
export function isTerminalStatus(status: ProcessStep["status"]): boolean {
  return status === "done" || status === "error" || status === "skipped";
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function fmtToolElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Check if model ID corresponds to the "Deep" tier */
export function isDeepModel(modelId?: string): boolean {
  return modelId === "claude-sonnet-4-6";
}

export function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return "";
  switch (toolName) {
    case "search_data":
    case "search_knowledge":
    case "recall_memory":
      return args.query ? `"${String(args.query).slice(0, 80)}"` : "";
    case "get_data_preview":
      return [args.source_id ? `ID: ${args.source_id}` : null, args.year ? `Tahun: ${args.year}` : null, args.geo ? `${args.geo}` : null].filter(Boolean).join(" · ");
    case "search_document_table":
      return [args.doc_id ? `Doc: ${args.doc_id}` : null, args.table_query ? `"${String(args.table_query).slice(0, 60)}"` : null].filter(Boolean).join(" · ");
    case "get_exim_data":
      return [args.mode ? String(args.mode).charAt(0).toUpperCase() + String(args.mode).slice(1) : null, args.year ? `${args.year}` : null].filter(Boolean).join(" · ");
    default:
      return Object.entries(args).slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(" · ");
  }
}
