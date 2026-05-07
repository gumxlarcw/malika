"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import RequireAuth from "@/components/RequireAuth";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";

type SummaryData = {
  periods?: string[];
  available_periods?: string[];
  data?: Array<Record<string, unknown>>;
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  period?: string;
};

export default function DatasourceDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [reindexing, setReindexing] = useState(false);
  const [preferMerged, setPreferMerged] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [reindexResult, setReindexResult] = useState<unknown>(null);

  useEffect(() => {
    if (!id) return;
    async function load() {
      setLoading(true);
      setError("");
      setSuccess("");
      try {
        const { data } = await api.get(`/summary/${id}`);
        setSummary(typeof data === "object" && data ? (data as SummaryData) : null);
        // pick latest period if available
        const periods: string[] =
          (typeof (data as SummaryData | undefined)?.periods !== "undefined" && Array.isArray((data as SummaryData).periods)
            ? (data as SummaryData).periods!
            : Array.isArray((data as SummaryData | undefined)?.available_periods)
            ? (data as SummaryData).available_periods!
            : []) || [];
        if (periods.length) setSelectedPeriod(periods[0]);
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Gagal memuat summary."));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function reindexSearchMetadataFromCache() {
    if (!id) return;
    if (!confirm(`Reindex Search Metadata (cache) untuk datasource #${id}?`)) return;
    setError("");
    setSuccess("");
    setReindexResult(null);
    setReindexing(true);
    try {
      const res = await api.post(`/datasource/${encodeURIComponent(id)}/search-metadata/reindex`, {
        preferMerged: Boolean(preferMerged),
        dryRun: Boolean(dryRun),
      });
      const data: unknown = res.data;
      setReindexResult(data);
      const result = typeof data === "object" && data && "result" in data ? (data as { result?: unknown }).result : undefined;

      const inserted =
        typeof result === "object" && result && "inserted" in result
          ? Number((result as { inserted?: unknown }).inserted) || 0
          : 0;
      const ok = typeof result === "object" && result && (result as { ok?: unknown }).ok === true;
      const from =
        typeof result === "object" && result && typeof (result as { from?: unknown }).from === "string"
          ? (result as { from: string }).from
          : "";

      setSuccess(`Reindex Search Metadata selesai: ok=${ok}, inserted=${inserted}${from ? ", from=" + from : ""}`);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal reindex Search Metadata."));
    } finally {
      setReindexing(false);
    }
  }

  const rows = (() => {
    if (!summary) return [];
    const data = Array.isArray(summary.data) ? summary.data : Array.isArray(summary.rows) ? summary.rows : [];
    const summaryPeriod = typeof summary.period === "string" ? summary.period : "";

    // If period is present inside data entries, filter by selectedPeriod
    if (selectedPeriod) {
      return data.filter((d) => {
        const rowPeriod = typeof d["period"] === "string" ? (d["period"] as string) : "";
        return rowPeriod === selectedPeriod || summaryPeriod === selectedPeriod;
      });
    }
    return data;
  })();

  const columns: string[] = (summary?.columns && Array.isArray(summary.columns) ? summary.columns : Object.keys(rows[0] || {})) as string[];
  const periods: string[] =
    (summary?.periods && Array.isArray(summary.periods)
      ? summary.periods
      : summary?.available_periods && Array.isArray(summary.available_periods)
      ? summary.available_periods
      : []) as string[];

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold">Datasource #{id} — Summary</h1>
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={preferMerged} onChange={(e) => setPreferMerged(e.target.checked)} disabled={reindexing} />
              Prefer merged
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} disabled={reindexing} />
              Dry run
            </label>
            <button
              className="px-3 py-2 rounded border border-border bg-secondary text-secondary-foreground disabled:opacity-50"
              onClick={reindexSearchMetadataFromCache}
              disabled={reindexing}
              title="Bangun ulang index metadata search dari cache (judul kolom + nilai string)."
            >
              {reindexing ? "Reindexing…" : "Reindex Search Metadata"}
            </button>
          </div>
        </div>
        {loading && <LoadingSpinner label="Memuat ringkasan…" />}
        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}
        {!loading && !error && (
          <>
            {periods.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-sm text-muted-foreground">Periode:</label>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="border rounded px-2 py-1 w-full sm:w-auto"
                >
                  {periods.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
              <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-muted">
                      {columns.map((col) => (
                        <th key={col} className="px-4 py-2 text-left">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r:any, idx:number) => (
                      <tr key={idx} className="border-t border-border">
                        {columns.map((col) => (
                          <td key={col} className="px-4 py-2">{String(r[col] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {reindexResult ? (
              <div className="rounded-xl border border-border bg-card text-card-foreground p-3">
                <div className="text-xs text-muted-foreground mb-2">Response (ringkas)</div>
                <pre className="text-xs overflow-auto max-h-64 bg-muted rounded p-2">{JSON.stringify(reindexResult, null, 2)}</pre>
              </div>
            ) : null}
          </>
        )}
      </div>
    </RequireAuth>
  );
}
