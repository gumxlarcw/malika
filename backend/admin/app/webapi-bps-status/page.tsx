"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import { AsyncStateMessages } from "@/components/ui";
import { useOffsetPagination } from "@/hooks";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import OverallStatusCard from "./_components/OverallStatusCard";
import CircuitBreakerCard from "./_components/CircuitBreakerCard";
import PerFamilyTable from "./_components/PerFamilyTable";
import HistoryChart from "./_components/HistoryChart";
import ProbeLogTable from "./_components/ProbeLogTable";
import ProbeNowButton from "./_components/ProbeNowButton";
import type { StatusResponse, HistoryResponse, LogsResponse, EndpointFamily } from "./types";

export default function WebapiBpsStatusPage() {
  const pagination = useOffsetPagination(50);
  const [familyFilter, setFamilyFilter] = useState<EndpointFamily | "">("");
  const [statusFilter, setStatusFilter] = useState<"" | "ok" | "error">("");
  const [kindFilter, setKindFilter] = useState<"" | "scheduled" | "manual">("");

  const status = useQuery<StatusResponse>({
    queryKey: ["webapi-bps", "status"],
    queryFn: () => api.get("/webapi-bps/status").then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const history = useQuery<HistoryResponse>({
    queryKey: ["webapi-bps", "history", 24, "1h"],
    queryFn: () => api.get("/webapi-bps/history?hours=24&bucket=1h").then(r => r.data),
    refetchInterval: 60_000,
  });

  const logs = useQuery<LogsResponse>({
    queryKey: ["webapi-bps", "logs", familyFilter, statusFilter, kindFilter, pagination.offset, pagination.limit],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("limit", String(pagination.limit));
      qs.set("offset", String(pagination.offset));
      if (familyFilter) qs.set("family", familyFilter);
      if (statusFilter) qs.set("status", statusFilter);
      if (kindFilter) qs.set("kind", kindFilter);
      return api.get(`/webapi-bps/logs?${qs.toString()}`).then(r => {
        pagination.setTotal(r.data.total);
        return r.data;
      });
    },
    placeholderData: (prev) => prev,
  });

  const error = [status.error, history.error, logs.error]
    .map(e => e ? getErrorMessage(e, "Gagal memuat") : null)
    .filter(Boolean)[0] as string | undefined;

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Status WebAPI BPS</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { status.refetch(); history.refetch(); logs.refetch(); }}
              disabled={status.isFetching || history.isFetching || logs.isFetching}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${(status.isFetching || history.isFetching || logs.isFetching) ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <ProbeNowButton />
          </div>
        </div>

        {error && <AsyncStateMessages error={error} success="" onClearError={() => {}} onClearSuccess={() => {}} />}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {status.data
            ? <OverallStatusCard status={status.data} />
            : <div className="rounded-2xl border border-border bg-card p-4 h-40 animate-pulse" />}
          {status.data
            ? <CircuitBreakerCard circuit={status.data.circuit} />
            : <div className="rounded-2xl border border-border bg-card p-4 h-40 animate-pulse" />}
        </div>

        <HistoryChart buckets={history.data?.buckets || []} />

        <PerFamilyTable perFamily={status.data?.perFamily || []} />

        <ProbeLogTable
          logs={logs.data?.logs || []}
          total={pagination.total ?? 0}
          offset={pagination.offset}
          limit={pagination.limit}
          loading={logs.isLoading}
          onOffsetChange={pagination.setOffset}
          familyFilter={familyFilter}
          setFamilyFilter={(v) => { setFamilyFilter(v); pagination.reset(); }}
          statusFilter={statusFilter}
          setStatusFilter={(v) => { setStatusFilter(v); pagination.reset(); }}
          kindFilter={kindFilter}
          setKindFilter={(v) => { setKindFilter(v); pagination.reset(); }}
        />
      </div>
    </RequireAuth>
  );
}
