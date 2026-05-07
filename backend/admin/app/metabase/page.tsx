"use client";
import { useState } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import { BarChart3, ExternalLink, Play } from "lucide-react";

export default function MetabaseEmbedPage() {
  const [dashboardId, setDashboardId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  async function handleLoadDashboard() {
    if (!dashboardId.trim()) {
      setError("Dashboard ID wajib diisi");
      return;
    }
    setLoading(true);
    setError("");
    setEmbedUrl(null);
    try {
      const { data } = await api.get(`/metabase/embed/dashboard/${dashboardId.trim()}`);
      setEmbedUrl(data.iframeUrl || data.url || null);
      if (!data.iframeUrl && !data.url) {
        setError("Tidak ada embed URL yang dikembalikan");
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat dashboard"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Metabase Dashboard</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Embed Metabase dashboard langsung di admin panel.
        </p>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Dashboard Selector */}
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="number"
            placeholder="Dashboard ID (contoh: 1)"
            value={dashboardId}
            onChange={(e) => setDashboardId(e.target.value)}
            className="w-48 px-4 py-2 rounded-lg border border-border bg-background"
            onKeyDown={(e) => e.key === "Enter" && handleLoadDashboard()}
          />
          <button
            onClick={handleLoadDashboard}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Play className="h-4 w-4" />
            <span>Load Dashboard</span>
          </button>
          {embedUrl && (
            <a
              href={embedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              <span>Buka di Tab Baru</span>
            </a>
          )}
        </div>

        {loading && <LoadingSpinner label="Memuat dashboard..." />}

        {/* Embedded Dashboard */}
        {embedUrl && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <iframe
              src={embedUrl}
              className="w-full h-[70vh] border-0"
              title="Metabase Dashboard"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          </div>
        )}

        {!embedUrl && !loading && (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Masukkan Dashboard ID dan klik &quot;Load Dashboard&quot; untuk embed Metabase.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Dashboard ID bisa dilihat dari URL Metabase: /dashboard/[ID]
            </p>
          </div>
        )}

        {/* Quick Access */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold mb-3">Quick Access</h2>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((id) => (
              <button
                key={id}
                onClick={() => {
                  setDashboardId(String(id));
                  setTimeout(() => handleLoadDashboard(), 100);
                }}
                className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
              >
                Dashboard {id}
              </button>
            ))}
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
