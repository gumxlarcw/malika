"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import { fmt, truncate } from "@/lib/formatters";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";

type ChatThread = {
  id: number;
  owner_id: string;
  title: string;
  topics: string[] | null;
  summary: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

type ChatMessage = {
  id: number;
  thread_id: number;
  role: "system" | "user" | "assistant";
  content: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  created_at: string;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type Stats = {
  total_threads: number;
  total_messages: number;
  unique_owners: number;
  messages_by_role: Record<string, number>;
  activity: {
    threads_24h: number;
    threads_7d: number;
    threads_30d: number;
    messages_24h: number;
    messages_7d: number;
    messages_30d: number;
  };
};

type ThreadWithMessages = {
  thread: Omit<ChatThread, "message_count">;
  messages: ChatMessage[];
};

type MalikaUiMetaV1 = {
  v: 1;
  query?: string;
  preview_mode?: "auto" | "confirm" | "none";
  preview_queries?: Array<{ label: string; q: string }>;
  preferred_data_link?: string;
  requested?: { year: number | null; month: number | null; geo: string | null };
  table?: {
    kind?: "data" | "search";
    title?: string;
    columns: string[];
    rows: unknown[];
    total_rows?: number;
  };
  candidates?: Array<{
    id: number;
    name: string;
    type: string;
    score: number;
    latest: string | null;
    href: string;
  }>;
  links?: Array<{ label: string; href: string }>;
  suggestions?: string[];
};

function extractMalikaUiBlock(textRaw: string): {
  text: string;
  ui: MalikaUiMetaV1 | null;
  rawBlock: string | null;
} {
  const text = String(textRaw || "");
  const pattern = /```\s*malika_ui\s*([\s\S]*?)```/i;
  const m = text.match(pattern);
  if (!m) return { text: text.trim(), ui: null, rawBlock: null };
  const jsonPart = String(m[1] || "").trim();
  const cleaned = text.replace(m[0], "").replace(/\n{3,}/g, "\n\n").trim();

  try {
    const parsed = JSON.parse(jsonPart);
    if (parsed && parsed.v === 1) return { text: cleaned, ui: parsed, rawBlock: m[0] };
  } catch {
    // ignore
  }
  return { text: cleaned, ui: null, rawBlock: m[0] };
}

export default function ChatsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ownerFilter, setOwnerFilter] = useState("");

  const [selectedThread, setSelectedThread] = useState<ThreadWithMessages | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [jsonData, setJsonData] = useState<any>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  const loadThreads = useCallback(async (page = 1) => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, any> = { page, limit: 50 };
      if (ownerFilter.trim()) params.owner = ownerFilter.trim();
      const { data } = await api.get("/chat/admin/threads", { params });
      setThreads(data.threads || []);
      setPagination(data.pagination || null);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat data chat."));
    } finally {
      setLoading(false);
    }
  }, [ownerFilter]);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get("/chat/admin/stats");
      setStats(data.stats || null);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadThreads(1);
    loadStats();
  }, [loadThreads, loadStats]);

  const handleViewThread = async (threadId: number) => {
    setModalLoading(true);
    setSelectedThread(null);
    try {
      const { data } = await api.get("/chat/admin/threads/" + threadId);
      setSelectedThread({ thread: data.thread, messages: data.messages || [] });
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat thread."));
    } finally {
      setModalLoading(false);
    }
  };

  const handleViewJson = (data: any) => {
    setJsonData(data);
    setShowJsonModal(true);
    setCopySuccess(false);
  };

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = JSON.stringify(jsonData, null, 2);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleDownloadJson = (filename: string) => {
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportAll = async () => {
    setModalLoading(true);
    try {
      const { data } = await api.get("/chat/admin/export/all", { params: { limit: 10000 } });
      handleViewJson(data);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal export data."));
    } finally {
      setModalLoading(false);
    }
  };

  const handleExportByOwner = async (ownerId: string) => {
    setModalLoading(true);
    try {
      const { data } = await api.get(`/chat/admin/export/owner/${encodeURIComponent(ownerId)}`);
      handleViewJson(data);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal export data owner."));
    } finally {
      setModalLoading(false);
    }
  };

  const getBubbleClass = (role: string) => {
    if (role === "user") return "bg-primary text-primary-foreground";
    if (role === "assistant") return "bg-card border border-border";
    return "bg-yellow-500/10 border border-yellow-500/30";
  };

  const getRoleBadgeClass = (role: string) => {
    if (role === "user") return "bg-primary-foreground/20 text-primary-foreground";
    if (role === "assistant") return "bg-green-500/20 text-green-700 dark:text-green-400";
    return "bg-yellow-500/20 text-yellow-700";
  };

  return (
    <RequireAuth>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Chat Malika</h1>
            <p className="text-sm text-muted-foreground">Lihat semua percakapan chat dari pengguna Malika</p>
          </div>
          <button
            onClick={handleExportAll}
            disabled={modalLoading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export All JSON
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="text-sm text-muted-foreground">Total Thread</div>
              <div className="text-2xl font-bold">{stats.total_threads.toLocaleString()}</div>
            </div>
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="text-sm text-muted-foreground">Total Pesan</div>
              <div className="text-2xl font-bold">{stats.total_messages.toLocaleString()}</div>
            </div>
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="text-sm text-muted-foreground">Pengguna Unik</div>
              <div className="text-2xl font-bold">{stats.unique_owners.toLocaleString()}</div>
            </div>
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="text-sm text-muted-foreground">Pesan 24 Jam</div>
              <div className="text-2xl font-bold">{stats.activity.messages_24h.toLocaleString()}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Filter by owner ID..."
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="flex-1 max-w-xs px-3 py-2 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button onClick={() => loadThreads(1)} className="px-4 py-2 border border-border rounded-lg hover:bg-muted">
            Filter
          </button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {loading ? (
          <LoadingSpinner label="Memuat data chat..." />
        ) : (
          <>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-muted">
                      <th className="px-4 py-3 text-left font-medium">ID</th>
                      <th className="px-4 py-3 text-left font-medium">Owner</th>
                      <th className="px-4 py-3 text-left font-medium">Judul</th>
                      <th className="px-4 py-3 text-left font-medium">Pesan</th>
                      <th className="px-4 py-3 text-left font-medium">Terakhir</th>
                      <th className="px-4 py-3 text-left font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {threads.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Belum ada data chat.</td>
                      </tr>
                    ) : (
                      threads.map((thread) => (
                        <tr key={thread.id} className="border-t border-border hover:bg-muted/50">
                          <td className="px-4 py-3 font-mono text-xs">{thread.id}</td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{truncate(thread.owner_id, 20)}</span>
                          </td>
                          <td className="px-4 py-3 max-w-xs">
                            <div className="truncate" title={thread.title}>{thread.title || "-"}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{thread.message_count}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmt(thread.last_message_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button onClick={() => handleViewThread(thread.id)} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90">Lihat</button>
                              <button onClick={() => handleExportByOwner(thread.owner_id)} className="px-3 py-1 text-xs border border-border rounded hover:bg-muted" title="Export owner">Export</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Halaman {pagination.page} dari {pagination.totalPages} ({pagination.total} thread)
                </div>
                <div className="flex gap-2">
                  <button onClick={() => loadThreads(pagination.page - 1)} disabled={pagination.page <= 1} className="px-3 py-1 border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed">Prev</button>
                  <button onClick={() => loadThreads(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages} className="px-3 py-1 border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
                </div>
              </div>
            )}
          </>
        )}

        {(selectedThread || modalLoading) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col m-4">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{selectedThread?.thread?.title || "Loading..."}</h2>
                  {selectedThread && (
                    <p className="text-sm text-muted-foreground">
                      Owner: <code className="bg-muted px-1 rounded">{selectedThread.thread.owner_id}</code> | Thread #{selectedThread.thread.id}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {selectedThread && (
                    <button onClick={() => handleViewJson(selectedThread)} className="px-3 py-1 text-sm border border-border rounded hover:bg-muted">View JSON</button>
                  )}
                  <button onClick={() => setSelectedThread(null)} className="px-3 py-1 text-sm bg-muted rounded hover:bg-muted/80">Tutup</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/30">
                {modalLoading ? (
                  <LoadingSpinner label="Memuat pesan..." />
                ) : (
                  selectedThread?.messages.map((msg) => {
                    const extracted = msg.role === "assistant" ? extractMalikaUiBlock(msg.content) : { text: msg.content, ui: null, rawBlock: null };
                    return (
                      <div key={msg.id} className="space-y-2">
                        <div className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
                          <div className={"max-w-[85%] rounded-2xl px-4 py-3 " + getBubbleClass(msg.role)}>
                            <div className="flex items-center justify-between gap-4 mb-2">
                              <span className={"text-xs font-semibold px-2 py-0.5 rounded " + getRoleBadgeClass(msg.role)}>{msg.role}</span>
                              <span className={msg.role === "user" ? "text-xs text-primary-foreground/70" : "text-xs text-muted-foreground"}>
                                {fmt(msg.created_at)}
                                {msg.model && " · " + msg.model}
                                {msg.latency_ms && " · " + msg.latency_ms + "ms"}
                              </span>
                            </div>
                            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{extracted.text || "(empty)"}</div>
                            {(msg.tokens_in || msg.tokens_out) && (
                              <div className={msg.role === "user" ? "mt-2 text-xs text-primary-foreground/60" : "mt-2 text-xs text-muted-foreground"}>
                                Tokens: {msg.tokens_in || 0} in / {msg.tokens_out || 0} out
                              </div>
                            )}
                          </div>
                        </div>

                        {msg.role === "assistant" && extracted.ui && (
                          <div className="ml-4 space-y-3">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                              </svg>
                              <span>malika_ui block detected</span>
                              <button onClick={() => handleViewJson(extracted.ui)} className="ml-2 px-2 py-0.5 bg-muted rounded text-xs hover:bg-muted/80">View UI JSON</button>
                            </div>

                            {extracted.ui.query && (
                              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                                <div className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">Query</div>
                                <code className="text-sm">{extracted.ui.query}</code>
                                {extracted.ui.preferred_data_link && (
                                  <div className="mt-2 text-xs">
                                    <span className="text-muted-foreground">Link: </span>
                                    <a href={extracted.ui.preferred_data_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{extracted.ui.preferred_data_link}</a>
                                  </div>
                                )}
                              </div>
                            )}

                            {extracted.ui.candidates && extracted.ui.candidates.length > 0 && (
                              <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                                <div className="text-xs font-semibold text-purple-700 dark:text-purple-400 mb-2">Candidates ({extracted.ui.candidates.length})</div>
                                <div className="space-y-1">
                                  {extracted.ui.candidates.slice(0, 5).map((c, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs">
                                      <span className="font-mono bg-muted px-1 rounded">{c.id}</span>
                                      <span className="flex-1 truncate">{c.name}</span>
                                      <span className="text-muted-foreground">{c.type}</span>
                                      <span className="font-mono text-green-600">{c.score.toFixed(2)}</span>
                                    </div>
                                  ))}
                                  {extracted.ui.candidates.length > 5 && (
                                    <div className="text-xs text-muted-foreground">... dan {extracted.ui.candidates.length - 5} lainnya</div>
                                  )}
                                </div>
                              </div>
                            )}

                            {extracted.ui.table && (
                              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg overflow-hidden">
                                <div className="text-xs font-semibold text-green-700 dark:text-green-400 mb-2">
                                  Table: {extracted.ui.table.title || extracted.ui.table.kind || "data"}
                                  {extracted.ui.table.total_rows && " (" + extracted.ui.table.total_rows + " rows)"}
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-xs">
                                    <thead>
                                      <tr className="bg-green-500/10">
                                        {extracted.ui.table.columns.map((col, i) => (
                                          <th key={i} className="px-2 py-1 text-left font-medium">{col}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(extracted.ui.table.rows as any[]).slice(0, 5).map((row, ri) => (
                                        <tr key={ri} className="border-t border-green-500/20">
                                          {Array.isArray(row)
                                            ? row.map((cell, ci) => <td key={ci} className="px-2 py-1">{String(cell ?? "")}</td>)
                                            : extracted.ui?.table?.columns.map((col, ci) => <td key={ci} className="px-2 py-1">{String((row as any)[col] ?? "")}</td>)
                                          }
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {(extracted.ui.table.rows as any[]).length > 5 && (
                                    <div className="text-xs text-muted-foreground mt-2">Showing 5 of {(extracted.ui.table.rows as any[]).length} rows</div>
                                  )}
                                </div>
                              </div>
                            )}

                            {extracted.ui.links && extracted.ui.links.length > 0 && (
                              <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                                <div className="text-xs font-semibold text-orange-700 dark:text-orange-400 mb-2">Links ({extracted.ui.links.length})</div>
                                <div className="flex flex-wrap gap-2">
                                  {extracted.ui.links.map((link, i) => (
                                    <a key={i} href={link.href} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-orange-500/20 rounded text-xs hover:bg-orange-500/30">{link.label}</a>
                                  ))}
                                </div>
                              </div>
                            )}

                            {extracted.ui.suggestions && extracted.ui.suggestions.length > 0 && (
                              <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                                <div className="text-xs font-semibold text-cyan-700 dark:text-cyan-400 mb-2">Suggestions</div>
                                <div className="flex flex-wrap gap-2">
                                  {extracted.ui.suggestions.map((s, i) => (
                                    <span key={i} className="px-2 py-1 bg-cyan-500/20 rounded text-xs">{s}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {extracted.rawBlock && (
                              <details className="text-xs">
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show raw malika_ui block</summary>
                                <pre className="mt-2 p-2 bg-muted rounded overflow-x-auto text-[10px]">{extracted.rawBlock}</pre>
                              </details>
                            )}
                          </div>
                        )}

                        {msg.role === "assistant" && !extracted.ui && extracted.rawBlock && (
                          <div className="ml-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                            <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="font-semibold">Malformed malika_ui block detected!</span>
                            </div>
                            <pre className="mt-2 p-2 bg-red-500/5 rounded overflow-x-auto text-[10px] text-red-800 dark:text-red-300">{extracted.rawBlock}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {showJsonModal && jsonData && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col m-4">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h2 className="text-lg font-semibold">Raw JSON</h2>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopyToClipboard}
                    className={copySuccess ? "px-3 py-1 text-sm border rounded flex items-center gap-1 bg-green-500 text-white border-green-500" : "px-3 py-1 text-sm border rounded flex items-center gap-1 border-border hover:bg-muted"}
                  >
                    {copySuccess ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleDownloadJson("malika-chat-export-" + Date.now() + ".json")}
                    className="px-3 py-1 text-sm border border-border rounded hover:bg-muted flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </button>
                  <button onClick={() => { setShowJsonModal(false); setJsonData(null); }} className="px-3 py-1 text-sm bg-muted rounded hover:bg-muted/80">Tutup</button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-xs font-mono bg-muted p-4 rounded-lg overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(jsonData, null, 2)}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
