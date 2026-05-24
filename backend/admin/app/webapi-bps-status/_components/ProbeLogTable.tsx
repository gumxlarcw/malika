"use client";
import { CheckCircle, XCircle, Filter } from "lucide-react";
import { DataTable, OffsetPagination } from "@/components/ui";
import type { Column } from "@/components/ui/DataTable";
import { formatDateTime, formatNumber, truncate } from "@/lib/formatters";
import type { ProbeLog, EndpointFamily } from "../types";

interface Props {
  logs: ProbeLog[];
  total: number;
  offset: number;
  limit: number;
  loading: boolean;
  onOffsetChange: (n: number) => void;
  familyFilter: EndpointFamily | "";
  setFamilyFilter: (v: EndpointFamily | "") => void;
  statusFilter: "" | "ok" | "error";
  setStatusFilter: (v: "" | "ok" | "error") => void;
  kindFilter: "" | "scheduled" | "manual";
  setKindFilter: (v: "" | "scheduled" | "manual") => void;
}

const columns: Column<ProbeLog>[] = [
  { key: "id", label: "ID", render: (l) => <span className="font-mono text-xs">{l.id}</span> },
  { key: "created_at", label: "Waktu", render: (l) => <span className="text-xs">{formatDateTime(l.created_at)}</span> },
  { key: "probe_kind", label: "Kind", render: (l) => <span className="text-xs">{l.probe_kind}</span> },
  { key: "endpoint_family", label: "Family", render: (l) => <span className="font-mono text-xs">{l.endpoint_family}</span> },
  {
    key: "ok", label: "Status", className: "text-center",
    render: (l) => l.ok
      ? <CheckCircle className="inline h-4 w-4 text-green-600" />
      : <XCircle className="inline h-4 w-4 text-red-600" />,
  },
  {
    key: "http_status", label: "HTTP",
    render: (l) => <span className="font-mono text-xs">{l.http_status ?? "-"}</span>,
  },
  {
    key: "latency_ms", label: "Latency",
    render: (l) => <span className="text-xs">{l.latency_ms != null ? `${formatNumber(l.latency_ms)} ms` : "-"}</span>,
  },
  {
    key: "error_code", label: "Error",
    render: (l) => <span className="text-xs">{l.error_code || "-"}</span>,
  },
  {
    key: "error_message", label: "Message",
    render: (l) => l.error_message
      ? <span className="block max-w-md truncate text-xs text-muted-foreground" title={l.error_message}>{truncate(l.error_message, 80)}</span>
      : <span className="text-xs text-muted-foreground">-</span>,
  },
];

export default function ProbeLogTable(props: Props) {
  const {
    logs, total, offset, limit, loading, onOffsetChange,
    familyFilter, setFamilyFilter, statusFilter, setStatusFilter, kindFilter, setKindFilter,
  } = props;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-border bg-card">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value as EndpointFamily | "")}
          className="px-3 py-1.5 rounded-lg border border-border bg-background"
        >
          <option value="">Semua Family</option>
          <option value="domain">domain</option>
          <option value="var">var</option>
          <option value="th">th</option>
          <option value="pressrelease">pressrelease</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | "ok" | "error")}
          className="px-3 py-1.5 rounded-lg border border-border bg-background"
        >
          <option value="">Semua Status</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as "" | "scheduled" | "manual")}
          className="px-3 py-1.5 rounded-lg border border-border bg-background"
        >
          <option value="">Semua Kind</option>
          <option value="scheduled">scheduled</option>
          <option value="manual">manual</option>
        </select>
        {(familyFilter || statusFilter || kindFilter) && (
          <button
            onClick={() => { setFamilyFilter(""); setStatusFilter(""); setKindFilter(""); }}
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
        emptyMessage="Tidak ada log probe"
      />

      <OffsetPagination
        offset={offset}
        limit={limit}
        total={total}
        onOffsetChange={onOffsetChange}
      />
    </div>
  );
}
