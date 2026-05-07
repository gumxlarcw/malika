"use client";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import RequireAuth from "@/components/RequireAuth";
import StatCard from "@/components/StatCard";
import { DataTable, OffsetPagination, AsyncStateMessages, ConfirmModal } from "@/components/ui";
import type { Column } from "@/components/ui/DataTable";
import { useAsyncState, useOffsetPagination } from "@/hooks";
import { FileText, RefreshCw, Trash2, CheckCircle, XCircle, Filter } from "lucide-react";

interface FetchLog {
  id: number;
  source_id: number;
  status_code: number;
  message: string;
}

interface Stats {
  total: number;
  success_count: number;
  error_count: number;
  unique_sources: number;
}

export default function FetchLogsPage() {
  const { loading, error, success, startLoading, finishWithError, setLoading, setError, setSuccess } = useAsyncState(true);
  const pagination = useOffsetPagination(100);
  const [logs, setLogs] = useState<FetchLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  // Filters
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "success" | "error">("");

  // Clear confirmation
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get("/logs/fetch/stats");
      setStats(data);
    } catch {
      // ignore stats error
    }
  }, []);

  const loadLogs = useCallback(async () => {
    startLoading();
    try {
      const params = new URLSearchParams();
      params.set("limit", String(pagination.limit));
      params.set("offset", String(pagination.offset));
      if (sourceFilter) params.set("source_id", sourceFilter);
      if (statusFilter) params.set("status", statusFilter);

      const { data } = await api.get(`/logs/fetch?${params.toString()}`);
      setLogs(data.logs || []);
      pagination.setTotal(data.total || 0);
      setLoading(false);
    } catch (e: unknown) {
      finishWithError(getErrorMessage(e, "Gagal memuat fetch logs"));
    }
  }, [pagination.limit, pagination.offset, sourceFilter, statusFilter, startLoading, finishWithError, setLoading, pagination]);

  useEffect(() => {
    loadStats();
    loadLogs();
  }, [pagination.offset, statusFilter, sourceFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirmClear() {
    setClearing(true);
    setError("");
    try {
      const { data } = await api.delete("/logs/fetch?keep=1000");
      setSuccess(data.message || "Log berhasil dibersihkan");
      setShowClearConfirm(false);
      loadStats();
      loadLogs();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal membersihkan log"));
    } finally {
      setClearing(false);
    }
  }

  function isSuccess(code: number) {
    return code >= 200 && code < 300;
  }

  const columns: Column<FetchLog>[] = [
    { key: "id", label: "ID", render: (log) => <span className="font-mono text-xs">{log.id}</span> },
    { key: "source_id", label: "Source ID" },
    {
      key: "status_code",
      label: "Status",
      className: "text-center",
      render: (log) =>
        isSuccess(log.status_code) ? (
          <span className="inline-flex items-center gap-1 text-green-600">
            <CheckCircle className="h-4 w-4" />
            <span className="text-xs">{log.status_code}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-red-600">
            <XCircle className="h-4 w-4" />
            <span className="text-xs">{log.status_code}</span>
          </span>
        ),
    },
    {
      key: "message",
      label: "Message",
      render: (log) => (
        <span className="block max-w-md truncate text-muted-foreground" title={log.message}>
          {log.message || "-"}
        </span>
      ),
    },
  ];

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Fetch Logs</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { loadStats(); loadLogs(); }}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Bersihkan</span>
            </button>
          </div>
        </div>

        <AsyncStateMessages error={error} success={success} onClearError={() => setError("")} onClearSuccess={() => setSuccess("")} />

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total Logs" value={stats.total.toLocaleString()} />
            <StatCard title="Sukses" value={stats.success_count.toLocaleString()} variant="primary" />
            <StatCard title="Error" value={stats.error_count.toLocaleString()} variant="destructive" />
            <StatCard title="Sumber Unik" value={stats.unique_sources.toLocaleString()} />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-border bg-card">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <input
            type="number"
            placeholder="Source ID"
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); pagination.reset(); }}
            className="px-3 py-1.5 rounded-lg border border-border bg-background w-32"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as "" | "success" | "error"); pagination.reset(); }}
            className="px-3 py-1.5 rounded-lg border border-border bg-background"
          >
            <option value="">Semua Status</option>
            <option value="success">Sukses (2xx)</option>
            <option value="error">Error</option>
          </select>
          {(sourceFilter || statusFilter) && (
            <button
              onClick={() => { setSourceFilter(""); setStatusFilter(""); pagination.reset(); }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Reset filter
            </button>
          )}
        </div>

        <DataTable
          columns={columns}
          data={logs}
          keyField="id"
          loading={loading}
          loadingRows={10}
          emptyMessage="Tidak ada log"
        />

        <OffsetPagination
          offset={pagination.offset}
          limit={pagination.limit}
          total={pagination.total}
          onOffsetChange={pagination.setOffset}
        />

        <ConfirmModal
          isOpen={showClearConfirm}
          onClose={() => setShowClearConfirm(false)}
          onConfirm={handleConfirmClear}
          title="Bersihkan Log"
          message="Hapus log lama dan simpan hanya 1000 log terbaru?"
          confirmLabel="Bersihkan"
          confirmVariant="danger"
          loading={clearing}
        />
      </div>
    </RequireAuth>
  );
}
