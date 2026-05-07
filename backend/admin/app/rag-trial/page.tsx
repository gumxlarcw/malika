"use client";

import { useEffect, useState, useCallback } from "react";
import RequireAuth from "@/components/RequireAuth";
import { api } from "@/lib/axios";
import Alert from "@/components/Alert";
import LoadingSpinner from "@/components/LoadingSpinner";
import { getErrorMessage } from "@/lib/errors";

type Stats = {
  brs: { total: number; pages: number };
  publications: { total: number; pages: number };
  combined: number;
};

type BrsItem = {
  brs_id: number;
  title: string;
  abstract: string;
  abstract_raw: string;
  release_date: string;
  pdf_url: string;
  size: string;
  subject: string;
};

type PublicationItem = {
  pub_id: number;
  title: string;
  abstract: string;
  abstract_raw: string;
  release_date: string;
  pdf_url: string;
  size: string;
};

type ExtractionResult = {
  extraction: {
    pages: number;
    textLength: number;
    downloadSize: number;
  };
  analysis: {
    quality: string;
    score: number;
    hasNarrativeContent: boolean;
    hasTabularData: boolean;
    wordCount: number;
    recommendations: string[];
  };
  chunks: {
    count: number;
    preview: Array<{ index: number; length: number; preview: string }>;
  };
  fullText: string;
};

type CompareResult = {
  title: string;
  comparison: {
    abstract: { length: number; tokens: number; cost: string; preview: string };
    pdf: {
      pages?: number;
      length?: number;
      tokens?: number;
      cost?: string;
      quality?: { quality: string; score: number; recommendations: string[] };
      preview?: string;
      error?: string;
    };
  };
  recommendation: string;
  costDifference: {
    abstractCost: string;
    pdfCost: string;
    multiplier: number;
  };
};

type Tab = "brs" | "publications" | "compare";

export default function RagTrialPage() {
  const [activeTab, setActiveTab] = useState<Tab>("brs");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Year filter
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i);
  const [brsYear, setBrsYear] = useState<number | undefined>(currentYear);
  const [pubsYear, setPubsYear] = useState<number | undefined>(currentYear);

  // BRS state
  const [brsList, setBrsList] = useState<BrsItem[]>([]);
  const [brsPage, setBrsPage] = useState(1);
  const [brsTotalPages, setBrsTotalPages] = useState(1);
  const [brsLoading, setBrsLoading] = useState(false);

  // Publications state
  const [pubsList, setPubsList] = useState<PublicationItem[]>([]);
  const [pubsPage, setPubsPage] = useState(1);
  const [pubsTotalPages, setPubsTotalPages] = useState(1);
  const [pubsLoading, setPubsLoading] = useState(false);

  // Selected item for analysis
  const [selectedItem, setSelectedItem] = useState<BrsItem | PublicationItem | null>(null);
  const [selectedType, setSelectedType] = useState<"brs" | "publication" | null>(null);

  // Extraction results
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [extracting, setExtracting] = useState(false);

  // Compare results
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);

  // Embed test
  const [embedText, setEmbedText] = useState("");
  const [embedResult, setEmbedResult] = useState<{
    dimensions: number;
    magnitude: number;
    stats: { inputLength: number; estimatedTokens: number; estimatedCostUsd: string; durationMs: number };
  } | null>(null);
  const [embedding, setEmbedding] = useState(false);

  // RAG search test
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{
    knowledge: Array<{ id: number; title: string; category: string; source: string; similarity: string; snippet: string; isStatistical?: boolean }>;
    datasources: Array<{ id: number; name: string; type: string; similarity: string; description: string; matchedPeriod?: string }>;
    stats: { 
      durationMs: number; 
      knowledgeCount: number; 
      datasourceCount: number;
      relevanceFilter?: {
        applied: boolean;
        filtered: { knowledge: number; datasource: number };
        thresholds: { knowledge: number; datasource: number };
      };
      aiRelevanceFilter?: {
        applied: boolean;
        latencyMs: number;
        stats?: {
          before?: { datasources: number; knowledge: number };
          after?: { datasources: number; knowledge: number };
        };
        reason?: string;
      };
    };
    periodFilter?: {
      applied: boolean;
      extracted?: { hasPeriod: boolean; hasPartialPeriod?: boolean; year?: string; month?: string; monthName?: string; display?: string };
      datasourceMatches?: Array<{ source_id: number; matchedPeriod: string }>;
      note?: string;
    };
    queryRouting?: { 
      type: string; 
      reason: string; 
      signals: { hasDataSignal: boolean; hasKnowledgeSignal: boolean };
      topCustomDocSimilarity: string;
      topStatisticalDocSimilarity: string;
      recommendation: string;
    };
  } | null>(null);
  const [searching, setSearching] = useState(false);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await api.get("/rag-trial/stats");
      setStats(res.data.stats);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to fetch stats"));
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchBrs = useCallback(async (page: number, year?: number) => {
    setBrsLoading(true);
    try {
      const yearParam = year ? `&year=${year}` : "";
      const res = await api.get(`/rag-trial/brs?page=${page}${yearParam}`);
      setBrsList(res.data.data);
      setBrsTotalPages(res.data.pagination.pages);
      setBrsPage(page);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to fetch BRS list"));
    } finally {
      setBrsLoading(false);
    }
  }, []);

  const fetchPubs = useCallback(async (page: number, year?: number) => {
    setPubsLoading(true);
    try {
      const yearParam = year ? `&year=${year}` : "";
      const res = await api.get(`/rag-trial/publications?page=${page}${yearParam}`);
      setPubsList(res.data.data);
      setPubsTotalPages(res.data.pagination.pages);
      setPubsPage(page);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to fetch publications"));
    } finally {
      setPubsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (activeTab === "brs") {
      fetchBrs(1, brsYear);
    } else if (activeTab === "publications") {
      fetchPubs(1, pubsYear);
    }
  }, [activeTab, brsYear, pubsYear, fetchBrs, fetchPubs]);

  const handleSelectItem = (item: BrsItem | PublicationItem, type: "brs" | "publication") => {
    setSelectedItem(item);
    setSelectedType(type);
    setExtractionResult(null);
    setCompareResult(null);
  };

  const handleExtractPdf = async () => {
    if (!selectedItem) return;
    setExtracting(true);
    setError("");
    try {
      const res = await api.post("/rag-trial/extract-pdf", {
        pdfUrl: selectedItem.pdf_url,
      });
      setExtractionResult(res.data);
      setSuccess("PDF extracted successfully");
    } catch (e) {
      setError(getErrorMessage(e, "Failed to extract PDF"));
    } finally {
      setExtracting(false);
    }
  };

  const handleCompare = async () => {
    if (!selectedItem) return;
    setComparing(true);
    setError("");
    try {
      const res = await api.post("/rag-trial/compare", {
        title: selectedItem.title,
        abstract: selectedItem.abstract_raw,
        pdfUrl: selectedItem.pdf_url,
      });
      setCompareResult(res.data);
      setSuccess("Comparison completed");
    } catch (e) {
      setError(getErrorMessage(e, "Comparison failed"));
    } finally {
      setComparing(false);
    }
  };

  const handleTestEmbed = async () => {
    if (!embedText.trim()) return;
    setEmbedding(true);
    setError("");
    try {
      const res = await api.post("/rag-trial/test-embed", {
        text: embedText,
        title: selectedItem?.title || "",
      });
      setEmbedResult(res.data.embedding ? { ...res.data.embedding, stats: res.data.stats } : null);
      setSuccess(`Embedding generated in ${res.data.stats.durationMs}ms`);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to generate embedding"));
    } finally {
      setEmbedding(false);
    }
  };

  const handleTestSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError("");
    try {
      const res = await api.post("/rag-trial/test-search", {
        query: searchQuery,
        topN: 10,
      });
      setSearchResults(res.data.results ? { 
        ...res.data.results, 
        stats: res.data.stats,
        periodFilter: res.data.periodFilter,
        queryRouting: res.data.queryRouting 
      } : null);
      const periodInfo = res.data.periodFilter?.extracted?.display 
        ? ` | Period: ${res.data.periodFilter.extracted.display}` 
        : '';
      setSuccess(`Search completed in ${res.data.stats.durationMs}ms - Found ${res.data.stats.knowledgeCount} knowledge + ${res.data.stats.datasourceCount} datasources${periodInfo}`);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to search"));
    } finally {
      setSearching(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  return (
    <RequireAuth>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">RAG Trial</h1>
            <p className="text-muted-foreground">
              Test BRS & Publication indexing before production
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="error" className="flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError("")} className="ml-2 text-sm">✕</button>
          </Alert>
        )}
        {success && (
          <Alert variant="success" className="flex justify-between items-center">
            <span>{success}</span>
            <button onClick={() => setSuccess("")} className="ml-2 text-sm">✕</button>
          </Alert>
        )}

        {statsLoading && <LoadingSpinner label="Memuat statistik…" />}

        {/* Stats Card */}
        {stats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card border rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-600">{stats.brs.total}</div>
              <div className="text-sm text-muted-foreground">BRS Documents</div>
              <div className="text-xs text-muted-foreground">{stats.brs.pages} pages</div>
            </div>
            <div className="bg-card border rounded-lg p-4">
              <div className="text-2xl font-bold text-green-600">{stats.publications.total}</div>
              <div className="text-sm text-muted-foreground">Publications</div>
              <div className="text-xs text-muted-foreground">{stats.publications.pages} pages</div>
            </div>
            <div className="bg-card border rounded-lg p-4">
              <div className="text-2xl font-bold text-purple-600">{stats.combined}</div>
              <div className="text-sm text-muted-foreground">Total Documents</div>
              <div className="text-xs text-muted-foreground">Ready for indexing</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b">
          <div className="flex gap-4">
            {(["brs", "publications", "compare"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "brs" ? "BRS List" : tab === "publications" ? "Publications" : "Compare & Analyze"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: List */}
          <div className="bg-card border rounded-lg p-4">
            {activeTab === "brs" && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">BRS Documents</h3>
                  <select
                    value={brsYear || ""}
                    onChange={(e) => setBrsYear(e.target.value ? parseInt(e.target.value) : undefined)}
                    className="px-3 py-1.5 text-sm border rounded bg-background"
                  >
                    <option value="">All Years</option>
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                {brsLoading ? (
                  <LoadingSpinner />
                ) : (
                  <>
                    <div className="space-y-2 max-h-[500px] overflow-y-auto">
                      {brsList.map((item) => (
                        <div
                          key={item.brs_id}
                          onClick={() => handleSelectItem(item, "brs")}
                          className={`p-3 border rounded cursor-pointer hover:bg-muted transition-colors ${
                            selectedItem && "brs_id" in selectedItem && selectedItem.brs_id === item.brs_id
                              ? "border-primary bg-primary/5"
                              : ""
                          }`}
                        >
                          <div className="font-medium text-sm line-clamp-2">{item.title}</div>
                          <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                            <span>{item.release_date}</span>
                            <span>•</span>
                            <span>{item.size}</span>
                            <span>•</span>
                            <span>{item.abstract.length} chars</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center mt-4">
                      <button
                        onClick={() => fetchBrs(brsPage - 1, brsYear)}
                        disabled={brsPage <= 1}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-muted-foreground">
                        Page {brsPage} of {brsTotalPages}
                      </span>
                      <button
                        onClick={() => fetchBrs(brsPage + 1, brsYear)}
                        disabled={brsPage >= brsTotalPages}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {activeTab === "publications" && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">Publications</h3>
                  <select
                    value={pubsYear || ""}
                    onChange={(e) => setPubsYear(e.target.value ? parseInt(e.target.value) : undefined)}
                    className="px-3 py-1.5 text-sm border rounded bg-background"
                  >
                    <option value="">All Years</option>
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                {pubsLoading ? (
                  <LoadingSpinner />
                ) : (
                  <>
                    <div className="space-y-2 max-h-[500px] overflow-y-auto">
                      {pubsList.map((item) => (
                        <div
                          key={item.pub_id}
                          onClick={() => handleSelectItem(item, "publication")}
                          className={`p-3 border rounded cursor-pointer hover:bg-muted transition-colors ${
                            selectedItem && "pub_id" in selectedItem && selectedItem.pub_id === item.pub_id
                              ? "border-primary bg-primary/5"
                              : ""
                          }`}
                        >
                          <div className="font-medium text-sm line-clamp-2">{item.title}</div>
                          <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                            <span>{item.release_date}</span>
                            <span>•</span>
                            <span>{item.size}</span>
                            <span>•</span>
                            <span>{item.abstract.length} chars</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center mt-4">
                      <button
                        onClick={() => fetchPubs(pubsPage - 1, pubsYear)}
                        disabled={pubsPage <= 1}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-muted-foreground">
                        Page {pubsPage} of {pubsTotalPages}
                      </span>
                      <button
                        onClick={() => fetchPubs(pubsPage + 1, pubsYear)}
                        disabled={pubsPage >= pubsTotalPages}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {activeTab === "compare" && (
              <div className="space-y-6">
                {/* RAG Search Test */}
                <div className="border-b pb-6">
                  <h3 className="font-semibold mb-3">🔍 Test RAG Search</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Test vector similarity search against current knowledge base and datasources.
                  </p>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Enter a question, e.g.: berapa jumlah penduduk maluku utara 2024?"
                    className="w-full p-2 border rounded text-sm mb-2"
                    onKeyDown={(e) => e.key === "Enter" && handleTestSearch()}
                  />
                  <button
                    onClick={handleTestSearch}
                    disabled={searching || !searchQuery.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
                  >
                    {searching ? "Searching..." : "Search Knowledge Base"}
                  </button>
                  
                  {searchResults && (
                    <div className="mt-4 space-y-4">
                      <div className="text-sm text-muted-foreground">
                        Found in {searchResults.stats.durationMs}ms
                      </div>
                      
                      {/* Period Filter Info - Applied */}
                      {searchResults.periodFilter?.applied && searchResults.periodFilter.extracted && (
                        <div className="p-3 rounded-lg border bg-amber-50 border-amber-300">
                          <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                            📅 Period Filter Applied: <span className="font-bold">{searchResults.periodFilter.extracted.display}</span>
                          </div>
                          <div className="text-xs text-amber-700 mt-1">
                            Results filtered to match data context for this period
                          </div>
                        </div>
                      )}
                      
                      {/* Period Filter Info - Partial (no year) */}
                      {!searchResults.periodFilter?.applied && searchResults.periodFilter?.extracted?.hasPartialPeriod && (
                        <div className="p-3 rounded-lg border bg-gray-50 border-gray-300">
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                            📅 Period Detected: <span className="font-bold">{searchResults.periodFilter.extracted.display}</span>
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            ⚠️ {searchResults.periodFilter.note || 'Period filter tidak diterapkan karena tidak ada tahun'}
                          </div>
                        </div>
                      )}
                      
                      {/* Relevance Filter Info */}
                      {searchResults.stats?.relevanceFilter?.applied && (
                        <div className="p-3 rounded-lg border bg-orange-50 border-orange-300">
                          <div className="flex items-center gap-2 text-sm font-medium text-orange-700">
                            🎯 Relevance Filter Applied
                          </div>
                          <div className="text-xs text-orange-600 mt-1">
                            Filtered out {searchResults.stats.relevanceFilter.filtered.knowledge} low-relevance knowledge docs 
                            (threshold: {searchResults.stats.relevanceFilter.thresholds.knowledge}) 
                            and {searchResults.stats.relevanceFilter.filtered.datasource} datasources 
                            (threshold: {searchResults.stats.relevanceFilter.thresholds.datasource})
                          </div>
                        </div>
                      )}
                      
                      {/* AI Relevance Filter Info */}
                      {searchResults.stats?.aiRelevanceFilter?.applied && (
                        <div className="p-3 rounded-lg border bg-blue-50 border-blue-300">
                          <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                            🤖 AI Relevance Filter Applied
                            <span className="text-xs font-normal text-blue-500">
                              ({searchResults.stats.aiRelevanceFilter.latencyMs}ms)
                            </span>
                          </div>
                          <div className="text-xs text-blue-600 mt-1">
                            <strong>Before:</strong> {searchResults.stats.aiRelevanceFilter.stats?.before?.datasources} datasources, {searchResults.stats.aiRelevanceFilter.stats?.before?.knowledge} knowledge docs
                            <br/>
                            <strong>After:</strong> {searchResults.stats.aiRelevanceFilter.stats?.after?.datasources} datasources, {searchResults.stats.aiRelevanceFilter.stats?.after?.knowledge} knowledge docs
                          </div>
                          {searchResults.stats.aiRelevanceFilter.reason && (
                            <div className="text-xs text-blue-700 mt-2 p-2 bg-white/50 rounded">
                              💡 {searchResults.stats.aiRelevanceFilter.reason}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Query Routing Analysis */}
                      {searchResults.queryRouting && (
                        <div className={`p-3 rounded-lg border ${
                          searchResults.queryRouting.type === 'non-statistical' 
                            ? 'bg-purple-50 border-purple-300' 
                            : 'bg-green-50 border-green-300'
                        }`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm">
                              🔀 Query Routing: <span className={`uppercase font-bold ${
                                searchResults.queryRouting.type === 'non-statistical' ? 'text-purple-700' : 'text-green-700'
                              }`}>{searchResults.queryRouting.type}</span>
                            </span>
                            <span className="text-xs text-muted-foreground space-x-2">
                              <span title="PPID, FAQ, guides">Custom: {searchResults.queryRouting.topCustomDocSimilarity}</span>
                              <span title="BRS, Publications">Stats: {searchResults.queryRouting.topStatisticalDocSimilarity}</span>
                            </span>
                          </div>
                          <div className="text-xs text-gray-600 mb-1">
                            <strong>Reason:</strong> {searchResults.queryRouting.reason}
                          </div>
                          <div className="text-xs text-gray-600 mb-1">
                            <strong>Signals:</strong> Data={searchResults.queryRouting.signals.hasDataSignal ? '✓' : '✗'}, 
                            Service={searchResults.queryRouting.signals.hasKnowledgeSignal ? '✓' : '✗'}
                          </div>
                          <div className="text-xs font-medium mt-2 p-2 bg-white/50 rounded">
                            💡 {searchResults.queryRouting.recommendation}
                          </div>
                        </div>
                      )}
                      
                      {/* STATISTICAL PACKAGE: Datasources + BRS + Publications */}
                      {(() => {
                        const statisticalDocs = searchResults.knowledge.filter(k => k.isStatistical);
                        const customDocs = searchResults.knowledge.filter(k => !k.isStatistical);
                        const hasStatistical = searchResults.datasources.length > 0 || statisticalDocs.length > 0;
                        const hasCustom = customDocs.length > 0;
                        
                        return (
                          <>
                            {/* Statistical Package */}
                            {hasStatistical && (
                              <div className="border-2 border-green-300 rounded-lg p-3 bg-green-50/50">
                                <h4 className="font-semibold text-sm mb-3 text-green-800 flex items-center gap-2">
                                  📊 Statistical Package
                                  <span className="text-xs font-normal text-green-600">
                                    (Datasources + BRS + Publications)
                                  </span>
                                </h4>
                                
                                {/* Datasources */}
                                {searchResults.datasources.length > 0 && (
                                  <div className="mb-3">
                                    <h5 className="font-medium text-xs mb-2 text-green-700">
                                      📈 Datasources ({searchResults.datasources.length})
                                    </h5>
                                    <div className="space-y-2">
                                      {searchResults.datasources.map((item, idx) => (
                                        <div key={idx} className="p-2 bg-white border border-green-200 rounded text-sm">
                                          <div className="flex justify-between items-start">
                                            <div>
                                              <span className="font-medium">{item.name}</span>
                                              {item.matchedPeriod && (
                                                <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded font-mono">
                                                  📅 {item.matchedPeriod}
                                                </span>
                                              )}
                                            </div>
                                            <span className="text-green-600 font-mono text-xs">{item.similarity}</span>
                                          </div>
                                          <div className="text-xs text-muted-foreground">{item.type}</div>
                                          {item.description && (
                                            <div className="text-xs mt-1 text-gray-600 line-clamp-2">{item.description}</div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                
                                {/* BRS & Publications */}
                                {statisticalDocs.length > 0 && (
                                  <div>
                                    <h5 className="font-medium text-xs mb-2 text-green-700">
                                      📰 BRS & Publications ({statisticalDocs.length})
                                    </h5>
                                    <div className="space-y-2">
                                      {statisticalDocs.map((item, idx) => (
                                        <div key={idx} className="p-2 bg-white border border-emerald-200 rounded text-sm">
                                          <div className="flex justify-between">
                                            <span className="font-medium">{item.title}</span>
                                            <span className="text-emerald-600 font-mono text-xs">{item.similarity}</span>
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            <span className="uppercase font-medium">{item.category}</span> • {item.source}
                                          </div>
                                          {item.snippet && (
                                            <div className="text-xs mt-1 text-gray-600 line-clamp-2">{item.snippet}</div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {/* Custom Documents (Non-Statistical) */}
                            {hasCustom && (
                              <div className="border-2 border-purple-300 rounded-lg p-3 bg-purple-50/50">
                                <h4 className="font-semibold text-sm mb-3 text-purple-800 flex items-center gap-2">
                                  📚 Custom Documents
                                  <span className="text-xs font-normal text-purple-600">
                                    (PPID, FAQ, Guides)
                                  </span>
                                </h4>
                                <div className="space-y-2">
                                  {customDocs.map((item, idx) => (
                                    <div key={idx} className="p-2 bg-white border border-purple-200 rounded text-sm">
                                      <div className="flex justify-between">
                                        <span className="font-medium">{item.title}</span>
                                        <span className="text-purple-600 font-mono text-xs">{item.similarity}</span>
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        <span className="uppercase font-medium">{item.category}</span> • {item.source}
                                      </div>
                                      {item.snippet && (
                                        <div className="text-xs mt-1 text-gray-600 line-clamp-2">{item.snippet}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {!hasStatistical && !hasCustom && (
                              <div className="text-center text-muted-foreground py-4">
                                No results found. Knowledge base may be empty or embeddings not loaded.
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Embedding Test */}
                <div>
                  <h3 className="font-semibold mb-3">🧮 Test Embedding Generation</h3>
                  <textarea
                    value={embedText}
                    onChange={(e) => setEmbedText(e.target.value)}
                    placeholder="Paste text to test embedding generation..."
                    className="w-full h-32 p-2 border rounded text-sm"
                  />
                  <button
                    onClick={handleTestEmbed}
                    disabled={embedding || !embedText.trim()}
                    className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50"
                  >
                    {embedding ? "Generating..." : "Test Embedding"}
                  </button>
                  {embedResult && (
                    <div className="mt-3 p-3 bg-muted rounded text-sm">
                      <div><strong>Dimensions:</strong> {embedResult.dimensions}</div>
                      <div><strong>Magnitude:</strong> {embedResult.magnitude.toFixed(4)}</div>
                      <div><strong>Input Length:</strong> {embedResult.stats.inputLength} chars</div>
                      <div><strong>Estimated Tokens:</strong> {embedResult.stats.estimatedTokens}</div>
                      <div><strong>Estimated Cost:</strong> ${embedResult.stats.estimatedCostUsd}</div>
                      <div><strong>Duration:</strong> {embedResult.stats.durationMs}ms</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Selected Item Details */}
          <div className="bg-card border rounded-lg p-4">
            {selectedItem ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg">{selectedItem.title}</h3>
                  <div className="text-sm text-muted-foreground">
                    {selectedType === "brs" ? "BRS" : "Publication"} • {selectedItem.release_date} • {selectedItem.size}
                  </div>
                </div>

                {/* Abstract */}
                <div>
                  <h4 className="font-medium mb-2">Abstract (Cleaned)</h4>
                  <div className="p-3 bg-muted rounded text-sm max-h-40 overflow-y-auto">
                    {selectedItem.abstract || "No abstract available"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {selectedItem.abstract.length} chars • ~{Math.ceil(selectedItem.abstract.length / 4)} tokens
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={handleExtractPdf}
                    disabled={extracting}
                    className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
                  >
                    {extracting ? "Extracting..." : "Extract PDF Text"}
                  </button>
                  <button
                    onClick={handleCompare}
                    disabled={comparing}
                    className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
                  >
                    {comparing ? "Comparing..." : "Compare Abstract vs PDF"}
                  </button>
                </div>

                {/* Extraction Result */}
                {extractionResult && (
                  <div className="border rounded p-4 space-y-3">
                    <h4 className="font-medium">PDF Extraction Result</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><strong>Pages:</strong> {extractionResult.extraction.pages}</div>
                      <div><strong>Text Length:</strong> {extractionResult.extraction.textLength} chars</div>
                      <div><strong>Download Size:</strong> {formatBytes(extractionResult.extraction.downloadSize)}</div>
                      <div><strong>Chunks:</strong> {extractionResult.chunks.count}</div>
                    </div>
                    
                    <div className={`p-2 rounded text-sm ${
                      extractionResult.analysis.quality === "good" ? "bg-green-100 text-green-800" :
                      extractionResult.analysis.quality === "moderate" ? "bg-yellow-100 text-yellow-800" :
                      "bg-red-100 text-red-800"
                    }`}>
                      <strong>Quality:</strong> {extractionResult.analysis.quality} ({extractionResult.analysis.score}/100)
                    </div>

                    <div>
                      <strong className="text-sm">Recommendations:</strong>
                      <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {extractionResult.analysis.recommendations.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>

                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium">View Extracted Text</summary>
                      <pre className="mt-2 p-2 bg-muted rounded max-h-60 overflow-auto whitespace-pre-wrap text-xs">
                        {extractionResult.fullText}
                      </pre>
                    </details>
                  </div>
                )}

                {/* Compare Result */}
                {compareResult && (
                  <div className="border rounded p-4 space-y-3">
                    <h4 className="font-medium">Comparison Result</h4>
                    
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 bg-blue-50 rounded">
                        <div className="font-medium text-blue-800">Abstract</div>
                        <div>{compareResult.comparison.abstract.length} chars</div>
                        <div>~{compareResult.comparison.abstract.tokens} tokens</div>
                        <div className="text-xs">Cost: ${compareResult.comparison.abstract.cost}</div>
                      </div>
                      <div className="p-3 bg-green-50 rounded">
                        <div className="font-medium text-green-800">PDF Full Text</div>
                        {compareResult.comparison.pdf.error ? (
                          <div className="text-red-600">{compareResult.comparison.pdf.error}</div>
                        ) : (
                          <>
                            <div>{compareResult.comparison.pdf.length} chars</div>
                            <div>~{compareResult.comparison.pdf.tokens} tokens</div>
                            <div className="text-xs">Cost: ${compareResult.comparison.pdf.cost}</div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded">
                      <strong>Recommendation:</strong>
                      <p className="text-sm mt-1">{compareResult.recommendation}</p>
                    </div>

                    {compareResult.costDifference.multiplier > 0 && (
                      <div className="text-sm text-muted-foreground">
                        PDF is <strong>{compareResult.costDifference.multiplier}x</strong> larger than abstract
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                Select a document to analyze
              </div>
            )}
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
