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
  
  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchFlags(), fetchPatterns(), fetchStats()]);
      setLoading(false);
    };
    load();
  }, [fetchFlags, fetchPatterns, fetchStats]);

  useEffect(() => { setPage(1); }, [flagsFilter.type, flagsFilter.status, flagsFilter.severity]);

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
                        <button
                          onClick={() => setSelectedFlag(flag)}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
                        >
                          View
                        </button>
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
      </div>
    </RequireAuth>
  );
}
