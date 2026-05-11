"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/formatters";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";

// Types
type ChatMessageFlag = {
  id: number;
  message_id: number;
  thread_id: number;
  flag_type: "hallucination" | "wrong_data" | "irrelevant" | "incomplete" | "formatting_issue" | "context_lost" | "wrong_source" | "other";
  severity: "low" | "medium" | "high" | "critical";
  flagged_by: "user" | "admin" | "system" | "auto";
  owner_id: string | null;
  user_query: string | null;
  assistant_response: string | null;
  expected_response: string | null;
  correction_notes: string | null;
  resolution_status: "pending" | "reviewed" | "fixed" | "ignored" | "training_added";
  resolved_by: number | null;
  resolved_at: string | null;
  context_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type ChatErrorPattern = {
  id: number;
  pattern_name: string;
  pattern_type: "query_pattern" | "data_pattern" | "context_pattern" | "hallucination_pattern" | "prompt_issue";
  trigger_keywords: string[] | null;
  trigger_regex: string | null;
  error_description: string;
  fix_type: "add_to_knowledge" | "add_to_prompt" | "special_handling" | "data_fix" | "cannot_fix";
  fix_content: string | null;
  occurrence_count: number;
  last_occurrence_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type Stats = {
  totalFlags: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  totalPatterns: number;
  activePatterns: number;
  recentFlags: number;
};

const FLAG_TYPE_COLORS: Record<string, string> = {
  hallucination: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  wrong_data: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  irrelevant: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  incomplete: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  formatting_issue: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  context_lost: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  wrong_source: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  reviewed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  fixed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  ignored: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  training_added: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function MalikaAnalysisPage() {
  const [activeTab, setActiveTab] = useState<"flags" | "patterns" | "analytics">("flags");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Flags state
  const [flags, setFlags] = useState<ChatMessageFlag[]>([]);
  const [flagsFilter, setFlagsFilter] = useState<{ type: string; status: string; severity: string }>({ type: "", status: "", severity: "" });
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<{ total: number; totalPages: number }>({ total: 0, totalPages: 1 });

  // Patterns state
  const [patterns, setPatterns] = useState<ChatErrorPattern[]>([]);
  
  // Stats state
  const [stats, setStats] = useState<Stats | null>(null);
  
  // Selected flag for detail view
  const [selectedFlag, setSelectedFlag] = useState<ChatMessageFlag | null>(null);

  // Pattern suggestions (auto-drafted from flag clusters)
  type SuggestedDraft = {
    pattern_name: string;
    pattern_type: string;
    trigger_keywords: string[];
    error_description: string;
    fix_type: string;
    fix_content: string;
  };

  type AnalysisCluster = {
    count: number;
    topKeywords: { word: string; count: number }[];
    sampleQueries: (string | null)[];
    suggestedDraft?: SuggestedDraft;
  };

  type AnalysisResponse = {
    ok: boolean;
    totalPending: number;
    byType: Record<string, AnalysisCluster>;
  };

  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [promoteDraft, setPromoteDraft] = useState<SuggestedDraft | null>(null);
  const [autoTuneJob, setAutoTuneJob] = useState<{
    jobId: string;
    flagId: number;
    status: string;
    startedAt: number;
    lastPollAt?: number;
    pollError?: string | null;
    pollFatal?: boolean;
  } | null>(null);

  // Fetch flags
  const fetchFlags = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (flagsFilter.type) params.set("type", flagsFilter.type);
      if (flagsFilter.status) params.set("status", flagsFilter.status);
      if (flagsFilter.severity) params.set("severity", flagsFilter.severity);
      params.set("page", String(page));
      params.set("limit", "20");

      const res = await api.get(`/error-learning/flags?${params.toString()}`);
      setFlags(res.data.flags || []);
      setPageInfo({
        total: res.data.pagination?.total ?? 0,
        totalPages: res.data.pagination?.totalPages ?? 1,
      });
    } catch (e) {
      setError(getErrorMessage(e, "Failed to load flags"));
    }
  }, [flagsFilter, page]);
  
  // Fetch patterns
  const fetchPatterns = useCallback(async () => {
    try {
      const res = await api.get("/error-learning/patterns");
      setPatterns(res.data.patterns || []);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to load patterns"));
    }
  }, []);
  
  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get("/error-learning/stats");
      setStats(res.data);
    } catch (e) {
      console.warn("Stats fetch failed:", e);
    }
  }, []);

  // Fetch analysis (pattern suggestions)
  const fetchAnalysis = useCallback(async () => {
    try {
      const res = await api.get('/error-learning/analyze');
      setAnalysis(res.data);
    } catch (e) {
      console.warn('Analyze fetch failed:', e);
    }
  }, []);

  const triggerAutoTune = useCallback(async (flagId: number) => {
    try {
      const res = await api.post(`/error-learning/flags/${flagId}/auto-tune`);
      if (!res.data?.ok) throw new Error(res.data?.error || 'failed');
      setAutoTuneJob({ jobId: res.data.jobId, flagId, status: 'queued', startedAt: Date.now() });
    } catch (e) {
      setError(getErrorMessage(e, 'Auto Tune failed to start'));
    }
  }, []);

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchFlags(), fetchPatterns(), fetchStats(), fetchAnalysis()]);
      setLoading(false);
    };
    load();
  }, [fetchFlags, fetchPatterns, fetchStats, fetchAnalysis]);

  useEffect(() => { setPage(1); }, [flagsFilter.type, flagsFilter.status, flagsFilter.severity]);

  // Heartbeat: trigger re-render every 1s while a non-terminal Auto Tune is in
  // flight, so the elapsed-time display and "last update Xs ago" stay live even
  // when polling silently fails.
  const [autoTuneTick, setAutoTuneTick] = useState(0);
  useEffect(() => {
    if (!autoTuneJob) return;
    if (['committed', 'abandoned', 'failed', 'regression_failed'].includes(autoTuneJob.status)) return;
    if (autoTuneJob.pollFatal) return;
    const tick = setInterval(() => setAutoTuneTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [autoTuneJob]);

  const refreshAutoTuneJob = useCallback(async () => {
    if (!autoTuneJob) return;
    try {
      const res = await api.get(`/error-learning/auto-tune/${autoTuneJob.jobId}`);
      const status = res.data?.job?.status;
      if (!status) return;
      setAutoTuneJob((j) => (j ? { ...j, status, lastPollAt: Date.now(), pollError: null, pollFatal: false } : j));
      if (['committed', 'abandoned', 'failed', 'regression_failed'].includes(status)) {
        await Promise.all([fetchFlags(), fetchStats(), fetchPatterns(), fetchAnalysis()]);
      }
    } catch (e: unknown) {
      const errAny = e as { response?: { status?: number; data?: { error?: string } }; message?: string };
      const httpStatus = errAny?.response?.status;
      const msg = errAny?.response?.data?.error || errAny?.message || String(e);
      const fatal = httpStatus === 401 || httpStatus === 403;
      setAutoTuneJob((j) => (j ? { ...j, pollError: `HTTP ${httpStatus ?? '?'}: ${msg}`, pollFatal: fatal } : j));
    }
  }, [autoTuneJob, fetchFlags, fetchStats, fetchPatterns, fetchAnalysis]);

  useEffect(() => {
    if (!autoTuneJob) return;
    if (['committed', 'abandoned', 'failed', 'regression_failed'].includes(autoTuneJob.status)) return;
    if (autoTuneJob.pollFatal) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/error-learning/auto-tune/${autoTuneJob.jobId}`);
        const status = res.data?.job?.status;
        if (!status) return;
        setAutoTuneJob((j) => (j ? { ...j, status, lastPollAt: Date.now(), pollError: null } : j));
        if (['committed', 'abandoned', 'failed', 'regression_failed'].includes(status)) {
          clearInterval(interval);
          await Promise.all([fetchFlags(), fetchStats(), fetchPatterns(), fetchAnalysis()]);
        }
      } catch (e: unknown) {
        const errAny = e as { response?: { status?: number; data?: { error?: string } }; message?: string };
        const httpStatus = errAny?.response?.status;
        const msg = errAny?.response?.data?.error || errAny?.message || String(e);
        const fatal = httpStatus === 401 || httpStatus === 403;
        setAutoTuneJob((j) => (j ? { ...j, pollError: `HTTP ${httpStatus ?? '?'}: ${msg}`, pollFatal: fatal } : j));
        if (fatal) clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [autoTuneJob, fetchFlags, fetchStats, fetchPatterns, fetchAnalysis]);

  // Update flag status
  const updateFlagStatus = async (flagId: number, status: string, notes?: string) => {
    try {
      await api.patch(`/error-learning/flags/${flagId}`, { 
        resolution_status: status,
        correction_notes: notes,
      });
      await fetchFlags();
      await fetchStats();
      setSelectedFlag(null);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to update flag"));
    }
  };
  
  // Toggle pattern active
  const togglePattern = async (patternId: number, isActive: boolean) => {
    try {
      await api.patch(`/error-learning/patterns/${patternId}`, { is_active: isActive });
      await fetchPatterns();
    } catch (e) {
      setError(getErrorMessage(e, "Failed to update pattern"));
    }
  };
  
  if (loading) {
    return (
      <RequireAuth>
        <div className="flex items-center justify-center min-h-[400px]">
          <LoadingSpinner />
        </div>
      </RequireAuth>
    );
  }
  
  return (
    <RequireAuth>
      <div className="max-w-7xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">MALIKA Analysis</h1>
        
        {error && (
          <Alert variant="error" className="mb-4">
            <div className="flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold">×</button>
            </div>
          </Alert>
        )}
        
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.totalFlags}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Flags</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.byStatus?.pending || 0}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Pending</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.activePatterns}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Active Patterns</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.recentFlags || 0}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Last 7 Days</div>
            </div>
          </div>
        )}
        
        {/* Tabs */}
        <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("flags")}
            className={`px-4 py-2 font-medium ${activeTab === "flags" ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-400"}`}
          >
            Flags ({flags.length})
          </button>
          <button
            onClick={() => setActiveTab("patterns")}
            className={`px-4 py-2 font-medium ${activeTab === "patterns" ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-400"}`}
          >
            Patterns ({patterns.length})
          </button>
          <button
            onClick={() => setActiveTab("analytics")}
            className={`px-4 py-2 font-medium ${activeTab === "analytics" ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-400"}`}
          >
            Analytics
          </button>
        </div>
        
        {/* Flags Tab */}
        {activeTab === "flags" && (
          <div>
            {/* Filters */}
            <div className="flex gap-4 mb-4 flex-wrap">
              <select
                value={flagsFilter.type}
                onChange={(e) => setFlagsFilter((f) => ({ ...f, type: e.target.value }))}
                className="border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
              >
                <option value="">All Types</option>
                <option value="hallucination">Hallucination</option>
                <option value="wrong_data">Wrong Data</option>
                <option value="incomplete">Incomplete</option>
                <option value="context_lost">Context Lost</option>
                <option value="irrelevant">Irrelevant</option>
                <option value="other">Other</option>
              </select>
              
              <select
                value={flagsFilter.status}
                onChange={(e) => setFlagsFilter((f) => ({ ...f, status: e.target.value }))}
                className="border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
              >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="reviewed">Reviewed</option>
                <option value="fixed">Fixed</option>
                <option value="ignored">Ignored</option>
                <option value="training_added">Training Added</option>
              </select>
              
              <select
                value={flagsFilter.severity}
                onChange={(e) => setFlagsFilter((f) => ({ ...f, severity: e.target.value }))}
                className="border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
              >
                <option value="">All Severity</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              
              <button
                onClick={fetchFlags}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Filter
              </button>
            </div>
            
            {/* Flags Table */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">ID</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Severity</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Query</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Created</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {flags.map((flag) => (
                    <tr key={flag.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm">{flag.id}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${FLAG_TYPE_COLORS[flag.flag_type] || ""}`}>
                          {flag.flag_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${SEVERITY_COLORS[flag.severity] || ""}`}>
                          {flag.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[flag.resolution_status] || ""}`}>
                          {flag.resolution_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm max-w-xs truncate" title={flag.user_query || ""}>
                        {flag.user_query?.slice(0, 50) || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {formatDateTime(flag.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setSelectedFlag(flag)}
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
                          >
                            View
                          </button>
                          <button
                            onClick={() => triggerAutoTune(flag.id)}
                            disabled={Boolean(autoTuneJob && autoTuneJob.flagId === flag.id && !['committed','abandoned','failed','regression_failed'].includes(autoTuneJob.status))}
                            className="text-purple-600 hover:text-purple-800 dark:text-purple-400 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Run Auto Tune agent on this flag (Anthropic Claude via proxy)"
                          >
                            Auto Tune
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {flags.length === 0 && (
                <div className="text-center py-8 text-gray-500">No flags found</div>
              )}
            </div>

            {pageInfo.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 px-2">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Page {page} of {pageInfo.totalPages} ({pageInfo.total} total)
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1 border rounded disabled:opacity-40 dark:border-gray-700"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pageInfo.totalPages, p + 1))}
                    disabled={page >= pageInfo.totalPages}
                    className="px-3 py-1 border rounded disabled:opacity-40 dark:border-gray-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Patterns Tab */}
        {activeTab === "patterns" && (
          <div className="space-y-4">
            {patterns.map((pattern) => (
              <div
                key={pattern.id}
                className={`bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 ${pattern.is_active ? "border-green-500" : "border-gray-300"}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-lg">{pattern.pattern_name}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {pattern.error_description}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                        {pattern.pattern_type}
                      </span>
                      <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded text-xs">
                        {pattern.fix_type}
                      </span>
                      <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded text-xs">
                        {pattern.occurrence_count} occurrences
                      </span>
                    </div>
                    {pattern.trigger_keywords && (
                      <div className="mt-2 text-sm text-gray-500">
                        Keywords: {Array.isArray(pattern.trigger_keywords) ? pattern.trigger_keywords.join(", ") : String(pattern.trigger_keywords)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pattern.is_active}
                        onChange={(e) => togglePattern(pattern.id, e.target.checked)}
                        className="sr-only peer"
                        aria-label={`${pattern.is_active ? "Nonaktifkan" : "Aktifkan"} pola ${pattern.pattern_name}`}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </div>
                
                {pattern.fix_content && (
                  <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900 rounded text-sm">
                    <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">Fix Content:</div>
                    <pre className="whitespace-pre-wrap text-gray-600 dark:text-gray-400 text-xs">
                      {pattern.fix_content}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {/* Analytics Tab */}
        {activeTab === "analytics" && stats && (
          <div className="space-y-6">
            {/* Distribution by Type */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <h3 className="font-medium mb-4">Flags by Type</h3>
              <div className="space-y-2">
                {Object.entries(stats.byType || {}).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${FLAG_TYPE_COLORS[type] || ""}`}>
                      {type}
                    </span>
                    <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-4">
                      <div
                        className="bg-blue-600 h-4 rounded-full"
                        style={{ width: `${(count / stats.totalFlags) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium w-8 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Distribution by Status */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <h3 className="font-medium mb-4">Flags by Status</h3>
              <div className="grid grid-cols-5 gap-4">
                {Object.entries(stats.byStatus || {}).map(([status, count]) => (
                  <div key={status} className="text-center">
                    <div className={`inline-block px-3 py-1 rounded text-sm font-medium ${STATUS_COLORS[status] || ""}`}>
                      {count}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{status}</div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Top Patterns */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <h3 className="font-medium mb-4">Most Triggered Patterns</h3>
              <div className="space-y-2">
                {patterns
                  .sort((a, b) => b.occurrence_count - a.occurrence_count)
                  .slice(0, 5)
                  .map((pattern) => (
                    <div key={pattern.id} className="flex justify-between items-center py-2 border-b dark:border-gray-700 last:border-0">
                      <span className="text-sm">{pattern.pattern_name}</span>
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                        {pattern.occurrence_count} times
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Pattern Suggestions (auto-drafted from flag clusters) */}
            {analysis && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                <h3 className="font-medium mb-1">Pattern Suggestions</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Drafts auto-generated from pending flag clusters. Review and Promote to add as live patterns.
                </p>
                <div className="space-y-3">
                  {Object.entries(analysis.byType)
                    .filter(([, cluster]) => cluster.suggestedDraft)
                    .sort(([, a], [, b]) => b.count - a.count)
                    .map(([type, cluster]) => (
                      <div key={type} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${FLAG_TYPE_COLORS[type] || ""}`}>{type}</span>
                              <span className="text-xs text-gray-500">{cluster.count} flag{cluster.count === 1 ? '' : 's'}</span>
                            </div>
                            <div className="text-sm font-medium mb-1">{cluster.suggestedDraft!.pattern_name}</div>
                            <div className="flex flex-wrap gap-1 mb-2">
                              {cluster.suggestedDraft!.trigger_keywords.slice(0, 6).map((kw) => (
                                <span key={kw} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">{kw}</span>
                              ))}
                            </div>
                            <details className="text-xs text-gray-500">
                              <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">Sample queries ({cluster.sampleQueries.filter(Boolean).length})</summary>
                              <ul className="mt-1 pl-4 space-y-0.5">
                                {cluster.sampleQueries.filter((q): q is string => Boolean(q)).map((q, i) => (
                                  <li key={i} className="truncate" title={q}>• {q.slice(0, 100)}{q.length > 100 ? '…' : ''}</li>
                                ))}
                              </ul>
                            </details>
                          </div>
                          <button
                            onClick={() => setPromoteDraft(cluster.suggestedDraft!)}
                            className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 whitespace-nowrap"
                          >
                            Promote
                          </button>
                        </div>
                      </div>
                    ))}
                  {Object.values(analysis.byType).filter((c) => c.suggestedDraft).length === 0 && (
                    <div className="text-sm text-gray-500 py-4 text-center">
                      No flag clusters meet draft criteria (≥2 flags of a draftable type). Existing patterns may be covering things, or you may need to wait for more flag data.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Flag Detail Modal */}
        {selectedFlag && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-bold">Flag #{selectedFlag.id}</h2>
                  <button
                    onClick={() => setSelectedFlag(null)}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
                  >
                    ✕
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${FLAG_TYPE_COLORS[selectedFlag.flag_type] || ""}`}>
                      {selectedFlag.flag_type}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${SEVERITY_COLORS[selectedFlag.severity] || ""}`}>
                      {selectedFlag.severity}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[selectedFlag.resolution_status] || ""}`}>
                      {selectedFlag.resolution_status}
                    </span>
                  </div>
                  
                  <div>
                    <div className="font-medium text-sm text-gray-600 dark:text-gray-400 mb-1">User Query:</div>
                    <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded text-sm">
                      {selectedFlag.user_query || "-"}
                    </div>
                  </div>
                  
                  <div>
                    <div className="font-medium text-sm text-gray-600 dark:text-gray-400 mb-1">Assistant Response:</div>
                    <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded text-sm max-h-40 overflow-y-auto">
                      {selectedFlag.assistant_response?.slice(0, 500) || "-"}
                    </div>
                  </div>
                  
                  <div>
                    <div className="font-medium text-sm text-gray-600 dark:text-gray-400 mb-1">Correction Text (added to knowledge base):</div>
                    <textarea
                      className="w-full border rounded p-2 dark:bg-gray-900 dark:border-gray-700"
                      rows={4}
                      placeholder="Tulis koreksi/jawaban yang benar — akan diindeks ke retrieval_chunks dan dipakai untuk pertanyaan serupa di chat MALIKA."
                      id="correction-text"
                    />
                  </div>

                  <div>
                    <div className="font-medium text-sm text-gray-600 dark:text-gray-400 mb-1">Correction Notes:</div>
                    <textarea
                      className="w-full border rounded p-2 dark:bg-gray-900 dark:border-gray-700"
                      rows={3}
                      placeholder="Add notes about the issue and resolution..."
                      defaultValue={selectedFlag.correction_notes || ""}
                      id="correction-notes"
                    />
                  </div>
                  
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        const notes = (document.getElementById("correction-notes") as HTMLTextAreaElement)?.value;
                        updateFlagStatus(selectedFlag.id, "reviewed", notes);
                      }}
                      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
                    >
                      Mark Reviewed
                    </button>
                    <button
                      onClick={() => {
                        const notes = (document.getElementById("correction-notes") as HTMLTextAreaElement)?.value;
                        updateFlagStatus(selectedFlag.id, "fixed", notes);
                      }}
                      className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 text-sm"
                    >
                      Mark Fixed
                    </button>
                    <button
                      onClick={() => {
                        const notes = (document.getElementById("correction-notes") as HTMLTextAreaElement)?.value;
                        updateFlagStatus(selectedFlag.id, "ignored", notes);
                      }}
                      className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 text-sm"
                    >
                      Ignore
                    </button>
                    <button
                      onClick={async () => {
                        const text = (document.getElementById("correction-text") as HTMLTextAreaElement)?.value?.trim();
                        if (!text) { setError("Correction text required"); return; }
                        try {
                          const res = await api.post(`/error-learning/flags/${selectedFlag.id}/add-to-knowledge`, { correction_text: text });
                          if (!res.data?.ok) throw new Error(res.data?.error || 'failed');
                          await fetchFlags();
                          await fetchStats();
                          setSelectedFlag(null);
                        } catch (e) {
                          setError(getErrorMessage(e, "Failed to add to knowledge base"));
                        }
                      }}
                      className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 text-sm"
                    >
                      Add to Knowledge
                    </button>
                  </div>
                  
                  <div className="text-xs text-gray-500">
                    Thread: {selectedFlag.thread_id} | Message: {selectedFlag.message_id} |
                    Created: {formatDateTime(selectedFlag.created_at)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Promote Pattern Modal */}
        {promoteDraft && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-bold">Promote to Pattern</h2>
                  <button onClick={() => setPromoteDraft(null)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400">✕</button>
                </div>
                <p className="text-xs text-gray-500 mb-4">Review and edit before creating. This pattern will be active immediately.</p>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget as HTMLFormElement;
                    const fd = new FormData(form);
                    const keywordsRaw = String(fd.get('trigger_keywords') || '');
                    const keywords = keywordsRaw.split(',').map(s => s.trim()).filter(Boolean);
                    const body = {
                      pattern_name: String(fd.get('pattern_name') || ''),
                      pattern_type: String(fd.get('pattern_type') || 'query_pattern'),
                      trigger_keywords: keywords,
                      error_description: String(fd.get('error_description') || ''),
                      fix_type: String(fd.get('fix_type') || ''),
                      fix_content: String(fd.get('fix_content') || ''),
                    };
                    try {
                      const res = await api.post('/error-learning/patterns', body);
                      if (!res.data?.ok) throw new Error(res.data?.error || 'failed');
                      await Promise.all([fetchPatterns(), fetchAnalysis(), fetchStats()]);
                      setPromoteDraft(null);
                    } catch (e) {
                      setError(getErrorMessage(e, "Failed to create pattern"));
                    }
                  }}
                  className="space-y-3"
                >
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Pattern Name</label>
                    <input name="pattern_name" defaultValue={promoteDraft.pattern_name} required
                      className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Pattern Type</label>
                    <select name="pattern_type" defaultValue={promoteDraft.pattern_type}
                      className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700">
                      <option value="query_pattern">query_pattern</option>
                      <option value="data_pattern">data_pattern</option>
                      <option value="context_pattern">context_pattern</option>
                      <option value="hallucination_pattern">hallucination_pattern</option>
                      <option value="prompt_issue">prompt_issue</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Trigger Keywords (comma-separated)</label>
                    <input name="trigger_keywords" defaultValue={promoteDraft.trigger_keywords.join(', ')} required
                      className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Error Description</label>
                    <textarea name="error_description" defaultValue={promoteDraft.error_description} rows={2} required
                      className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fix Type</label>
                    <select name="fix_type" defaultValue={promoteDraft.fix_type}
                      className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700">
                      <option value="add_to_prompt">add_to_prompt</option>
                      <option value="special_handling">special_handling</option>
                      <option value="add_to_knowledge">add_to_knowledge</option>
                      <option value="data_fix">data_fix</option>
                      <option value="cannot_fix">cannot_fix</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fix Content</label>
                    <textarea name="fix_content" defaultValue={promoteDraft.fix_content} rows={4} required
                      className="w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700" />
                  </div>
                  <div className="flex gap-2 justify-end pt-2">
                    <button type="button" onClick={() => setPromoteDraft(null)}
                      className="px-4 py-2 border rounded text-sm dark:border-gray-700">Cancel</button>
                    <button type="submit"
                      className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Create Pattern</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {autoTuneJob && (
          <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4 max-w-sm z-50">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-sm font-medium">Auto Tune — flag #{autoTuneJob.flagId}</div>
                <div className="text-xs text-gray-500 font-mono">job {autoTuneJob.jobId.slice(0, 10)}…</div>
              </div>
              <button
                onClick={() => setAutoTuneJob(null)}
                className="text-gray-400 hover:text-gray-600 text-sm"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`px-2 py-0.5 rounded font-medium ${
                  autoTuneJob.status === 'committed'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : autoTuneJob.status === 'abandoned'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                      : ['failed','regression_failed'].includes(autoTuneJob.status)
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                }`}
              >
                {autoTuneJob.status}
              </span>
              <span className="text-gray-500">{Math.floor((Date.now() - autoTuneJob.startedAt) / 1000)}s</span>
              {autoTuneJob.lastPollAt && !['committed','abandoned','failed','regression_failed'].includes(autoTuneJob.status) && (
                <span className="text-gray-400">· updated {Math.max(0, Math.floor((Date.now() - autoTuneJob.lastPollAt) / 1000))}s ago</span>
              )}
            </div>
            {/* Heartbeat-driven re-render anchor (uses autoTuneTick to force update each second) */}
            <span className="hidden" data-tick={autoTuneTick} />
            {autoTuneJob.pollError && !['committed','abandoned','failed','regression_failed'].includes(autoTuneJob.status) && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
                <div className="font-medium mb-0.5">
                  {autoTuneJob.pollFatal ? 'Polling stopped (auth)' : 'Polling error (retrying)'}
                </div>
                <div className="font-mono text-[10px] break-all">{autoTuneJob.pollError}</div>
                {autoTuneJob.pollFatal && (
                  <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                    Session likely expired — refresh the page to re-authenticate.
                  </div>
                )}
              </div>
            )}
            {!['committed','abandoned','failed','regression_failed'].includes(autoTuneJob.status) && (
              <button
                onClick={refreshAutoTuneJob}
                className="mt-2 w-full text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Refresh now
              </button>
            )}
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
