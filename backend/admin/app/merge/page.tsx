"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import RequireAuth from "@/components/RequireAuth";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";

type Datasource = {
  id: number;
  name?: string;
};

type Period = {
  th_id: number;
  year: string;
};

type MergeMeta = {
  signature: string;
  saved_primary: boolean;
  replicated_bps_cache: boolean;
  replicated_bps_indicator: boolean;
  indicator_table: string;
};

type MergeResponse = {
  source: { id: number; name?: string };
  metrics: string[];
  years: unknown[];
  last_update: string;
  table?: {
    columns?: Array<{ key: string; label: string }>;
    data?: Array<Record<string, unknown>>;
  };
  meta?: MergeMeta;
};

export default function MergePage() {
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [merged, setMerged] = useState<MergeResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [replicateStatus, setReplicateStatus] = useState<string>("");

  const productionTableName = useMemo(() => {
    if (!selectedId) return "";
    return `indikator_${Number(selectedId)}`;
  }, [selectedId]);

  const thIdsParam = useMemo(() => {
    if (!selectedYears.size) return "";
    const ids: string[] = [];
    for (const y of Array.from(selectedYears)) {
      const found = periods.find((p) => p.year === y);
      if (found) ids.push(String(found.th_id));
    }
    return ids.join(",");
  }, [selectedYears, periods]);

  const expectedProductionRows = useMemo(() => {
    const data = merged?.table?.data;
    if (!data || !Array.isArray(data)) return 0;
    const metricsLen = Array.isArray(merged?.metrics) ? merged.metrics.length : 0;
    return (data.length || 0) * metricsLen;
  }, [merged]);

  useEffect(() => {
    async function loadDatasources() {
      try {
        const { data } = await api.get<Datasource[]>("/datasource");
        setDatasources(data || []);
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Gagal memuat datasources"));
      }
    }
    loadDatasources();
  }, []);

  useEffect(() => {
    async function loadPeriods() {
      setPeriods([]);
      setSelectedYears(new Set());
      setMerged(null);
      setError("");
      setSuccess("");
      setReplicateStatus("");
      if (!selectedId) return;
      try {
        const { data } = await api.get<{ periods?: Period[] }>(`/period/available/${selectedId}`);
        setPeriods(data?.periods || []);
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Gagal memuat periods"));
      }
    }
    loadPeriods();
  }, [selectedId]);

  return (
    <RequireAuth>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Tarik & Gabungkan Processed</h1>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label className="text-sm text-muted-foreground">Indikator (Datasource):</label>
          <select
            className="border p-2 rounded w-full sm:w-auto"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">-- pilih --</option>
            {datasources.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name || `#${ds.id}`}
              </option>
            ))}
          </select>
        </div>

        {periods.length > 0 && (
          <div>
            <div className="mb-2 text-sm text-muted-foreground">Pilih tahun untuk digabung:</div>
            <div className="flex flex-wrap gap-2">
              {periods.map((p) => (
                <label key={p.th_id} className="inline-flex items-center gap-1 border rounded px-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedYears.has(p.year)}
                    onChange={(e) => {
                      const next = new Set(selectedYears);
                      if (e.target.checked) next.add(p.year);
                      else next.delete(p.year);
                      setSelectedYears(next);
                    }}
                  />
                  <span>{p.year}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <button
            className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50 w-full sm:w-auto"
            disabled={!selectedId || (!selectedYears.size && !periods.length)}
            onClick={async () => {
              if (!selectedId) return;
              setLoading(true);
              setError("");
              setSuccess("");
              setReplicateStatus("");
              setMerged(null);
              try {
                const params = thIdsParam ? { th_ids: thIdsParam } : { all: true };
                const { data } = await api.get<MergeResponse>(`/cache/merge/${selectedId}`, { params });
                setMerged(data);
              } catch (e: unknown) {
                setError(getErrorMessage(e, "Gagal gabungkan processed"));
              } finally {
                setLoading(false);
              }
            }}
          >
            Fetch & Gabungkan
          </button>
        </div>

        {loading && <LoadingSpinner label="Menggabungkan data…" />}
        {error && <Alert variant="error">{error}</Alert>}

        {merged && selectedId && (
          <div className="text-sm text-muted-foreground">
            Save akan menulis cache dan menyiapkan tabel produksi Metabase: <b>data_bps.{productionTableName}</b>
            {expectedProductionRows > 0 ? ` (perkiraan upsert: ${expectedProductionRows} baris)` : ""}
          </div>
        )}

        {merged && (
          <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
            <pre className="p-4 text-xs whitespace-pre-wrap">{JSON.stringify(merged, null, 2)}</pre>
          </div>
        )}

        {merged && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <button
              className="px-3 py-2 bg-green-600 text-white rounded disabled:opacity-50 w-full sm:w-auto"
              disabled={!selectedId || saving}
              onClick={async () => {
                if (!selectedId) return;
                setSaving(true);
                setError("");
                setSuccess("");
                setReplicateStatus("");

                try {
                  const params = thIdsParam
                    ? { th_ids: thIdsParam, save: true }
                    : { all: true, save: true };

                  const { data } = await api.get<MergeResponse>(`/cache/merge/${selectedId}`, { params });
                  setMerged(data);

                  const sig = data?.meta?.signature || (thIdsParam ? thIdsParam : "all");
                  const prodTable = data?.meta?.indicator_table || productionTableName;

                  setSuccess(`Berhasil disimpan (signature: ${sig}). Output produksi: data_bps.${prodTable}`);

                  let statusLine = "";
                  if (data?.meta) {
                    const parts: string[] = [];
                    parts.push(`Primary cache: ${data.meta.saved_primary ? "OK" : "Gagal"}`);
                    parts.push(
                      `data_bps.data_merged_cache: ${data.meta.replicated_bps_cache ? "OK" : "Skip/Gagal"}`
                    );
                    parts.push(
                      `data_bps.${prodTable}: ${data.meta.replicated_bps_indicator ? "OK" : "Skip/Gagal"}`
                    );
                    statusLine = parts.join(" | ");
                  }

                  // Verify read from primary merged cache
                  try {
                    const verify = await api.get<{ payload?: unknown }>(`/cache/merged/${selectedId}`, {
                      params: { signature: sig },
                    });
                    const ok = Boolean(verify?.data?.payload);
                    statusLine = statusLine
                      ? `${statusLine} | Verify read: ${ok ? "OK" : "Gagal"}`
                      : ok
                        ? "Verify read: OK"
                        : "Verify read: Gagal";
                  } catch {
                    statusLine = statusLine ? `${statusLine} | Verify read: Gagal` : "Verify read: Gagal";
                  }

                  if (statusLine) setReplicateStatus(statusLine);
                } catch (e: unknown) {
                  setError(getErrorMessage(e, "Gagal menyimpan merged ke database"));
                } finally {
                  setSaving(false);
                }
              }}
            >
              Simpan ke Database
            </button>
            {saving && <LoadingSpinner label="Menyimpan…" />}
          </div>
        )}

        {success && <Alert variant="success">{success}</Alert>}
        {replicateStatus && <Alert variant="info">{replicateStatus}</Alert>}
      </div>
    </RequireAuth>
  );
}
