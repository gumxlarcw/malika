"use client";

import { useEffect, useState, useCallback } from "react";
import RequireAuth from "@/components/RequireAuth";
import { api } from "@/lib/axios";
import Alert from "@/components/Alert";
import LoadingSpinner from "@/components/LoadingSpinner";
import { getErrorMessage } from "@/lib/errors";
import { fmt, formatDate } from "@/lib/formatters";

type SchedulerState = {
  name: string;
  enabled: boolean;
  schedule: string;
  running: boolean;
  lastRunAt: string | null;
  lastResult: {
    success: boolean;
    brs?: { indexed: number; errors: number };
    publikasi?: { indexed: number; errors: number };
    durationMs?: number;
    timestamp?: string;
    error?: string;
    logs?: string[];
  } | null;
  nextRunAt: string | null;
  currentRunLogs?: string[];
};

type KnowledgeBaseStats = {
  category: string;
  cnt: number;
  latest: string;
};

type SyncStats = {
  indexed: {
    brs: number;
    publikasi: number;
  };
  knowledgeBase: KnowledgeBaseStats[];
  scheduler: SchedulerState;
};

type SyncConfig = {
  BRS_PAGES_TO_CHECK: number;
  PUBLIKASI_PAGES_TO_CHECK: number;
  BATCH_DELAY_MS: number;
  MAX_NEW_PER_SYNC: number;
  INDEX_MODE: string;
};

export default function KnowledgeSyncPage() {
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Scheduler config form
  const [scheduleHour, setScheduleHour] = useState(6);
  const [scheduleMinute, setScheduleMinute] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/knowledge/sync/stats");
      setStats(res.data);
      
      // Update form from scheduler state
      if (res.data.scheduler?.schedule) {
        const [h, m] = res.data.scheduler.schedule.split(":").map(Number);
        setScheduleHour(h);
        setScheduleMinute(m);
      }
      setEnabled(res.data.scheduler?.enabled ?? true);
      
      // Fetch config
      try {
        const configRes = await api.get("/knowledge/sync/config");
        setConfig(configRes.data);
      } catch {
        // Config endpoint might not exist yet
      }
    } catch (e) {
      setError(getErrorMessage(e, "Failed to load sync stats"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Auto-refresh when syncing
  useEffect(() => {
    if (syncing || stats?.scheduler?.running) {
      const interval = setInterval(fetchStats, 3000);
      return () => clearInterval(interval);
    }
  }, [syncing, stats?.scheduler?.running, fetchStats]);

  const handleManualSync = async () => {
    try {
      setSyncing(true);
      setError("");
      setSuccess("");
      
      const res = await api.post("/knowledge/sync");
      
      setSuccess(
        `Sync completed: ${res.data.brs?.indexed || 0} BRS, ${res.data.publikasi?.indexed || 0} Publikasi indexed in ${(res.data.durationMs / 1000).toFixed(1)}s`
      );
      fetchStats();
    } catch (e) {
      setError(getErrorMessage(e, "Sync failed"));
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveSchedule = async () => {
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      
      await api.put("/knowledge/sync/schedule", {
        enabled,
        hour: scheduleHour,
        minute: scheduleMinute,
      });
      
      setSuccess(`Schedule updated: ${enabled ? `Daily at ${String(scheduleHour).padStart(2, "0")}:${String(scheduleMinute).padStart(2, "0")}` : "Disabled"}`);
      fetchStats();
    } catch (e) {
      setError(getErrorMessage(e, "Failed to save schedule"));
    } finally {
      setSaving(false);
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <RequireAuth>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Knowledge Sync (RAG)</h1>
            <p className="text-muted-foreground">Auto-embed BRS dan Publikasi baru dari BPS API setiap hari</p>
          </div>
          <button
            onClick={handleManualSync}
            disabled={syncing || stats?.scheduler?.running}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {syncing || stats?.scheduler?.running ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                Syncing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Manual Sync
              </>
            )}
          </button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        {loading && !stats ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Scheduler Status */}
            <div className="bg-card border rounded-lg p-5">
              <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Scheduler Status
              </h2>
              
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${stats?.scheduler?.enabled ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                    {stats?.scheduler?.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Schedule</span>
                  <span className="font-mono">{stats?.scheduler?.schedule || "-"} WIT</span>
                </div>
                
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Next Run</span>
                  <span className="text-sm">
                    {stats?.scheduler?.nextRunAt ? fmt(stats.scheduler.nextRunAt) : "-"}
                  </span>
                </div>
                
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Running</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${stats?.scheduler?.running ? "bg-yellow-100 text-yellow-700 animate-pulse" : "bg-gray-100 text-gray-600 dark:bg-gray-800"}`}>
                    {stats?.scheduler?.running ? "Yes - Syncing..." : "No"}
                  </span>
                </div>
                
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Last Run</span>
                  <span className="text-sm">
                    {stats?.scheduler?.lastRunAt ? fmt(stats.scheduler.lastRunAt) : "Never"}
                  </span>
                </div>
                
                {stats?.scheduler?.lastResult && (
                  <div className="py-2 bg-muted/50 rounded p-3 mt-2">
                    <div className="text-sm font-medium mb-2">Last Result:</div>
                    {stats.scheduler.lastResult.success ? (
                      <div className="text-sm space-y-1">
                        <div className="flex justify-between">
                          <span>BRS indexed:</span>
                          <span className="font-medium text-green-600">{stats.scheduler.lastResult.brs?.indexed || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Publikasi indexed:</span>
                          <span className="font-medium text-green-600">{stats.scheduler.lastResult.publikasi?.indexed || 0}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Duration:</span>
                          <span>{formatDuration(stats.scheduler.lastResult.durationMs || 0)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-red-600">{stats.scheduler.lastResult.error || "Failed"}</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Statistics */}
            <div className="bg-card border rounded-lg p-5">
              <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Indexed Documents
              </h2>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-green-600">{stats?.indexed?.brs || 0}</div>
                  <div className="text-sm text-muted-foreground">BRS</div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-purple-600">{stats?.indexed?.publikasi || 0}</div>
                  <div className="text-sm text-muted-foreground">Publikasi</div>
                </div>
              </div>
              
              <h3 className="text-sm font-medium mb-2 text-muted-foreground">Knowledge Base</h3>
              <div className="space-y-2">
                {stats?.knowledgeBase?.map((kb) => (
                  <div key={kb.category} className="flex justify-between items-center py-2 border-b text-sm">
                    <span>{kb.category}</span>
                    <div className="text-right">
                      <span className="font-medium">{kb.cnt}</span>
                      <span className="text-muted-foreground text-xs ml-2">
                        (latest: {formatDate(kb.latest)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Schedule Configuration */}
            <div className="bg-card border rounded-lg p-5">
              <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Schedule Configuration
              </h2>
              
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                  </label>
                  <span className="text-sm font-medium">Enable Daily Sync</span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Hour (0-23)</label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={scheduleHour}
                      onChange={(e) => setScheduleHour(parseInt(e.target.value) || 0)}
                      disabled={!enabled}
                      className="w-full px-3 py-2 border rounded-md bg-background disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Minute (0-59)</label>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={scheduleMinute}
                      onChange={(e) => setScheduleMinute(parseInt(e.target.value) || 0)}
                      disabled={!enabled}
                      className="w-full px-3 py-2 border rounded-md bg-background disabled:opacity-50"
                    />
                  </div>
                </div>
                
                <div className="text-sm text-muted-foreground bg-muted/50 rounded p-3">
                  <strong>Catatan:</strong> Waktu menggunakan zona waktu server (WIT/+09:00). Sync akan berjalan setiap hari pada waktu yang ditentukan.
                </div>
                
                <button
                  onClick={handleSaveSchedule}
                  disabled={saving}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Schedule"}
                </button>
              </div>
            </div>

            {/* Sync Configuration */}
            <div className="bg-card border rounded-lg p-5">
              <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
                Sync Configuration
              </h2>
              
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">BRS Pages to Check</span>
                  <span className="font-mono">{config?.BRS_PAGES_TO_CHECK || 3}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Publikasi Pages to Check</span>
                  <span className="font-mono">{config?.PUBLIKASI_PAGES_TO_CHECK || 3}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Max New Items per Sync</span>
                  <span className="font-mono">{config?.MAX_NEW_PER_SYNC || 20}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Index Mode</span>
                  <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{config?.INDEX_MODE || "abstract"}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Batch Delay</span>
                  <span className="font-mono">{config?.BATCH_DELAY_MS || 500}ms</span>
                </div>
              </div>
              
              <div className="mt-4 text-xs text-muted-foreground">
                Configuration is set in environment variables or code constants.
              </div>
            </div>

            {/* Sync Logs — live during run, frozen from last run otherwise */}
            <div className="bg-card border rounded-lg p-5 lg:col-span-2">
              <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Sync Logs
                {stats?.scheduler?.running && (
                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700 animate-pulse">
                    LIVE
                  </span>
                )}
              </h2>

              {(() => {
                const isLive = Boolean(stats?.scheduler?.running);
                const live = stats?.scheduler?.currentRunLogs || [];
                const frozen = stats?.scheduler?.lastResult?.logs || [];
                const lines = isLive ? live : frozen;

                if (lines.length === 0) {
                  return (
                    <div className="text-sm text-muted-foreground py-6 text-center">
                      {isLive
                        ? "Sync sedang dimulai, log belum tersedia..."
                        : "Belum ada log dari run terbaru. Jalankan Manual Sync untuk melihat detail di sini."}
                    </div>
                  );
                }
                return (
                  <>
                    <div className="text-xs text-muted-foreground mb-2">
                      {isLive
                        ? `Menampilkan ${lines.length} baris live (refresh tiap 3s)`
                        : `Run terakhir: ${lines.length} baris (frozen, ${stats?.scheduler?.lastResult?.timestamp ? new Date(stats.scheduler.lastResult.timestamp).toLocaleString("id-ID") : "?"})`}
                    </div>
                    <pre className="text-xs font-mono bg-muted/30 rounded p-3 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                      {lines.slice(-300).join("\n")}
                    </pre>
                    {lines.length > 300 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        (menampilkan 300 baris terakhir dari {lines.length} total)
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
