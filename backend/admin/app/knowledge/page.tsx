"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import RequireAuth from "@/components/RequireAuth";
import { api } from "@/lib/axios";
import Alert from "@/components/Alert";
import LoadingSpinner from "@/components/LoadingSpinner";
import { getErrorMessage } from "@/lib/errors";

type EmbeddingStats = {
  total: number;
  embedded: number;
  notEmbedded: number;
  lastUpdated: string | null;
};

type DocumentStats = {
  total: number;
  ready: number;
  pending: number;
  error: number;
  processing: number;
  rootDocuments: number;
  chunks: number;
  totalChars: number;
  maxChars: number;
  maxReturnToAi: number;
  chunkSize: number;
  chunkOverlap: number;
};

type DatasourceEmbedding = {
  id: number;
  name: string;
  type: string;
  hasEmbedding: boolean;
  embeddingUpdatedAt: string | null;
  textLength: number;
};

type KnowledgeDocument = {
  id: number;
  title: string;
  description?: string;
  category?: string;
  source_type: "text" | "pdf" | "pdf-ocr" | "url";
  source_filename?: string;
  content_length: number;
  status: "pending" | "processing" | "ready" | "error";
  chunks: number;
  hasEmbedding: boolean;
  embedding_updated_at?: string;
  created_at: string;
};

type SearchResult = {
  id: number;
  name: string;
  type: string;
  similarity: number;
  description?: string;
};

type Tab = "datasources" | "documents";

export default function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<Tab>("datasources");
  
  // Datasource states
  const [stats, setStats] = useState<EmbeddingStats | null>(null);
  const [datasources, setDatasources] = useState<DatasourceEmbedding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Document states
  const [docStats, setDocStats] = useState<DocumentStats | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Upload states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadType, setUploadType] = useState<"text" | "pdf">("text");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForceOcr, setUploadForceOcr] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Embed all state
  const [embedAllRunning, setEmbedAllRunning] = useState(false);

  // Single embed state
  const [embeddingId, setEmbeddingId] = useState<number | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDuration, setSearchDuration] = useState<number | null>(null);

  // Auto-sync banner state (read from /knowledge/sync/stats)
  type SyncBannerState = {
    enabled: boolean;
    schedule: string;
    lastRunAt: string | null;
    nextRunAt: string | null;
    running: boolean;
    lastResult: {
      success: boolean;
      brs?: { indexed: number; errors: number };
      publikasi?: { indexed: number; errors: number };
    } | null;
  } | null;
  const [syncBanner, setSyncBanner] = useState<SyncBannerState>(null);

  // Filter state
  const [filterEmbedded, setFilterEmbedded] = useState<"all" | "yes" | "no">("all");
  const [filterType, setFilterType] = useState<string>("all");

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get("/knowledge/stats");
      setStats(res.data);
    } catch (e) {
      console.error("Failed to fetch stats:", e);
    }
  }, []);

  const fetchDatasources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/knowledge/datasources");
      setDatasources(res.data.datasources || []);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to fetch datasources"));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDocStats = useCallback(async () => {
    try {
      const res = await api.get("/knowledge/documents/stats");
      setDocStats(res.data);
    } catch (e) {
      console.error("Failed to fetch doc stats:", e);
    }
  }, []);

  const fetchDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await api.get("/knowledge/documents");
      setDocuments(res.data.documents || []);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to fetch documents"));
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchDatasources();
    fetchDocStats();
    fetchDocuments();
  }, [fetchStats, fetchDatasources, fetchDocStats, fetchDocuments]);

  // Auto-refresh when there are processing documents
  useEffect(() => {
    const hasProcessing = (docStats?.processing ?? 0) > 0 || documents.some(d => d.status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      fetchDocStats();
      fetchDocuments();
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [docStats?.processing, documents, fetchDocStats, fetchDocuments]);

  // Embed all datasources
  const handleEmbedAll = async () => {
    if (!confirm("Embed semua datasources?")) return;
    setEmbedAllRunning(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.post("/knowledge/embed-all");
      setSuccess(`Berhasil! Embedded: ${res.data.embedded}/${res.data.total}, Duration: ${(res.data.duration_ms / 1000).toFixed(1)}s`);
      fetchStats();
      fetchDatasources();
    } catch (e) {
      setError(getErrorMessage(e, "Failed to embed all"));
    } finally {
      setEmbedAllRunning(false);
    }
  };

  // Embed single datasource
  const handleEmbedSingle = async (id: number) => {
    setEmbeddingId(id);
    try {
      await api.post(`/knowledge/embed/${id}`);
      setSuccess(`Datasource ${id} berhasil di-embed`);
      fetchStats();
      fetchDatasources();
    } catch (e) {
      setError(getErrorMessage(e, `Failed to embed ${id}`));
    } finally {
      setEmbeddingId(null);
    }
  };

  // Clear embedding
  const handleClearEmbedding = async (id: number) => {
    if (!confirm(`Hapus embedding untuk datasource ${id}?`)) return;
    try {
      await api.delete(`/knowledge/embed/${id}`);
      setSuccess(`Embedding datasource ${id} dihapus`);
      fetchStats();
      fetchDatasources();
    } catch (e) {
      setError(getErrorMessage(e, `Failed to clear ${id}`));
    }
  };

  // Document handlers
  const resetUploadForm = () => {
    setUploadTitle("");
    setUploadDescription("");
    setUploadCategory("");
    setUploadContent("");
    setUploadFile(null);
    setUploadForceOcr(false);
    setUploadType("text");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!uploadTitle.trim()) {
      setError("Title is required");
      return;
    }
    setUploading(true);
    setError("");
    try {
      if (uploadType === "text") {
        if (!uploadContent.trim()) {
          setError("Content is required");
          setUploading(false);
          return;
        }
        await api.post("/knowledge/documents/text", {
          title: uploadTitle,
          content: uploadContent,
          description: uploadDescription,
          category: uploadCategory,
        });
      } else {
        if (!uploadFile) {
          setError("PDF file is required");
          setUploading(false);
          return;
        }
        const formData = new FormData();
        formData.append("file", uploadFile);
        formData.append("title", uploadTitle);
        if (uploadDescription) formData.append("description", uploadDescription);
        if (uploadCategory) formData.append("category", uploadCategory);
        if (uploadForceOcr) formData.append("forceOcr", "1");
        await api.post("/knowledge/documents/pdf", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      setSuccess("Document uploaded! Embedding in progress...");
      setShowUploadModal(false);
      resetUploadForm();
      fetchDocStats();
      fetchDocuments();
    } catch (e) {
      setError(getErrorMessage(e, "Upload failed"));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (id: number) => {
    if (!confirm(`Delete document ${id}?`)) return;
    try {
      await api.delete(`/knowledge/documents/${id}`);
      setSuccess("Document deleted");
      fetchDocStats();
      fetchDocuments();
    } catch (e) {
      setError(getErrorMessage(e, "Delete failed"));
    }
  };

  const handleReEmbed = async (id: number) => {
    try {
      await api.post(`/knowledge/documents/${id}/re-embed`);
      setSuccess("Re-embedding started");
      fetchDocuments();
    } catch (e) {
      setError(getErrorMessage(e, "Re-embed failed"));
    }
  };

  // Search
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    setSearchDuration(null);
    try {
      const res = await api.post("/knowledge/search", { query: searchQuery.trim(), topN: 10 });
      setSearchResults(res.data.results || []);
      setSearchDuration(res.data.duration_ms || null);
    } catch (e) {
      setError(getErrorMessage(e, "Search failed"));
    } finally {
      setSearching(false);
    }
  };

  // Filter datasources
  const filteredDatasources = datasources.filter((ds) => {
    if (filterEmbedded === "yes" && !ds.hasEmbedding) return false;
    if (filterEmbedded === "no" && ds.hasEmbedding) return false;
    if (filterType !== "all" && ds.type !== filterType) return false;
    return true;
  });

  const uniqueTypes = Array.from(new Set(datasources.map((d) => d.type))).sort();

  const fetchSyncBanner = useCallback(async () => {
    try {
      const res = await api.get<{ scheduler: SyncBannerState }>("/knowledge/sync/stats");
      setSyncBanner(res.data?.scheduler || null);
    } catch {
      // Banner is best-effort; silent failure is OK (the page works without it).
    }
  }, []);

  useEffect(() => {
    fetchSyncBanner();
  }, [fetchSyncBanner]);

  const refreshAll = () => {
    fetchStats();
    fetchDatasources();
    fetchDocStats();
    fetchDocuments();
    fetchSyncBanner();
  };

  return (
    <RequireAuth>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Knowledge Base (RAG)</h1>
          <button onClick={refreshAll} disabled={loading || docsLoading} className="px-3 py-1.5 text-sm border rounded hover:bg-muted">
            Refresh
          </button>
        </div>

        {syncBanner && (
          <div className="rounded-lg border border-border bg-card p-3 flex items-center justify-between text-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={
                  "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium " +
                  (syncBanner.enabled
                    ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
                    : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300")
                }
              >
                Auto-sync BRS+Publikasi: {syncBanner.enabled ? "Aktif" : "Nonaktif"}
              </span>
              {syncBanner.enabled && (
                <span className="text-muted-foreground">
                  {syncBanner.running
                    ? "Sedang sync..."
                    : `Jadwal harian ${syncBanner.schedule} WIT`}
                  {syncBanner.nextRunAt && !syncBanner.running
                    ? ` · Run berikutnya ${new Date(syncBanner.nextRunAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`
                    : ""}
                  {syncBanner.lastRunAt
                    ? ` · Terakhir ${new Date(syncBanner.lastRunAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`
                    : " · Belum pernah berjalan"}
                  {syncBanner.lastResult && syncBanner.lastResult.success
                    ? ` (BRS +${syncBanner.lastResult.brs?.indexed || 0}, Publikasi +${syncBanner.lastResult.publikasi?.indexed || 0})`
                    : ""}
                </span>
              )}
            </div>
            <a
              href="/backend/knowledge-sync"
              className="text-primary hover:underline text-xs font-medium whitespace-nowrap"
            >
              Kelola →
            </a>
          </div>
        )}

        {error && (
          <Alert variant="error">
            <div className="flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError("")} className="ml-2 hover:opacity-70">✕</button>
            </div>
          </Alert>
        )}
        {success && (
          <Alert variant="success">
            <div className="flex items-center justify-between">
              <span>{success}</span>
              <button onClick={() => setSuccess("")} className="ml-2 hover:opacity-70">✕</button>
            </div>
          </Alert>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="p-4 border rounded-lg bg-card">
            <div className="text-sm text-muted-foreground">Datasources</div>
            <div className="text-2xl font-bold">{stats?.total ?? "-"}</div>
            <div className="text-xs text-green-600">{stats?.embedded ?? 0} embedded</div>
          </div>
          <div className="p-4 border rounded-lg bg-card">
            <div className="text-sm text-muted-foreground">Custom Docs</div>
            <div className="text-2xl font-bold">{docStats?.rootDocuments ?? "-"}</div>
            <div className="text-xs text-muted-foreground">{docStats?.chunks ?? 0} chunks</div>
          </div>
          <div className="p-4 border rounded-lg bg-card">
            <div className="text-sm text-muted-foreground">Ready</div>
            <div className="text-2xl font-bold text-green-600">{docStats?.ready ?? "-"}</div>
            {(docStats?.processing ?? 0) > 0 && (
              <div className="text-xs text-yellow-600 animate-pulse">⏳ {docStats?.processing} processing</div>
            )}
          </div>
          <div className="p-4 border rounded-lg bg-card">
            <div className="text-sm text-muted-foreground">Total Karakter</div>
            <div className="text-2xl font-bold">{docStats?.totalChars ? (docStats.totalChars / 1000).toFixed(1) + 'K' : "-"}</div>
            <div className="text-xs text-muted-foreground">Max: {docStats?.maxChars ? (docStats.maxChars / 1000).toFixed(1) + 'K' : "-"}</div>
          </div>
          <div className="p-4 border rounded-lg bg-card">
            <div className="text-sm text-muted-foreground">Max Return AI</div>
            <div className="text-2xl font-bold">{docStats?.maxReturnToAi ? (docStats.maxReturnToAi / 1000).toFixed(1) + 'K' : "-"}</div>
            <div className="text-xs text-muted-foreground">per dokumen</div>
          </div>
          <div className="p-4 border rounded-lg bg-card">
            <div className="text-sm text-muted-foreground">Coverage</div>
            <div className="text-2xl font-bold">
              {stats ? `${Math.round((stats.embedded / stats.total) * 100)}%` : "-"}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab("datasources")}
            className={`px-4 py-2 -mb-px ${activeTab === "datasources" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          >
            Datasources ({stats?.total ?? 0})
          </button>
          <button
            onClick={() => setActiveTab("documents")}
            className={`px-4 py-2 -mb-px ${activeTab === "documents" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          >
            Custom Documents ({docStats?.rootDocuments ?? 0})
          </button>
        </div>

        {activeTab === "datasources" && (
          <>
            <div className="p-4 border rounded-lg bg-card space-y-4">
              <h2 className="font-semibold">Datasource Embeddings</h2>
              <div className="flex flex-wrap gap-3">
                <button onClick={handleEmbedAll} disabled={embedAllRunning} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50">
                  {embedAllRunning ? "⏳ Embedding..." : "Embed All Datasources"}
                </button>
              </div>
            </div>

            <div className="p-4 border rounded-lg bg-card space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="font-semibold">Datasources</h2>
                <div className="flex items-center gap-3 text-sm">
                  <select value={filterEmbedded} onChange={(e) => setFilterEmbedded(e.target.value as "all" | "yes" | "no")} className="px-2 py-1 border rounded bg-background">
                    <option value="all">All Status</option>
                    <option value="yes">Embedded</option>
                    <option value="no">Not Embedded</option>
                  </select>
                  <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="px-2 py-1 border rounded bg-background">
                    <option value="all">All Types</option>
                    {uniqueTypes.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="flex justify-center py-8"><LoadingSpinner /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">ID</th>
                        <th className="text-left py-2 px-2">Name</th>
                        <th className="text-left py-2 px-2">Type</th>
                        <th className="text-center py-2 px-2">Embedded</th>
                        <th className="text-right py-2 px-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredDatasources.map((ds) => (
                        <tr key={ds.id} className="hover:bg-muted/50">
                          <td className="py-2 px-2 font-mono">{ds.id}</td>
                          <td className="py-2 px-2"><div className="max-w-xs truncate">{ds.name}</div></td>
                          <td className="py-2 px-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${ds.type === "exim" ? "bg-purple-100 text-purple-700" : ds.type === "dynamic" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>
                              {ds.type}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center">{ds.hasEmbedding ? <span className="text-green-600">✓</span> : <span className="text-gray-400">—</span>}</td>
                          <td className="py-2 px-2 text-right">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => handleEmbedSingle(ds.id)} disabled={embeddingId === ds.id} className="px-2 py-1 text-xs border rounded hover:bg-muted disabled:opacity-50">
                                {embeddingId === ds.id ? "..." : ds.hasEmbedding ? "Re-embed" : "Embed"}
                              </button>
                              {ds.hasEmbedding && (
                                <button onClick={() => handleClearEmbedding(ds.id)} className="px-2 py-1 text-xs border rounded hover:bg-red-50 text-red-600">Clear</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredDatasources.length === 0 && <div className="text-center py-8 text-muted-foreground">No datasources found</div>}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "documents" && (
          <>
            <div className="p-4 border rounded-lg bg-card space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Custom Knowledge Documents</h2>
                <button onClick={() => setShowUploadModal(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90">
                  + Upload Document
                </button>
              </div>
              <p className="text-sm text-muted-foreground">Upload PDF atau text untuk menambah knowledge base. Dokumen akan di-chunk dan di-embed secara otomatis.</p>
            </div>

            <div className="p-4 border rounded-lg bg-card space-y-4">
              <h2 className="font-semibold">Documents</h2>
              {docsLoading ? (
                <div className="flex justify-center py-8"><LoadingSpinner /></div>
              ) : documents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No documents yet. Upload one to get started.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">ID</th>
                        <th className="text-left py-2 px-2">Title</th>
                        <th className="text-left py-2 px-2">Type</th>
                        <th className="text-left py-2 px-2">Category</th>
                        <th className="text-right py-2 px-2">Chars</th>
                        <th className="text-center py-2 px-2">Chunks</th>
                        <th className="text-center py-2 px-2">Status</th>
                        <th className="text-right py-2 px-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {documents.map((doc) => (
                        <tr key={doc.id} className="hover:bg-muted/50">
                          <td className="py-2 px-2 font-mono">{doc.id}</td>
                          <td className="py-2 px-2"><div className="max-w-xs truncate" title={doc.title}>{doc.title}</div></td>
                          <td className="py-2 px-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${doc.source_type === "pdf" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                              {doc.source_type}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-muted-foreground">{doc.category || "—"}</td>
                          <td className="py-2 px-2 text-right font-mono text-xs">
                            {doc.content_length >= 1000 
                              ? `${(doc.content_length / 1000).toFixed(1)}k` 
                              : doc.content_length}
                          </td>
                          <td className="py-2 px-2 text-center">{doc.chunks}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs ${doc.status === "ready" ? "bg-green-100 text-green-700" : doc.status === "processing" ? "bg-yellow-100 text-yellow-700" : doc.status === "error" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"}`}>
                              {doc.status}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => handleReEmbed(doc.id)} className="px-2 py-1 text-xs border rounded hover:bg-muted">Re-embed</button>
                              <button onClick={() => handleDeleteDocument(doc.id)} className="px-2 py-1 text-xs border rounded hover:bg-red-50 text-red-600">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Search Test */}
        <div className="p-4 border rounded-lg bg-card space-y-4">
          <h2 className="font-semibold">Test Vector Search</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Cari: inflasi ternate 2024..."
              className="flex-1 px-3 py-2 border rounded bg-background"
            />
            <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50">
              {searching ? "⏳" : "Search"}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">{searchResults.length} results {searchDuration !== null && `(${searchDuration}ms)`}</div>
              <div className="border rounded divide-y">
                {searchResults.map((r) => (
                  <div key={r.id} className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">ID: {r.id} · Type: {r.type}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-mono">{(r.similarity * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-4 border rounded-lg bg-muted/30 text-sm space-y-2">
          <h3 className="font-semibold">Tentang Knowledge Base</h3>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Embedding menggunakan OpenAI text-embedding-3-small (1536 dimensions)</li>
            <li>Vector search menggunakan cosine similarity di Node.js (in-memory)</li>
            <li>Custom documents akan di-chunk (~{docStats?.chunkSize ?? 2000} chars) untuk retrieval lebih baik</li>
            <li>Max return ke AI: <strong>{docStats?.maxReturnToAi ?? 3000} chars</strong> per dokumen (top 3 dokumen)</li>
            <li>Estimasi biaya: ~$0.00002 per search query</li>
          </ul>
        </div>

        {/* Tips for Large Documents */}
        <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-950/30 text-sm space-y-2">
          <h3 className="font-semibold text-blue-700 dark:text-blue-400">💡 Tips Chunking Dokumen Besar</h3>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li><strong>Split by topic:</strong> Pisahkan PDF menjadi beberapa dokumen berdasarkan topik (misal: FAQ per kategori)</li>
            <li><strong>Use numbered sections:</strong> Dokumen dengan nomor FAQ (1., 2., 3.) akan di-chunk lebih akurat</li>
            <li><strong>Keep chunks self-contained:</strong> Setiap chunk harus bisa berdiri sendiri (ada konteks + jawaban)</li>
            <li><strong>Avoid huge tables:</strong> Tabel besar dalam PDF sulit di-OCR, konversi ke teks terstruktur jika perlu</li>
            <li><strong>Max {docStats?.maxReturnToAi ?? 3000} chars per result:</strong> Jika chunk terlalu panjang, hanya {docStats?.maxReturnToAi ?? 3000} chars pertama yang dikirim ke AI</li>
          </ul>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Upload Document</h3>
              <button onClick={() => { setShowUploadModal(false); resetUploadForm(); }} className="hover:opacity-70">✕</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex gap-2">
                <button onClick={() => setUploadType("text")} className={`flex-1 py-2 border rounded ${uploadType === "text" ? "bg-primary text-primary-foreground" : ""}`}>📝 Text</button>
                <button onClick={() => setUploadType("pdf")} className={`flex-1 py-2 border rounded ${uploadType === "pdf" ? "bg-primary text-primary-foreground" : ""}`}>📄 PDF</button>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Title *</label>
                <input type="text" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} className="w-full px-3 py-2 border rounded bg-background" placeholder="e.g., Metodologi Inflasi BPS" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <input type="text" value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)} className="w-full px-3 py-2 border rounded bg-background" placeholder="e.g., metodologi, FAQ, panduan" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <input type="text" value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} className="w-full px-3 py-2 border rounded bg-background" placeholder="Optional description" />
              </div>
              {uploadType === "text" ? (
                <div>
                  <label className="block text-sm font-medium mb-1">Content *</label>
                  <textarea value={uploadContent} onChange={(e) => setUploadContent(e.target.value)} rows={8} className="w-full px-3 py-2 border rounded bg-background font-mono text-sm" placeholder="Paste your text content here..." />
                  <div className="text-xs text-muted-foreground mt-1">{uploadContent.length} characters</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">PDF File *</label>
                    <input ref={fileInputRef} type="file" accept=".pdf" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} className="w-full px-3 py-2 border rounded bg-background" />
                    {uploadFile && <div className="text-xs text-muted-foreground mt-1">{uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="forceOcr" 
                      checked={uploadForceOcr} 
                      onChange={(e) => setUploadForceOcr(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <label htmlFor="forceOcr" className="text-sm">
                      🔍 Force OCR (gunakan untuk PDF scan/gambar)
                    </label>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    OCR menggunakan OpenAI Vision untuk mengekstrak teks dari halaman gambar/scan. 
                    Jika PDF memiliki text layer normal, OCR otomatis dilewati kecuali Force OCR dicentang.
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button onClick={() => { setShowUploadModal(false); resetUploadForm(); }} className="px-4 py-2 border rounded hover:bg-muted">Cancel</button>
              <button onClick={handleUpload} disabled={uploading} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50">
                {uploading ? "⏳ Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </RequireAuth>
  );
}

