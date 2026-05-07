"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import { fmt } from "@/lib/formatters";
import DataTable, { DataTableColumn } from "@/components/DataTable";
import Alert from "@/components/Alert";
import { useAsyncState, usePagination } from "@/hooks";
import { useUiStore } from "@/lib/store/useUiStore";
import { ShieldAlert, RefreshCw, Filter } from "lucide-react";

interface AuditLog {
  id: number;
  user_id: number;
  user_email: string | null;
  user_role: string | null;
  action: string;
  resource: string | null;
  method: string;
  path: string;
  status_code: number | null;
  duration_ms: number | null;
  ip: string | null;
  created_at: string;
}

interface AuditStats {
  total: number;
  unique_users: number;
  error_count: number;
  last_24h: number;
}

export default function AuditLogsPage() {
  const { loading, error, startLoading, finishWithError, setLoading } = useAsyncState(true);
  const pagination = usePagination({ initialLimit: 50 });
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);

  const auditFilters = useUiStore((state) => state.auditLogsFilters);
  const setAuditFilters = useUiStore((state) => state.setAuditLogsFilters);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get("/logs/audit/stats");
      setStats(data.stats || null);
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
      if (auditFilters.userId) params.set("user_id", auditFilters.userId);
      if (auditFilters.action) params.set("action", auditFilters.action);
      if (auditFilters.resource) params.set("resource", auditFilters.resource);
      if (auditFilters.statusCode) params.set("status_code", auditFilters.statusCode);
      if (auditFilters.q) params.set("q", auditFilters.q);

      const { data } = await api.get(`/logs/audit?${params.toString()}`);
      setLogs(data.logs || []);
      pagination.setTotal(data.total || 0);
      setLoading(false);
    } catch (e: unknown) {
      finishWithError(getErrorMessage(e, "Gagal memuat audit logs"));
    }
  }, [auditFilters, pagination, startLoading, finishWithError, setLoading]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadStats();
      loadLogs();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadStats, loadLogs]);

  const columns: DataTableColumn<AuditLog>[] = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: "Waktu",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {fmt(row.original.created_at)}
          </span>
        ),
      },
      {
        accessorKey: "user_email",
        header: "User",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <div>
            <div className="font-medium">{row.original.user_email || `#${row.original.user_id}`}</div>
            <div className="text-xs text-muted-foreground">{row.original.user_role || "-"}</div>
          </div>
        ),
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <span className="px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">
            {row.original.action}
          </span>
        ),
      },
      {
        accessorKey: "resource",
        header: "Resource",
        cell: ({ row }: { row: { original: AuditLog } }) => <span className="text-xs">{row.original.resource || "-"}</span>,
      },
      {
        accessorKey: "method",
        header: "Method",
        cell: ({ row }: { row: { original: AuditLog } }) => <span className="text-xs font-mono">{row.original.method}</span>,
      },
      {
        accessorKey: "status_code",
        header: "Status",
        meta: { align: "center" },
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <span className={row.original.status_code && row.original.status_code >= 400 ? "text-red-600" : "text-emerald-600"}>
            {row.original.status_code ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "path",
        header: "Path",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <span className="block max-w-xs truncate text-xs text-muted-foreground" title={row.original.path}>
            {row.original.path}
          </span>
        ),
      },
      {
        accessorKey: "duration_ms",
        header: "Durasi",
        meta: { align: "right" },
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <span className="text-xs">{row.original.duration_ms ? `${row.original.duration_ms} ms` : "-"}</span>
        ),
      },
    ],
    []
  );

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Audit Logs</h1>
          </div>
          <button
            onClick={() => { loadStats(); loadLogs(); }}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="text-sm text-muted-foreground">Total Log</div>
              <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
            </div>
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="text-sm text-muted-foreground">User Unik</div>
              <div className="text-2xl font-bold">{stats.unique_users.toLocaleString()}</div>
            </div>
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="text-sm text-muted-foreground">Error</div>
              <div className="text-2xl font-bold">{stats.error_count.toLocaleString()}</div>
            </div>
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="text-sm text-muted-foreground">24 Jam</div>
              <div className="text-2xl font-bold">{stats.last_24h.toLocaleString()}</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-border bg-card">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <input
            type="number"
            placeholder="User ID"
            value={auditFilters.userId}
            onChange={(e) => { setAuditFilters({ userId: e.target.value }); pagination.reset(); }}
            className="px-3 py-1.5 rounded-lg border border-border bg-background w-28"
          />
          <input
            type="text"
            placeholder="Action"
            value={auditFilters.action}
            onChange={(e) => { setAuditFilters({ action: e.target.value }); pagination.reset(); }}
            className="px-3 py-1.5 rounded-lg border border-border bg-background w-28"
          />
          <input
            type="text"
            placeholder="Resource"
            value={auditFilters.resource}
            onChange={(e) => { setAuditFilters({ resource: e.target.value }); pagination.reset(); }}
            className="px-3 py-1.5 rounded-lg border border-border bg-background w-36"
          />
          <input
            type="number"
            placeholder="Status"
            value={auditFilters.statusCode}
            onChange={(e) => { setAuditFilters({ statusCode: e.target.value }); pagination.reset(); }}
            className="px-3 py-1.5 rounded-lg border border-border bg-background w-28"
          />
          <input
            type="text"
            placeholder="Cari email/path"
            value={auditFilters.q}
            onChange={(e) => { setAuditFilters({ q: e.target.value }); pagination.reset(); }}
            className="px-3 py-1.5 rounded-lg border border-border bg-background w-48"
          />
          {(auditFilters.userId || auditFilters.action || auditFilters.resource || auditFilters.statusCode || auditFilters.q) && (
            <button
              onClick={() => {
                setAuditFilters({ userId: "", action: "", resource: "", statusCode: "", q: "" });
                pagination.reset();
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Reset filter
            </button>
          )}
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <DataTable
          columns={columns}
          data={logs}
          emptyMessage="Tidak ada audit log"
          loading={loading}
          pageSize={pagination.limit}
          manualPagination
          pageIndex={pagination.page}
          pageCount={pagination.totalPages}
          totalItems={pagination.total || 0}
          onPageChange={pagination.goTo}
          enableGlobalFilter={false}
        />
      </div>
    </RequireAuth>
  );
}
