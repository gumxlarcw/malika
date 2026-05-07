"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import { 
  Bell, Trash2, Send, RefreshCw, AlertTriangle, Plus, 
  ChevronLeft, ChevronRight, ExternalLink, Search 
} from "lucide-react";

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  unique_key: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface DataSource {
  id: number;
  name: string;
  type: string;
  category: string;
}

export default function NotificationsControlPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ===== Notifications Table State =====
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit] = useState(20);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [tableLoading, setTableLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>("");

  // ===== Custom Notification State =====
  const [customTitle, setCustomTitle] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [customType, setCustomType] = useState("info");
  const [redirectType, setRedirectType] = useState("none");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [brsId, setBrsId] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [datasources, setDatasources] = useState<DataSource[]>([]);
  const [dsSearch, setDsSearch] = useState("");

  // ===== Clear Options =====
  const [clearAll, setClearAll] = useState(false);
  const [clearType, setClearType] = useState<"" | "pressrelease" | "data">("");

  // ===== Test Options =====
  const [testTitle, setTestTitle] = useState("Test Notification");
  const [testBody, setTestBody] = useState("This is a test push notification");

  // ===== Rebroadcast =====
  const [rebroadcastId, setRebroadcastId] = useState("");

  // ===== Fetch Notifications =====
  const fetchNotifications = useCallback(async () => {
    setTableLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(page * limit));
      if (filterType) params.set("type", filterType);

      const { data } = await api.get(`/notifications/admin/list?${params.toString()}`);
      setNotifications(data.items || []);
      setTotal(data.total || 0);
    } catch (e: unknown) {
      console.error("Failed to fetch notifications:", e);
    } finally {
      setTableLoading(false);
    }
  }, [page, limit, filterType]);

  // ===== Fetch Datasources =====
  const fetchDatasources = useCallback(async () => {
    try {
      const { data } = await api.get("/datasource");
      const sources = data.datasources || data || [];
      setDatasources(sources);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchDatasources();
  }, [fetchNotifications, fetchDatasources]);

  // ===== Selection Handlers =====
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map((n) => n.id)));
    }
  };

  // ===== Delete Selected =====
  async function handleDeleteSelected() {
    if (selectedIds.size === 0) {
      setError("Pilih notifikasi yang ingin dihapus");
      return;
    }
    if (!window.confirm(`Hapus ${selectedIds.size} notifikasi?`)) return;

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const ids = Array.from(selectedIds);
      const { data } = await api.delete("/notifications/admin/delete", { data: { ids } });
      setSuccess(`Berhasil hapus ${data.deleted} notifikasi`);
      setSelectedIds(new Set());
      fetchNotifications();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal hapus notifikasi"));
    } finally {
      setLoading(false);
    }
  }

  // ===== Create Custom Notification =====
  async function handleCreateCustom() {
    if (!customTitle.trim()) {
      setError("Judul wajib diisi");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const payload: Record<string, unknown> = {
        title: customTitle,
        message: customMessage || null,
        type: customType,
        redirectType,
      };

      if (redirectType === "data" && selectedSourceId) {
        payload.sourceId = Number(selectedSourceId);
      } else if (redirectType === "pressrelease" && brsId) {
        payload.brsId = brsId;
      } else if (redirectType === "custom" && customUrl) {
        payload.customUrl = customUrl;
      }

      const { data } = await api.post("/notifications/admin/create", payload);
      setSuccess(`Notifikasi dibuat (ID: ${data.id}) → ${data.link}`);
      
      // Reset form
      setCustomTitle("");
      setCustomMessage("");
      setRedirectType("none");
      setSelectedSourceId("");
      setBrsId("");
      setCustomUrl("");
      
      fetchNotifications();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal membuat notifikasi"));
    } finally {
      setLoading(false);
    }
  }

  // ===== Clear Notifications =====
  async function handleClear() {
    if (!clearAll && !clearType) {
      setError("Pilih opsi clear: semua atau berdasarkan type");
      return;
    }
    if (!window.confirm(`Clear notifications${clearAll ? " (SEMUA)" : ` type=${clearType}`}?`)) return;

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const params = new URLSearchParams();
      if (clearAll) params.set("all", "true");
      if (clearType) params.set("type", clearType);

      const { data } = await api.delete(`/notifications/admin/clear?${params.toString()}`);
      setSuccess(data.message || `Cleared ${data.deleted} notifications`);
      fetchNotifications();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal clear notifications"));
    } finally {
      setLoading(false);
    }
  }

  // ===== Test Push =====
  async function handleTest() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post("/notifications/admin/test", {
        title: testTitle,
        body: testBody,
      });
      setSuccess(data.message || "Test notification sent");
      fetchNotifications();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal kirim test notification"));
    } finally {
      setLoading(false);
    }
  }

  // ===== Emit Latest Merged =====
  async function handleEmitLatest() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post("/notifications/admin/emit-latest-merged");
      setSuccess(data.message || "Emit latest merged triggered");
      fetchNotifications();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal emit latest merged"));
    } finally {
      setLoading(false);
    }
  }

  // ===== Rebroadcast =====
  async function handleRebroadcast() {
    if (!rebroadcastId.trim()) {
      setError("ID atau uniqueKey wajib diisi");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const isNumeric = /^\d+$/.test(rebroadcastId.trim());
      const params = isNumeric ? `id=${rebroadcastId.trim()}` : `uniqueKey=${encodeURIComponent(rebroadcastId.trim())}`;
      const { data } = await api.post(`/notifications/admin/rebroadcast?${params}`);
      setSuccess(data.message || "Rebroadcast triggered");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal rebroadcast"));
    } finally {
      setLoading(false);
    }
  }

  // ===== Filtered Datasources =====
  const filteredDatasources = dsSearch.trim()
    ? datasources.filter((ds) => 
        ds.name.toLowerCase().includes(dsSearch.toLowerCase()) ||
        String(ds.id) === dsSearch
      )
    : datasources;

  // ===== Pagination =====
  const totalPages = Math.ceil(total / limit);

  return (
    <RequireAuth>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Notifications Control</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Kelola notifikasi: lihat daftar, hapus, buat custom, test push, emit latest, rebroadcast.
        </p>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}
        {loading && <LoadingSpinner label="Processing..." />}

        {/* ===== Notifications Table ===== */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-semibold text-lg">Daftar Notifikasi</h2>
            <div className="flex items-center gap-3">
              <select
                value={filterType}
                onChange={(e) => { setFilterType(e.target.value); setPage(0); }}
                className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">Semua Type</option>
                <option value="data">Data</option>
                <option value="pressrelease">Press Release</option>
                <option value="publication">Publication</option>
                <option value="info">Info</option>
              </select>
              <button
                onClick={fetchNotifications}
                className="p-2 rounded-lg border border-border hover:bg-muted transition-colors"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Bulk Actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} dipilih
              </span>
              <button
                onClick={handleDeleteSelected}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 transition-colors flex items-center gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Hapus
              </button>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            {tableLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">Tidak ada notifikasi</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === notifications.length && notifications.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </th>
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Judul</th>
                    <th className="text-left p-2 max-w-[200px]">Pesan</th>
                    <th className="text-left p-2">Link</th>
                    <th className="text-left p-2">Tanggal</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((n) => (
                    <tr key={n.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(n.id)}
                          onChange={() => toggleSelect(n.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="p-2 font-mono text-xs">{n.id}</td>
                      <td className="p-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          n.type === 'data' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                          n.type === 'pressrelease' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          n.type === 'publication' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                          'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                          {n.type}
                        </span>
                      </td>
                      <td className="p-2 max-w-[200px] truncate" title={n.title}>{n.title}</td>
                      <td className="p-2 max-w-[200px] truncate text-muted-foreground" title={n.message || ""}>
                        {n.message || "-"}
                      </td>
                      <td className="p-2">
                        {n.link ? (
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline flex items-center gap-1"
                            title={n.link}
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span className="max-w-[100px] truncate">{n.link}</span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap">
                        {new Date(n.created_at).toLocaleString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Menampilkan {page * limit + 1}-{Math.min((page + 1) * limit, total)} dari {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span>
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ===== Create Custom Notification ===== */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Buat Notifikasi Custom
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Judul *</label>
                <input
                  type="text"
                  placeholder="Judul notifikasi"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Pesan (opsional)</label>
                <textarea
                  placeholder="Isi pesan notifikasi"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                >
                  <option value="info">Info</option>
                  <option value="data">Data</option>
                  <option value="pressrelease">Press Release</option>
                  <option value="publication">Publication</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Redirect ke</label>
                <select
                  value={redirectType}
                  onChange={(e) => setRedirectType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                >
                  <option value="none">Tidak ada (default /notifications)</option>
                  <option value="data">Data Statistik (Indikator)</option>
                  <option value="pressrelease">Press Release</option>
                  <option value="custom">Custom URL</option>
                </select>
              </div>

              {redirectType === "data" && (
                <div>
                  <label className="block text-sm font-medium mb-1">Pilih Indikator</label>
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Cari datasource..."
                        value={dsSearch}
                        onChange={(e) => setDsSearch(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm"
                      />
                    </div>
                    <select
                      value={selectedSourceId}
                      onChange={(e) => setSelectedSourceId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background max-h-48"
                      size={5}
                    >
                      <option value="">-- Pilih datasource --</option>
                      {filteredDatasources.slice(0, 50).map((ds) => (
                        <option key={ds.id} value={ds.id}>
                          [{ds.id}] {ds.name}
                        </option>
                      ))}
                    </select>
                    {filteredDatasources.length > 50 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Menampilkan 50 dari {filteredDatasources.length}. Gunakan pencarian.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {redirectType === "pressrelease" && (
                <div>
                  <label className="block text-sm font-medium mb-1">BRS ID (opsional)</label>
                  <input
                    type="text"
                    placeholder="ID BRS (kosongkan untuk halaman utama)"
                    value={brsId}
                    onChange={(e) => setBrsId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                  />
                </div>
              )}

              {redirectType === "custom" && (
                <div>
                  <label className="block text-sm font-medium mb-1">Custom URL *</label>
                  <input
                    type="text"
                    placeholder="/path atau https://..."
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                  />
                </div>
              )}

              <button
                onClick={handleCreateCustom}
                disabled={loading || !customTitle.trim()}
                className="w-full px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors mt-4"
              >
                Kirim Notifikasi Custom
              </button>
            </div>
          </div>
        </div>

        {/* ===== Other Controls (Grid) ===== */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Clear Notifications */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-500" />
              Clear Notifications
            </h2>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={clearAll}
                  onChange={(e) => {
                    setClearAll(e.target.checked);
                    if (e.target.checked) setClearType("");
                  }}
                  className="rounded"
                />
                <span>Clear ALL notifications</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Or by type:</span>
                <select
                  value={clearType}
                  onChange={(e) => {
                    setClearType(e.target.value as "" | "pressrelease" | "data");
                    if (e.target.value) setClearAll(false);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-border bg-background"
                  disabled={clearAll}
                >
                  <option value="">-- Select type --</option>
                  <option value="pressrelease">Press Release</option>
                  <option value="data">Data</option>
                </select>
              </div>
              <button
                onClick={handleClear}
                disabled={loading || (!clearAll && !clearType)}
                className="w-full px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                Clear Notifications
              </button>
            </div>
          </div>

          {/* Test Push Notification */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Send className="h-4 w-4 text-blue-500" />
              Test Push Notification
            </h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Title"
                value={testTitle}
                onChange={(e) => setTestTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
              <textarea
                placeholder="Body"
                value={testBody}
                onChange={(e) => setTestBody(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background resize-none"
              />
              <button
                onClick={handleTest}
                disabled={loading}
                className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Send Test Notification
              </button>
            </div>
          </div>

          {/* Emit Latest Merged */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-green-500" />
              Emit Latest Merged Cache
            </h2>
            <p className="text-sm text-muted-foreground">
              Trigger notification for recently updated merged cache entries.
            </p>
            <button
              onClick={handleEmitLatest}
              disabled={loading}
              className="w-full px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Emit Latest
            </button>
          </div>

          {/* Rebroadcast */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Rebroadcast Failed Notification
            </h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Notification ID or uniqueKey"
                value={rebroadcastId}
                onChange={(e) => setRebroadcastId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
              <button
                onClick={handleRebroadcast}
                disabled={loading || !rebroadcastId.trim()}
                className="w-full px-4 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 transition-colors"
              >
                Rebroadcast
              </button>
            </div>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
