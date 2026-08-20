"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/axios";
import StatCard from "@/components/StatCard";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import Skeleton from "@/components/Skeleton";
import PetaTematikSection from "@/components/peta-tematik/PetaTematikSection";
import { fmt, maxDate } from "@/lib/formatters";
import { getErrorMessage } from "@/lib/errors";

interface Datasource {
  id: number;
  name: string;
  type: string;
  visible: boolean;
  status: boolean;
}

interface AutomationItem {
  id: number;
  name: string;
  automation?: {
    enabled?: boolean;
    mode?: string;
    last_run_at?: string;
    last_success_at?: string;
    last_error?: string;
    last_pull_finished_at?: string;
    last_bps_last_update?: string;
  };
  production?: {
    exists?: boolean;
    last_pulled_at?: string;
    last_update?: string;
  };
}

interface AutomationStatusResult {
  items?: AutomationItem[];
  scheduler_enabled?: boolean;
  poll_minutes?: number;
  min_interval_hours?: number;
}

interface StatusJobStartResponse {
  job?: { jobId?: string };
  message?: string;
}

interface StatusJobStatusResponse {
  job?: {
    status?: "pending" | "running" | "done" | "failed";
    data?: AutomationStatusResult;
    error?: string;
  };
}

/**
 * Run the automation status async job pattern (POST → poll → done) and return
 * the aggregated status. Used by dashboard KPIs. Mirrors the loop in
 * /automation page.tsx but without the per-tick progress updates since the
 * dashboard only needs the final tally. Polls up to ~20s before giving up.
 */
async function fetchAutomationStatusViaJob(): Promise<AutomationStatusResult> {
  const startRes = await api.post<StatusJobStartResponse>("/automation/status-job", {});
  const jobId = startRes.data?.job?.jobId;
  if (!jobId) throw new Error(startRes.data?.message || "Status job tidak bisa dimulai");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const statusRes = await api.get<StatusJobStatusResponse>(`/automation/status-job/${jobId}`);
    const j = statusRes.data?.job;
    if (!j) throw new Error("Status job response kosong");
    if (j.status === "done") return j.data || {};
    if (j.status === "failed") throw new Error(j.error || "Status job gagal");
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Status job timeout (>20s)");
}

interface DashboardStats {
  total: number;
  visible: number;
  active: number;
  dynamicCount: number;
  interopCount: number;
  staticCount: number;
  eximCount: number;
  enabled: number;
  failed: number;
  prodReady: number;
  prodMissing: number;
  smartMode: number;
  dailyMode: number;
  lastPulledAt: string | null;
  lastBpsUpdate: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  schedulerEnabled: boolean;
  pollMinutes: number;
  minIntervalHours: number;
}

interface AnalyticsStats {
  liveUsers: number;
  uniqueUsersToday: number;
  pageViewsToday: number;
  pageViewsLastHour: number;
  totalPageViews: number;
  totalSessions: number;
  topPages: Array<{ page_path: string; views: number }>;
  liveSessions: Array<{
    session_id: string;
    last_page: string;
    last_seen_at: string;
    page_count: number;
    ip_address: string;
  }>;
  hourlyData: Array<{ hour: number; views: number; users: number }>;
  liveThresholdMinutes: number;
}

interface CalendarStats {
  year: number;
  month: number;
  daysInMonth: number;
  dailyStats: Record<string, { views: number; users: number; avgDuration?: number }>;
  totalViews: number;
  totalUsers: number;
  activeDays: number;
  avgDuration?: number;
  maxViews?: number;
  maxUsers?: number;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsStats | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  
  // Calendar state
  const [calendarStats, setCalendarStats] = useState<CalendarStats | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth() + 1);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());

  const loadCalendar = useCallback(async (year: number, month: number) => {
    setCalendarLoading(true);
    try {
      const res = await api.get<CalendarStats & { ok: boolean }>(`/analytics/calendar?year=${year}&month=${month}`);
      if (res.data?.ok) {
        setCalendarStats(res.data);
      }
    } catch (e) {
      console.error("Failed to load calendar:", e);
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await api.get<AnalyticsStats & { ok: boolean }>("/analytics/dashboard");
      if (res.data?.ok) {
        setAnalytics(res.data);
      }
    } catch (e) {
      console.error("Failed to load analytics:", e);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        // GET /automation was removed in the 2026-05-11 audit. The replacement
        // is the async job pattern used by /automation page: POST to start a
        // status job, then poll its progress endpoint until `done`. Dashboard
        // uses the same flow so KPI counts stay accurate without re-introducing
        // the removed sync endpoint.
        const [dsRes, automation] = await Promise.all([
          api.get<Datasource[]>("/datasource/admin"),
          fetchAutomationStatusViaJob().catch(() => ({} as AutomationStatusResult)),
        ]);

        const datasources = Array.isArray(dsRes.data) ? dsRes.data : [];
        const items = Array.isArray(automation.items) ? automation.items : [];

        const total = datasources.length;
        const visible = datasources.filter((d) => Boolean(d.visible)).length;
        const active = datasources.filter((d) => Boolean(d.status)).length;
        const dynamicCount = datasources.filter((d) => d.type === "dynamic").length;
        const interopCount = datasources.filter((d) => d.type === "interop").length;
        const staticCount = datasources.filter((d) => d.type === "static").length;
        const eximCount = datasources.filter((d) => d.type === "exim").length;

        const enabled = items.filter((i) => Boolean(i?.automation?.enabled)).length;
        const failed = items.filter((i) => Boolean(i?.automation?.last_error)).length;
        const prodReady = items.filter((i) => Boolean(i?.production?.exists)).length;
        const prodMissing = items.filter((i) => !Boolean(i?.production?.exists)).length;
        const smartMode = items.filter((i) => i?.automation?.enabled && i?.automation?.mode === "smart").length;
        const dailyMode = items.filter((i) => i?.automation?.enabled && i?.automation?.mode === "daily").length;

        let lastPulledAt: string | null = null;
        let lastBpsUpdate: string | null = null;
        let lastRunAt: string | null = null;
        let lastSuccessAt: string | null = null;

        for (const it of items) {
          const pulled = maxDate(it?.production?.last_pulled_at || null, it?.automation?.last_pull_finished_at || null);
          lastPulledAt = maxDate(lastPulledAt, pulled);

          const bps = maxDate(it?.production?.last_update || null, it?.automation?.last_bps_last_update || null);
          lastBpsUpdate = maxDate(lastBpsUpdate, bps);

          lastRunAt = maxDate(lastRunAt, it?.automation?.last_run_at || null);
          lastSuccessAt = maxDate(lastSuccessAt, it?.automation?.last_success_at || null);
        }

        const schedulerEnabled = Boolean(automation.scheduler_enabled);
        const pollMinutes = Number(automation.poll_minutes || 0);
        const minIntervalHours = Number(automation.min_interval_hours || 0);

        setStats({
          total,
          visible,
          active,
          dynamicCount,
          interopCount,
          staticCount,
          eximCount,
          enabled,
          failed,
          prodReady,
          prodMissing,
          smartMode,
          dailyMode,
          lastPulledAt,
          lastBpsUpdate,
          lastRunAt,
          lastSuccessAt,
          schedulerEnabled,
          pollMinutes,
          minIntervalHours,
        });
      } catch (e) {
        setError(getErrorMessage(e, "Failed to load dashboard. Please login."));
      } finally {
        setLoading(false);
      }
    }
    load();
    loadAnalytics();
    loadCalendar(calendarYear, calendarMonth);
  }, [loadAnalytics, loadCalendar, calendarYear, calendarMonth]);

  // Auto-refresh analytics every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadAnalytics();
      setLastRefresh(new Date());
    }, 30000);

    return () => clearInterval(interval);
  }, [loadAnalytics]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <RequireAuth>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <span className="text-xs text-gray-500">
            Terakhir diperbarui: {formatTime(lastRefresh)}
          </span>
        </div>

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, idx) => (
              <Skeleton key={idx} className="h-28" />
            ))}
          </div>
        )}

        {error && <Alert variant="error">{error}</Alert>}

        {!loading && !error && stats && (
          <>
            {/* ==================== LIVE ANALYTICS ==================== */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                Live Analytics
              </h2>
              
              {analyticsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-28" />
                  ))}
                </div>
              ) : analytics ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard
                    title="🟢 Live Users"
                    value={analytics.liveUsers}
                    variant={analytics.liveUsers > 0 ? "primary" : "default"}
                    subtitle={`Aktif ${analytics.liveThresholdMinutes} menit terakhir`}
                  />
                  <StatCard
                    title="👤 Pengunjung Hari Ini"
                    value={analytics.uniqueUsersToday}
                    variant="primary"
                    subtitle="Unique sessions"
                  />
                  <StatCard
                    title="📊 Page Views Hari Ini"
                    value={analytics.pageViewsToday}
                    subtitle={`${analytics.pageViewsLastHour} dalam 1 jam terakhir`}
                  />
                  <StatCard
                    title="📈 Total Page Views"
                    value={analytics.totalPageViews.toLocaleString()}
                    subtitle={`${analytics.totalSessions.toLocaleString()} total sessions`}
                  />
                </div>
              ) : (
                <Alert variant="warning">
                  Belum ada data analytics. Pastikan tracking sudah diaktifkan di frontend.
                </Alert>
              )}

              {/* Live Sessions Table */}
              {analytics && analytics.liveSessions.length > 0 && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <h3 className="text-sm font-medium text-gray-700">
                      🟢 Live Sessions ({analytics.liveSessions.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Halaman</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Views</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Seen</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {analytics.liveSessions.slice(0, 5).map((session) => (
                          <tr key={session.session_id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm text-gray-900 max-w-xs truncate">
                              {session.last_page || '-'}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-600">{session.page_count}</td>
                            <td className="px-4 py-2 text-sm text-gray-500">
                              {session.last_seen_at ? new Date(session.last_seen_at).toLocaleTimeString('id-ID') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Top Pages Today */}
              {analytics && analytics.topPages.length > 0 && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <h3 className="text-sm font-medium text-gray-700">
                      📄 Top Pages Hari Ini
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Halaman</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Views</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {analytics.topPages.slice(0, 8).map((page, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm text-gray-900">{page.page_path}</td>
                            <td className="px-4 py-2 text-sm text-gray-600 text-right font-medium">{page.views}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Visitor Calendar - Redesigned */}
              <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                {/* Header with navigation */}
                <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                      <span className="text-xl">📅</span>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">Kalender Pengunjung</h3>
                      <p className="text-blue-100 text-sm">Statistik harian pengunjung website</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        const newMonth = calendarMonth === 1 ? 12 : calendarMonth - 1;
                        const newYear = calendarMonth === 1 ? calendarYear - 1 : calendarYear;
                        setCalendarMonth(newMonth);
                        setCalendarYear(newYear);
                        loadCalendar(newYear, newMonth);
                      }}
                      className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="text-white font-medium min-w-[140px] text-center">
                      {new Date(calendarYear, calendarMonth - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
                    </span>
                    <button
                      onClick={() => {
                        const newMonth = calendarMonth === 12 ? 1 : calendarMonth + 1;
                        const newYear = calendarMonth === 12 ? calendarYear + 1 : calendarYear;
                        setCalendarMonth(newMonth);
                        setCalendarYear(newYear);
                        loadCalendar(newYear, newMonth);
                      }}
                      className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                {calendarLoading ? (
                  <div className="p-6">
                    <Skeleton className="h-80" />
                  </div>
                ) : calendarStats ? (
                  <div className="p-6">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-blue-600">📊</span>
                          <span className="text-xs font-medium text-blue-600 uppercase tracking-wide">Total Views</span>
                        </div>
                        <p className="text-2xl font-bold text-blue-900">{calendarStats.totalViews.toLocaleString()}</p>
                      </div>
                      <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4 border border-emerald-200">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-emerald-600">👤</span>
                          <span className="text-xs font-medium text-emerald-600 uppercase tracking-wide">Pengunjung Unik</span>
                        </div>
                        <p className="text-2xl font-bold text-emerald-900">{calendarStats.totalUsers.toLocaleString()}</p>
                      </div>
                      <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4 border border-amber-200">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-amber-600">📅</span>
                          <span className="text-xs font-medium text-amber-600 uppercase tracking-wide">Hari Aktif</span>
                        </div>
                        <p className="text-2xl font-bold text-amber-900">{calendarStats.activeDays} <span className="text-sm font-normal text-amber-700">/ {calendarStats.daysInMonth}</span></p>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-purple-600">⏱️</span>
                          <span className="text-xs font-medium text-purple-600 uppercase tracking-wide">Rata-rata Durasi</span>
                        </div>
                        <p className="text-2xl font-bold text-purple-900">
                          {calendarStats.avgDuration ? (
                            calendarStats.avgDuration >= 60 
                              ? `${Math.floor(calendarStats.avgDuration / 60)}m ${calendarStats.avgDuration % 60}s`
                              : `${calendarStats.avgDuration}s`
                          ) : '-'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Calendar Grid */}
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="grid grid-cols-7 gap-2">
                        {/* Day headers */}
                        {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map((day, idx) => (
                          <div key={day} className={`text-center text-xs font-semibold py-2 ${idx === 0 ? 'text-red-500' : idx === 6 ? 'text-blue-500' : 'text-gray-600'}`}>
                            {day}
                          </div>
                        ))}
                        
                        {/* Empty cells for days before first day of month */}
                        {Array.from({ length: new Date(calendarYear, calendarMonth - 1, 1).getDay() }).map((_, idx) => (
                          <div key={`empty-${idx}`} className="aspect-square" />
                        ))}
                        
                        {/* Day cells */}
                        {Array.from({ length: calendarStats.daysInMonth }).map((_, idx) => {
                          const day = idx + 1;
                          const dayStats = calendarStats.dailyStats[String(day)];
                          const views = dayStats?.views || 0;
                          const users = dayStats?.users || 0;
                          const avgDuration = dayStats?.avgDuration || 0;
                          
                          // Use maxViews from API for consistent scaling
                          const maxViews = calendarStats.maxViews || 1;
                          const intensity = views / maxViews;
                          
                          // Gradient color based on intensity
                          let bgClass = 'bg-white border-gray-200';
                          let textClass = 'text-gray-700';
                          let badgeClass = 'bg-gray-100 text-gray-500';
                          
                          if (views > 0) {
                            if (intensity > 0.75) {
                              bgClass = 'bg-gradient-to-br from-blue-500 to-indigo-600 border-blue-600';
                              textClass = 'text-white';
                              badgeClass = 'bg-white/20 text-white';
                            } else if (intensity > 0.5) {
                              bgClass = 'bg-gradient-to-br from-blue-400 to-blue-500 border-blue-500';
                              textClass = 'text-white';
                              badgeClass = 'bg-white/20 text-white';
                            } else if (intensity > 0.25) {
                              bgClass = 'bg-blue-100 border-blue-300';
                              textClass = 'text-blue-800';
                              badgeClass = 'bg-blue-200 text-blue-700';
                            } else {
                              bgClass = 'bg-blue-50 border-blue-200';
                              textClass = 'text-blue-700';
                              badgeClass = 'bg-blue-100 text-blue-600';
                            }
                          }
                          
                          const isToday = new Date().getDate() === day && 
                                         new Date().getMonth() + 1 === calendarMonth && 
                                         new Date().getFullYear() === calendarYear;
                          
                          const dayOfWeek = new Date(calendarYear, calendarMonth - 1, day).getDay();
                          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                          
                          // Format duration
                          const formatDuration = (secs: number) => {
                            if (!secs) return '-';
                            if (secs >= 60) return `${Math.floor(secs / 60)}m`;
                            return `${secs}s`;
                          };
                          
                          return (
                            <div
                              key={day}
                              className={`relative rounded-lg border ${bgClass} ${isToday ? 'ring-2 ring-orange-400 ring-offset-1' : ''} 
                                         p-2 min-h-[70px] cursor-default group transition-all hover:shadow-md hover:scale-[1.02]`}
                            >
                              {/* Day number */}
                              <div className={`text-sm font-bold ${textClass} ${isWeekend && views === 0 ? (dayOfWeek === 0 ? 'text-red-400' : 'text-blue-400') : ''}`}>
                                {day}
                                {isToday && <span className="ml-1 text-[9px] font-normal opacity-70">Hari ini</span>}
                              </div>
                              
                              {/* Stats */}
                              {views > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  <div className={`text-[10px] font-medium ${badgeClass} rounded px-1 py-0.5 inline-block`}>
                                    👁️ {views}
                                  </div>
                                  <div className={`text-[10px] ${textClass} opacity-80 block`}>
                                    👤 {users}
                                  </div>
                                </div>
                              )}
                              
                              {/* Hover Tooltip */}
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block 
                                            bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl whitespace-nowrap z-20
                                            before:content-[''] before:absolute before:top-full before:left-1/2 before:-translate-x-1/2 
                                            before:border-4 before:border-transparent before:border-t-gray-900">
                                <div className="font-semibold mb-1">
                                  {day} {new Date(calendarYear, calendarMonth - 1).toLocaleDateString('id-ID', { month: 'short' })} {calendarYear}
                                </div>
                                <div className="space-y-0.5">
                                  <div>📊 Page Views: <span className="font-medium">{views}</span></div>
                                  <div>👤 Pengunjung Unik: <span className="font-medium">{users}</span></div>
                                  <div>⏱️ Durasi Rata-rata: <span className="font-medium">{formatDuration(avgDuration)}</span></div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    
                    {/* Legend */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="font-medium">Intensitas:</span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded bg-white border border-gray-200"></div>
                          <div className="w-5 h-5 rounded bg-blue-50 border border-blue-200"></div>
                          <div className="w-5 h-5 rounded bg-blue-100 border border-blue-300"></div>
                          <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-400 to-blue-500"></div>
                          <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-500 to-indigo-600"></div>
                        </div>
                        <span className="text-gray-400">Sedikit → Banyak</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <span className="w-3 h-3 rounded ring-2 ring-orange-400"></span>
                          Hari ini
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="text-red-400 font-semibold">Min</span>
                          <span className="text-gray-300">|</span>
                          <span className="text-blue-400 font-semibold">Sab</span>
                          Weekend
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-gray-500">
                    <div className="text-4xl mb-2">📅</div>
                    <p>Tidak ada data kalender untuk periode ini.</p>
                  </div>
                )}
              </div>
            </div>

            {/* ==================== DATA MANAGEMENT ==================== */}
            <div className="space-y-3 pt-4 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-700">📦 Data Management</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Total Datasource"
                  value={stats.total}
                  variant="primary"
                  subtitle={`Visible: ${stats.visible} • Aktif: ${stats.active}`}
                />
                <StatCard
                  title="Komposisi Type"
                  value={`${stats.dynamicCount} dyn`}
                  subtitle={`Interop: ${stats.interopCount} • EXIM: ${stats.eximCount} • Static: ${stats.staticCount}`}
                />
                <StatCard
                  title="Visible"
                  value={stats.visible}
                  subtitle={`Hidden: ${Math.max(0, stats.total - stats.visible)}`}
                />
                <StatCard
                  title="Status Aktif"
                  value={stats.active}
                  subtitle={`Nonaktif: ${Math.max(0, stats.total - stats.active)}`}
                />
              </div>
            </div>

            {/* ==================== AUTOMATION ==================== */}
            <div className="space-y-3 pt-4 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-700">⚙️ Automation & Scheduler</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Scheduler"
                  value={stats.schedulerEnabled ? "ON" : "OFF"}
                  variant={stats.schedulerEnabled ? "primary" : "default"}
                  subtitle={`Cek tiap ${stats.pollMinutes} menit • Min interval ${stats.minIntervalHours} jam`}
                />
                <StatCard
                  title="Automasi Aktif"
                  value={`${stats.enabled}/${stats.total}`}
                  variant="primary"
                  subtitle={`Smart: ${stats.smartMode} • Daily: ${stats.dailyMode}`}
                />
                <StatCard
                  title="FAILED (Terakhir)"
                  value={stats.failed}
                  variant={stats.failed > 0 ? "destructive" : "default"}
                  subtitle={stats.failed > 0 ? "Periksa log terakhir" : "Tidak ada error"}
                />
                <StatCard
                  title="Tabel Produksi Siap"
                  value={`${stats.prodReady}/${stats.total}`}
                  variant={stats.prodReady > 0 ? "primary" : "default"}
                  subtitle={`Belum ada: ${stats.prodMissing}`}
                />
              </div>
            </div>

            {/* ==================== SYNC STATUS ==================== */}
            <div className="space-y-3 pt-4 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-700">🔄 Sync Status</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Terakhir Ditarik"
                  value={fmt(stats.lastPulledAt)}
                  subtitle={`Last run: ${fmt(stats.lastRunAt)}`}
                />
                <StatCard
                  title="Last Update (BPS)"
                  value={fmt(stats.lastBpsUpdate)}
                  subtitle={`Last success: ${fmt(stats.lastSuccessAt)}`}
                />
                <StatCard
                  title="Smart Mode (Enabled)"
                  value={stats.smartMode}
                  subtitle={`Daily mode: ${stats.dailyMode}`}
                />
                <StatCard
                  title="Daily Mode (Enabled)"
                  value={stats.dailyMode}
                  subtitle={`Smart mode: ${stats.smartMode}`}
                />
              </div>
            </div>

            {/* ==================== PETA TEMATIK ==================== */}
            <PetaTematikSection />
          </>
        )}
      </div>
    </RequireAuth>
  );
}
