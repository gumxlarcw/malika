"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import { RefreshCw } from "lucide-react";

export default function CachePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  
  // State untuk filter & preview
  const [selectedSource, setSelectedSource] = useState<any>(null);
  const [keyword, setKeyword] = useState("");
  const [period, setPeriod] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [previewData, setPreviewData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get("/datasource");
        const list = Array.isArray(data) ? data : data?.rows || [];
        setRows(list);
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Gagal memuat data. Pastikan sudah login."));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleFetch = async () => {
    if (!selectedSource) {
      setFetchError("Pilih sumber data terlebih dahulu");
      return;
    }

    // Validate input berdasarkan tipe
    if (selectedSource.type === "pressrelease" && !keyword.trim()) {
      setFetchError("Masukkan keyword (contoh: inflasi, ntp)");
      return;
    }

    if (["dynamic", "interop", "exim"].includes(selectedSource.type) && !period.trim()) {
      setFetchError("Masukkan periode");
      return;
    }

    setFetching(true);
    setFetchError("");
    setPreviewData(null);

    try {
      let url = "";
      
      if (selectedSource.type === "pressrelease") {
        url = `/pressrelease/${selectedSource.id}?keyword=${encodeURIComponent(keyword.trim())}`;
      } else if (selectedSource.type === "dynamic") {
        url = `/dynamic/${selectedSource.id}?period=${encodeURIComponent(period.trim())}`;
      } else if (selectedSource.type === "interop") {
        url = `/interop/${selectedSource.id}?period=${encodeURIComponent(period.trim())}`;
      } else {
        setFetchError(`Tipe sumber ${selectedSource.type} belum didukung di preview ini`);
        return;
      }

      const { data } = await api.get(url);
      setPreviewData(data);
    } catch (e: unknown) {
      setFetchError(getErrorMessage(e, "Gagal mengambil data"));
      console.error("Fetch error:", e);
    } finally {
      setFetching(false);
    }
  };

  const handleSourceChange = (sourceId: number) => {
    const src = rows.find(r => r.id === sourceId);
    setSelectedSource(src);
    setKeyword("");
    setPeriod("");
    setPreviewData(null);
    setFetchError("");
    setSuccess("");
  };

  const handleForceRefresh = async () => {
    if (!selectedSource) {
      setFetchError("Pilih sumber data terlebih dahulu");
      return;
    }
    
    const periodVal = selectedSource.type === "pressrelease" ? keyword.trim() : period.trim();
    if (!periodVal) {
      setFetchError(selectedSource.type === "pressrelease" ? "Masukkan keyword" : "Masukkan periode");
      return;
    }

    if (!window.confirm(`Force refresh cache untuk ${selectedSource.name}?`)) return;

    setRefreshing(true);
    setFetchError("");
    setSuccess("");
    try {
      await api.post(`/cache/refresh/${selectedSource.id}?period=${encodeURIComponent(periodVal)}`);
      setSuccess(`Cache refreshed for ${selectedSource.name} (${periodVal})`);
    } catch (e: unknown) {
      setFetchError(getErrorMessage(e, "Gagal refresh cache"));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <RequireAuth>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Processed Cache & Data Preview</h1>
          <p className="text-sm text-muted-foreground">Lihat dan kelola cache data terproses. Gunakan fitur preview untuk mengambil data terbaru.</p>
        </div>

        {/* Daftar Datasource */}
        <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
          <div className="p-4 border-b border-border bg-muted">
            <h2 className="font-semibold">Sumber Data</h2>
          </div>
          {loading && <LoadingSpinner label="Memuat sumber data…" />}
          {error && <div className="p-4"><Alert variant="error">{error}</Alert></div>}
          {success && <div className="p-4"><Alert variant="success">{success}</Alert></div>}
          {!loading && !error && (
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    <th className="px-4 py-2 text-left">ID</th>
                    <th className="px-4 py-2 text-left">Nama</th>
                    <th className="px-4 py-2 text-left">Tipe</th>
                    <th className="px-4 py-2 text-left">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r:any) => (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/50">
                      <td className="px-4 py-2">{r.id}</td>
                      <td className="px-4 py-2">{r.name}</td>
                      <td className="px-4 py-2">
                        <span className="inline-block px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-semibold">
                          {r.type}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => handleSourceChange(r.id)}
                          className={`px-3 py-1 rounded text-sm font-medium transition ${
                            selectedSource?.id === r.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted hover:bg-muted/80"
                          }`}
                        >
                          {selectedSource?.id === r.id ? "✓ Dipilih" : "Pilih"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Filter & Fetch Section */}
        {selectedSource && (
          <div className="rounded-xl border border-border bg-card text-card-foreground p-4 space-y-4">
            <h2 className="font-semibold">Preview Data - {selectedSource.name}</h2>
            
            <div className="space-y-3">
              {/* Kondisional input berdasarkan tipe */}
              {selectedSource.type === "pressrelease" ? (
                <div>
                  <label className="block text-sm font-medium mb-1">Keyword</label>
                  <input
                    type="text"
                    placeholder="Contoh: inflasi, ntp, ihk"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Masukkan keyword untuk mencari press release. Sistem akan mengambil semua halaman dan detail.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1">Periode</label>
                  <input
                    type="text"
                    placeholder="Contoh: 2025-12 atau 2025"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Format: YYYY-MM untuk monthly atau YYYY untuk yearly
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleFetch}
                  disabled={fetching || refreshing}
                  className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground px-4 py-2 rounded-md font-medium transition"
                >
                  {fetching ? "Mengambil data..." : "Ambil & Preview Data"}
                </button>
                <button
                  onClick={handleForceRefresh}
                  disabled={fetching || refreshing}
                  className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md font-medium transition"
                  title="Force refresh cache dari API upstream"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? "Refreshing..." : "Force Refresh"}
                </button>
              </div>

              {success && (
                <Alert variant="success">{success}</Alert>
              )}

              {fetchError && (
                <Alert variant="error">{fetchError}</Alert>
              )}
            </div>
          </div>
        )}

        {/* Preview Results */}
        {previewData && (
          <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
            <div className="p-4 border-b border-border bg-muted">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="font-semibold">{previewData.data?.source || "Data Preview"}</h2>
                  <p className="text-xs text-muted-foreground">
                    {previewData.cached ? "✓ Dari Cache" : "Dari API"}
                    {previewData.updated && " (Diperbarui)"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    Total: <span className="font-semibold">{previewData.data?.data?.length || 0}</span> item
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Update: {new Date(previewData.data?.last_update).toLocaleString('id-ID')}
                  </p>
                </div>
              </div>
            </div>

            {previewData.data?.data && previewData.data.data.length > 0 ? (
              <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-muted border-b border-border">
                      {previewData.data.columns.map((col: any) => (
                        <th key={col.key} className="px-3 py-2 text-left font-semibold">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.data.data.slice(0, 20).map((row: any, idx: number) => (
                      <tr key={idx} className="border-t border-border hover:bg-muted/50">
                        {previewData.data.columns.map((col: any) => (
                          <td key={col.key} className="px-3 py-2 max-w-xs truncate">
                            {col.key.includes('url') || col.key.includes('_url') ? (
                              row[col.key] ? (
                                <a 
                                  href={row[col.key]} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline"
                                >
                                  Link ↗
                                </a>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )
                            ) : col.key === 'abstract' ? (
                              <div className="text-xs line-clamp-2">
                                {String(row[col.key] || '-').replace(/<[^>]*>/g, ' ').trim() || '-'}
                              </div>
                            ) : (
                              <span>{row[col.key] || '-'}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center text-muted-foreground text-sm">
                Tidak ada data
              </div>
            )}

            {previewData.data?.data && previewData.data.data.length > 20 && (
              <div className="p-3 border-t border-border bg-muted text-xs text-muted-foreground text-center">
                Menampilkan 20 dari {previewData.data.data.length} item
              </div>
            )}
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
