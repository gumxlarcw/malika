"use client";
import { useState } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import { Search, Play, Zap, Database, BookOpen } from "lucide-react";

interface DatasourceResult {
  id: number;
  name: string;
  description?: string;
  type: string;
  score?: number;
}

interface IntentResult {
  type?: string;
  group?: string;
  topic?: string;
  geo?: string;
  period?: string | number;
  candidates?: DatasourceResult[];
  raw?: Record<string, unknown>;
}

interface KnowledgeResult {
  id: number;
  name?: string;
  title?: string;
  content?: string;
  similarity?: number;
}

export default function SearchTestPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Results
  const [datasourceResults, setDatasourceResults] = useState<DatasourceResult[] | null>(null);
  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeResult[] | null>(null);
  const [activeTab, setActiveTab] = useState<"datasource" | "intent" | "knowledge">("datasource");

  async function handleSearch(type: "datasource" | "intent" | "knowledge") {
    if (!query.trim()) {
      setError("Query tidak boleh kosong");
      return;
    }
    setLoading(true);
    setError("");
    setActiveTab(type);

    try {
      if (type === "datasource") {
        const { data } = await api.get(`/search/datasource?q=${encodeURIComponent(query)}&limit=20`);
        setDatasourceResults(data.results || data.data || []);
        setIntentResult(null);
        setKnowledgeResults(null);
      } else if (type === "intent") {
        const { data } = await api.get(`/search/intent?q=${encodeURIComponent(query)}&includeCandidates=1&limit=10`);
        setIntentResult(data);
        setDatasourceResults(null);
        setKnowledgeResults(null);
      } else if (type === "knowledge") {
        const { data } = await api.get(`/search/knowledge?q=${encodeURIComponent(query)}&limit=10`);
        setKnowledgeResults(data.results || data.data || []);
        setDatasourceResults(null);
        setIntentResult(null);
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Search gagal"));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSearch(activeTab);
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Search className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Search Test Console</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Test backend search endpoints untuk debugging ranking dan intent parsing.
        </p>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Search Input */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Masukkan query pencarian..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 px-4 py-2 rounded-lg border border-border bg-background"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleSearch("datasource")}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Database className="h-4 w-4" />
              <span>Datasource</span>
            </button>
            <button
              onClick={() => handleSearch("intent")}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              <Zap className="h-4 w-4" />
              <span>Intent</span>
            </button>
            <button
              onClick={() => handleSearch("knowledge")}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <BookOpen className="h-4 w-4" />
              <span>Knowledge</span>
            </button>
          </div>
        </div>

        {loading && <LoadingSpinner label="Searching..." />}

        {/* Datasource Results */}
        {!loading && datasourceResults && (
          <div className="space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Database className="h-4 w-4" />
              Datasource Search Results ({datasourceResults.length})
            </h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="w-full max-w-full overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-muted">
                      <th className="px-4 py-2 text-left">ID</th>
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Type</th>
                      <th className="px-4 py-2 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasourceResults.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                          Tidak ada hasil
                        </td>
                      </tr>
                    ) : (
                      datasourceResults.map((r, i) => (
                        <tr key={r.id || i} className="border-t border-border hover:bg-muted/50">
                          <td className="px-4 py-2">{r.id}</td>
                          <td className="px-4 py-2">
                            <div className="font-medium">{r.name}</div>
                            {r.description && (
                              <div className="text-xs text-muted-foreground truncate max-w-md">{r.description}</div>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <span className="px-2 py-0.5 rounded-full text-xs bg-muted">{r.type}</span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {r.score !== undefined ? r.score.toFixed(2) : "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Intent Results */}
        {!loading && intentResult && (
          <div className="space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Intent Parsing Result
            </h2>
            
            {/* Parsed Fields */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="p-3 rounded-lg bg-card border border-border">
                <div className="text-xs text-muted-foreground">Type</div>
                <div className="font-medium">{intentResult.type || "-"}</div>
              </div>
              <div className="p-3 rounded-lg bg-card border border-border">
                <div className="text-xs text-muted-foreground">Group</div>
                <div className="font-medium">{intentResult.group || "-"}</div>
              </div>
              <div className="p-3 rounded-lg bg-card border border-border">
                <div className="text-xs text-muted-foreground">Topic</div>
                <div className="font-medium">{intentResult.topic || "-"}</div>
              </div>
              <div className="p-3 rounded-lg bg-card border border-border">
                <div className="text-xs text-muted-foreground">Geo</div>
                <div className="font-medium">{intentResult.geo || "-"}</div>
              </div>
              <div className="p-3 rounded-lg bg-card border border-border">
                <div className="text-xs text-muted-foreground">Period</div>
                <div className="font-medium">{intentResult.period || "-"}</div>
              </div>
            </div>

            {/* Candidates */}
            {intentResult.candidates && intentResult.candidates.length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="p-3 bg-muted font-medium">Candidates ({intentResult.candidates.length})</div>
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="px-4 py-2 text-left">ID</th>
                        <th className="px-4 py-2 text-left">Name</th>
                        <th className="px-4 py-2 text-left">Type</th>
                        <th className="px-4 py-2 text-right">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {intentResult.candidates.map((c, i) => (
                        <tr key={c.id || i} className="border-t border-border">
                          <td className="px-4 py-2">{c.id}</td>
                          <td className="px-4 py-2">{c.name}</td>
                          <td className="px-4 py-2">
                            <span className="px-2 py-0.5 rounded-full text-xs bg-muted">{c.type}</span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {c.score !== undefined ? c.score.toFixed(2) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Raw JSON */}
            <details className="rounded-xl border border-border bg-card">
              <summary className="p-3 cursor-pointer hover:bg-muted/50">Raw JSON Response</summary>
              <pre className="p-3 text-xs overflow-x-auto bg-muted/30">
                {JSON.stringify(intentResult, null, 2)}
              </pre>
            </details>
          </div>
        )}

        {/* Knowledge Results */}
        {!loading && knowledgeResults && (
          <div className="space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Knowledge Base Search Results ({knowledgeResults.length})
            </h2>
            <div className="space-y-2">
              {knowledgeResults.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground rounded-xl border border-border bg-card">
                  Tidak ada hasil
                </div>
              ) : (
                knowledgeResults.map((r, i) => (
                  <div key={r.id || i} className="p-4 rounded-xl border border-border bg-card hover:bg-muted/50">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="font-medium">{r.name || r.title || `Item ${r.id}`}</div>
                        {r.content && (
                          <div className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.content}</div>
                        )}
                      </div>
                      {r.similarity !== undefined && (
                        <div className="text-sm font-mono text-muted-foreground">
                          {(r.similarity * 100).toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
