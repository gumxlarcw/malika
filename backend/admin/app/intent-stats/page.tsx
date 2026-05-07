"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/axios";
import axios from "axios";
import RequireAuth from "@/components/RequireAuth";

type IntentStats = {
  started_at: string;
  resolved: number;
  actions: Record<string, number>;
  reasons: Record<string, number>;
  pid: number;
  uptime_s: number;
};

export default function IntentStatsPage() {
  const [stats, setStats] = useState<IntentStats | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const refreshMs = 2000;

  async function fetchStats() {
    try {
      const { data } = await api.get("/search/admin/intent-stats", { headers: { "Cache-Control": "no-store" } });
      const s = data?.stats as IntentStats | undefined;
      if (!s) throw new Error("Invalid response");
      setStats(s);
      setError("");
      setLastUpdatedAt(Date.now());
    } catch (err: unknown) {
      let msg = "Failed to load";
      if (axios.isAxiosError(err)) {
        const dataErr = (err.response?.data as any)?.error;
        msg = String(dataErr || err.message || msg);
      } else if (err instanceof Error) {
        msg = err.message || msg;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!mounted) return;
      await fetchStats();
    })();

    const id = window.setInterval(() => {
      fetchStats();
    }, refreshMs);

    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  const sortedReasons = useMemo(() => {
    const r = stats?.reasons || {};
    return Object.entries(r).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  }, [stats]);

  const sortedActions = useMemo(() => {
    const a = stats?.actions || {};
    return Object.entries(a).sort((x, y) => (y[1] || 0) - (x[1] || 0));
  }, [stats]);

  return (
    <RequireAuth>
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Search Intent · Live Stats</h1>
          <p className="text-sm text-muted-foreground">
            Auto-refresh setiap {Math.round(refreshMs / 1000)}s (pakai cookie login admin).
          </p>
        </div>
        <button
          className="px-3 py-2 rounded border border-border hover:bg-muted"
          onClick={() => fetchStats()}
          disabled={loading}
        >
          Refresh sekarang
        </button>
      </div>

      {error && (
        <div className="p-3 rounded border border-destructive text-destructive">
          Error: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded border border-border">
          <div className="text-sm text-muted-foreground">Resolved</div>
          <div className="text-3xl font-bold">{stats?.resolved ?? (loading ? "…" : 0)}</div>
        </div>
        <div className="p-4 rounded border border-border">
          <div className="text-sm text-muted-foreground">PID</div>
          <div className="text-3xl font-bold">{stats?.pid ?? (loading ? "…" : "-")}</div>
        </div>
        <div className="p-4 rounded border border-border">
          <div className="text-sm text-muted-foreground">Last updated</div>
          <div className="text-base font-semibold">
            {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : loading ? "…" : "-"}
          </div>
          <div className="text-xs text-muted-foreground">Uptime: {stats?.uptime_s ?? (loading ? "…" : "-")}s</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-4 rounded border border-border">
          <div className="text-base font-semibold mb-3">Actions</div>
          {sortedActions.length === 0 ? (
            <div className="text-sm text-muted-foreground">Belum ada data.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">Action</th>
                  <th className="py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {sortedActions.map(([k, v]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="py-2 font-mono">{k}</td>
                    <td className="py-2">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 rounded border border-border">
          <div className="text-base font-semibold mb-3">Reasons</div>
          {sortedReasons.length === 0 ? (
            <div className="text-sm text-muted-foreground">Belum ada data.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">Reason</th>
                  <th className="py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {sortedReasons.map(([k, v]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="py-2 font-mono">{k}</td>
                    <td className="py-2">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Note: stats ini per-instance proses (PM2). Kalau cluster, tiap instance beda.
      </div>
    </div>
    </RequireAuth>
  );
}
