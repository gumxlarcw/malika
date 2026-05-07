"use client";
import { useEffect, useState, Fragment } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";

interface PeriodItem {
  id: number;
  period_value: string;
  api_url_override: string;
}

interface SourceRow {
  id: number;
  name: string;
  type: string;
}

export default function PeriodMapPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<SourceRow[]>([]);
  
  // State for "generate all"
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generateAllResult, setGenerateAllResult] = useState<{ ok: boolean; message: string } | null>(null);
  
  // State for individual generating
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  
  // State for viewing period map detail
  const [viewingSourceId, setViewingSourceId] = useState<number | null>(null);
  const [periodList, setPeriodList] = useState<PeriodItem[]>([]);
  const [loadingPeriodList, setLoadingPeriodList] = useState(false);

  useEffect(() => {
    loadSources();
  }, []);

  async function loadSources() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/datasource");
      const list = Array.isArray(data) ? data : data?.rows || [];
      // Filter only dynamic/interop types (can have period map)
      const filtered = list.filter((r: SourceRow) => r.type === "dynamic" || r.type === "interop");
      setRows(filtered);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat data. Pastikan sudah login."));
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateOne(id: number) {
    setGeneratingId(id);
    try {
      await api.get(`/period/generate/${id}`);
      alert(`Berhasil generate period map untuk source ${id}`);
      // If currently viewing this source, refresh the list
      if (viewingSourceId === id) {
        await handleViewPeriodMap(id, true);
      }
    } catch (e: any) {
      alert(e?.response?.data?.error || "Gagal generate period map");
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleGenerateAll() {
    setGeneratingAll(true);
    setGenerateAllResult(null);
    try {
      const { data } = await api.get("/period/generate-all");
      setGenerateAllResult({ ok: true, message: data.message || "Berhasil generate period map untuk semua sumber data" });
    } catch (e: any) {
      setGenerateAllResult({ ok: false, message: e?.response?.data?.error || "Gagal generate period map untuk semua sumber data" });
    } finally {
      setGeneratingAll(false);
    }
  }

  async function handleViewPeriodMap(id: number, forceReload = false) {
    if (viewingSourceId === id && !forceReload) {
      // Toggle off
      setViewingSourceId(null);
      setPeriodList([]);
      return;
    }
    
    setViewingSourceId(id);
    setLoadingPeriodList(true);
    setPeriodList([]);
    try {
      const { data } = await api.get(`/period/list/${id}`);
      setPeriodList(data.periods || []);
    } catch (e: any) {
      alert(e?.response?.data?.error || "Gagal memuat period map");
      setViewingSourceId(null);
    } finally {
      setLoadingPeriodList(false);
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Period Map</h1>
            <p className="text-sm text-muted-foreground">
              Generate dan lihat period map per sumber data (dynamic/interop).
            </p>
          </div>
          <button
            className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:bg-green-400 flex items-center gap-2"
            onClick={handleGenerateAll}
            disabled={generatingAll}
          >
            {generatingAll ? (
              <>
                <span className="animate-spin">⏳</span>
                Generating...
              </>
            ) : (
              <>Generate Period Map Keseluruhan</>
            )}
          </button>
        </div>

        {generateAllResult && (
          <Alert variant={generateAllResult.ok ? "success" : "error"}>
            {generateAllResult.message}
          </Alert>
        )}

        {loading && <LoadingSpinner label="Memuat sumber data…" />}
        {error && <Alert variant="error">{error}</Alert>}
        
        {!loading && !error && (
          <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-muted">
                    <th className="px-4 py-2 text-left">ID</th>
                    <th className="px-4 py-2 text-left">Nama</th>
                    <th className="px-4 py-2 text-left">Tipe</th>
                    <th className="px-4 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: SourceRow) => (
                    <Fragment key={r.id}>
                      <tr className="border-t border-border">
                        <td className="px-4 py-2">{r.id}</td>
                        <td className="px-4 py-2">{r.name}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            r.type === "dynamic" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                          }`}>
                            {r.type}
                          </span>
                        </td>
                        <td className="px-4 py-2 flex gap-2">
                          <button
                            className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 text-sm"
                            onClick={() => handleGenerateOne(r.id)}
                            disabled={generatingId === r.id}
                          >
                            {generatingId === r.id ? "Generating..." : "Generate Map Period"}
                          </button>
                          <button
                            className={`px-3 py-1 rounded text-sm ${
                              viewingSourceId === r.id 
                                ? "bg-gray-600 text-white hover:bg-gray-700"
                                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
                            }`}
                            onClick={() => handleViewPeriodMap(r.id)}
                          >
                            {viewingSourceId === r.id ? "Tutup" : "Tampilkan Map Period"}
                          </button>
                        </td>
                      </tr>
                      {viewingSourceId === r.id && (
                        <tr className="bg-gray-50 dark:bg-gray-800">
                          <td colSpan={4} className="px-4 py-3">
                            {loadingPeriodList ? (
                              <div className="text-center text-sm text-gray-500">Memuat period map...</div>
                            ) : periodList.length === 0 ? (
                              <div className="text-center text-sm text-gray-500">
                                Belum ada period map. Klik &quot;Generate Map Period&quot; untuk membuat.
                              </div>
                            ) : (
                              <div>
                                <div className="text-sm font-medium mb-2">
                                  Period Map ({periodList.length} periode)
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                  {periodList.map((p) => (
                                    <div
                                      key={p.id}
                                      className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-sm"
                                    >
                                      <div className="font-medium">{p.period_value}</div>
                                      <div className="text-xs text-gray-500 truncate" title={p.api_url_override}>
                                        {p.api_url_override ? "✓ URL override" : "—"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
