"use client";
import { useEffect, useCallback, useState } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import { fmt } from "@/lib/formatters";
import RequireAuth from "@/components/RequireAuth";
import StatCard from "@/components/StatCard";
import { DataTable, OffsetPagination, AsyncStateMessages, ConfirmModal } from "@/components/ui";
import type { Column } from "@/components/ui/DataTable";
import { useAsyncState, useOffsetPagination } from "@/hooks";
import { Smartphone, Trash2, RefreshCw } from "lucide-react";

interface Subscription {
  id: number;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
}

export default function PushSubscribersPage() {
  const { loading, error, success, startLoading, finishWithError, setLoading, setError, setSuccess } = useAsyncState(true);
  const pagination = useOffsetPagination(50);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    startLoading();
    try {
      const { data } = await api.get(`/push/subscriptions?limit=${pagination.limit}&offset=${pagination.offset}`);
      setSubscriptions(data.subscriptions || []);
      pagination.setTotal(data.total || 0);
      setLoading(false);
    } catch (e: unknown) {
      finishWithError(getErrorMessage(e, "Gagal memuat push subscriptions"));
    }
  }, [pagination.limit, pagination.offset, startLoading, finishWithError, setLoading, pagination]);

  useEffect(() => {
    load();
  }, [pagination.offset]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/push/subscriptions/${deleteTarget.id}`);
      setSuccess("Subscription deleted");
      setDeleteTarget(null);
      load();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal menghapus subscription"));
    } finally {
      setDeleting(false);
    }
  }

  function parseUserAgent(ua: string | null): string {
    if (!ua) return "-";
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Safari")) return "Safari";
    if (ua.includes("Edge")) return "Edge";
    return ua.slice(0, 30) + "...";
  }

  function parseEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      return url.hostname;
    } catch {
      return endpoint.slice(0, 40) + "...";
    }
  }

  const columns: Column<Subscription>[] = [
    { key: "id", label: "ID", render: (sub) => <span className="font-mono text-xs">{sub.id}</span> },
    { key: "endpoint", label: "Service", render: (sub) => <span className="text-xs text-muted-foreground">{parseEndpoint(sub.endpoint)}</span> },
    { key: "user_agent", label: "Browser", render: (sub) => parseUserAgent(sub.user_agent) },
    { key: "created_at", label: "Subscribed", render: (sub) => <span className="text-muted-foreground">{fmt(sub.created_at)}</span> },
    {
      key: "actions",
      label: "Aksi",
      className: "text-center",
      render: (sub) => (
        <button
          onClick={(e) => { e.stopPropagation(); setDeleteTarget(sub); }}
          className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          title="Hapus subscription"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Smartphone className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Push Subscribers</h1>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <AsyncStateMessages error={error} success={success} onClearError={() => setError("")} onClearSuccess={() => setSuccess("")} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard title="Total Subscribers" value={(pagination.total || 0).toLocaleString()} />
          <StatCard title="Showing" value={`${pagination.offset + 1} - ${Math.min(pagination.offset + pagination.limit, pagination.total || 0)}`} />
        </div>

        <DataTable
          columns={columns}
          data={subscriptions}
          keyField="id"
          loading={loading}
          loadingRows={5}
          emptyMessage="Tidak ada push subscribers"
        />

        <OffsetPagination
          offset={pagination.offset}
          limit={pagination.limit}
          total={pagination.total}
          onOffsetChange={pagination.setOffset}
        />

        <ConfirmModal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
          title="Hapus Subscription"
          message={`Hapus subscription ID ${deleteTarget?.id}?`}
          confirmLabel="Hapus"
          confirmVariant="danger"
          loading={deleting}
        />
      </div>
    </RequireAuth>
  );
}
