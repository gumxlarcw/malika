"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import { api } from "@/lib/axios";
import Alert from "@/components/Alert";
import LoadingSpinner from "@/components/LoadingSpinner";
import { getErrorMessage } from "@/lib/errors";
import { fmt } from "@/lib/formatters";


type NotificationItem = {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  unique_key: string;
  created_at: string;
};

type NotificationsListResponse = {
  ok: boolean;
  limit: number;
  offset: number;
  items: NotificationItem[];
  message?: string;
};

type SchedulerSettings = {
  mode: "daily" | "interval";
  interval_minutes: number | null;
  run_hour: number;
  run_minute: number;
};

type SchedulerSettingsGetResponse = {
  ok: boolean;
  settings?: {
    automation?: SchedulerSettings | null;
    publication?: SchedulerSettings | null;
    mergedcache?: SchedulerSettings | null;
    pressrelease?: SchedulerSettings | null;
  };
  active?: {
    publication?: {
      enabled_env?: boolean;
      effective?: any;
      state?: any;
    } | null;
    mergedcache?: {
      enabled_env?: boolean;
      effective?: any;
      state?: any;
    } | null;
    pressrelease?: {
      enabled_env?: boolean;
      effective?: any;
      state?: any;
    } | null;
  };
  message?: string;
};

type PushLogItem = {
  id: number;
  notification_id: number | null;
  notification_unique_key: string | null;
  notification_type: string | null;
  notification_title: string | null;
  trigger: string;
  sent: number;
  failed: number;
  skipped: boolean;
  created_at: string;
};

type PushLogsListResponse = {
  ok: boolean;
  limit: number;
  offset: number;
  items: PushLogItem[];
  message?: string;
};

export default function AutomationNotificationsPage() {
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState<string>("");
  const [notifLimit] = useState<number>(50);
  const [notifOffset, setNotifOffset] = useState<number>(0);
  const [notifType, setNotifType] = useState<string>("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState<string>("");
  const [pushLimit] = useState<number>(50);
  const [pushOffset, setPushOffset] = useState<number>(0);
  const [pushTrigger, setPushTrigger] = useState<string>("");

  // Scheduler settings (Notification automation)
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedError, setSchedError] = useState<string>("");
  const [schedSuccess, setSchedSuccess] = useState<string>("");

  const [pubMode, setPubMode] = useState<"daily" | "interval">("daily");
  const [pubIntervalMinutes, setPubIntervalMinutes] = useState<string>("");
  const [pubTime, setPubTime] = useState<string>("08:00");

  const [mergedMode, setMergedMode] = useState<"daily" | "interval">("interval");
  const [mergedIntervalMinutes, setMergedIntervalMinutes] = useState<string>("30");
  const [mergedTime, setMergedTime] = useState<string>("08:00");

  const [prMode, setPrMode] = useState<"daily" | "interval">("daily");
  const [prIntervalMinutes, setPrIntervalMinutes] = useState<string>("");
  const [prTime, setPrTime] = useState<string>("08:15");

  const [activePublication, setActivePublication] = useState<any>(null);
  const [activeMergedCache, setActiveMergedCache] = useState<any>(null);
  const [activePressRelease, setActivePressRelease] = useState<any>(null);
  const [pushLogs, setPushLogs] = useState<PushLogItem[]>([]);

  const canPrevNotif = useMemo(() => notifOffset > 0, [notifOffset]);
  const canPrevPush = useMemo(() => pushOffset > 0, [pushOffset]);

  async function loadNotifications(nextOffset: number) {
    setNotifLoading(true);
    setNotifError("");
    try {
      const params: any = { limit: notifLimit, offset: nextOffset };
      if (notifType.trim()) params.type = notifType.trim();
      const { data } = await api.get<NotificationsListResponse>("/automation/notifications/notifications", { params });
      if (!data?.ok) throw new Error(data?.message || "Gagal memuat notifikasi");
      setNotifications(data.items || []);
      setNotifOffset(nextOffset);
    } catch (e) {
      setNotifError(getErrorMessage(e, "Gagal memuat notifikasi"));
    } finally {
      setNotifLoading(false);
    }
  }

  async function loadPushLogs(nextOffset: number) {
    setPushLoading(true);
    setPushError("");
    try {
      const params: any = { limit: pushLimit, offset: nextOffset };
      if (pushTrigger.trim()) params.trigger = pushTrigger.trim();
      const { data } = await api.get<PushLogsListResponse>("/automation/notifications/push-logs", { params });
      if (!data?.ok) throw new Error(data?.message || "Gagal memuat log push");
      setPushLogs(data.items || []);
      setPushOffset(nextOffset);
    } catch (e) {
      setPushError(getErrorMessage(e, "Gagal memuat log push"));
    } finally {
      setPushLoading(false);
    }
  }

  async function loadSchedulerSettings() {
    setSchedLoading(true);
    setSchedError("");
    setSchedSuccess("");
    try {
      const { data } = await api.get<SchedulerSettingsGetResponse>("/automation/scheduler-settings");
      if (!data?.ok) throw new Error(data?.message || "Gagal memuat setting scheduler");

      setActivePublication(data?.active?.publication || null);
      setActiveMergedCache(data?.active?.mergedcache || null);
      setActivePressRelease(data?.active?.pressrelease || null);

      const pub = data?.settings?.publication;
      if (pub) {
        setPubMode(pub.mode === "interval" ? "interval" : "daily");
        setPubIntervalMinutes(pub.interval_minutes != null ? String(pub.interval_minutes) : "");
        setPubTime(`${String(pub.run_hour ?? 8).padStart(2, "0")}:${String(pub.run_minute ?? 0).padStart(2, "0")}`);
      }

      const merged = data?.settings?.mergedcache;
      if (merged) {
        setMergedMode(merged.mode === "interval" ? "interval" : "daily");
        setMergedIntervalMinutes(merged.interval_minutes != null ? String(merged.interval_minutes) : "");
        setMergedTime(`${String(merged.run_hour ?? 8).padStart(2, "0")}:${String(merged.run_minute ?? 0).padStart(2, "0")}`);
      }

      const pr = data?.settings?.pressrelease;
      if (pr) {
        setPrMode(pr.mode === "interval" ? "interval" : "daily");
        setPrIntervalMinutes(pr.interval_minutes != null ? String(pr.interval_minutes) : "");
        setPrTime(`${String(pr.run_hour ?? 8).padStart(2, "0")}:${String(pr.run_minute ?? 15).padStart(2, "0")}`);
      }
    } catch (e: unknown) {
      setSchedError(getErrorMessage(e, "Gagal memuat setting scheduler"));
    } finally {
      setSchedLoading(false);
    }
  }

  async function saveSchedulerSettings() {
    setSchedLoading(true);
    setSchedError("");
    setSchedSuccess("");
    try {
      const pubIntervalNum = pubIntervalMinutes.trim() ? Number(pubIntervalMinutes) : null;
      const mergedIntervalNum = mergedIntervalMinutes.trim() ? Number(mergedIntervalMinutes) : null;
      const prIntervalNum = prIntervalMinutes.trim() ? Number(prIntervalMinutes) : null;

      await api.post("/automation/scheduler-settings", {
        publication: {
          mode: pubMode,
          interval_minutes: Number.isFinite(pubIntervalNum as number) ? pubIntervalNum : null,
          time: pubTime,
        },
        mergedcache: {
          mode: mergedMode,
          interval_minutes: Number.isFinite(mergedIntervalNum as number) ? mergedIntervalNum : null,
          time: mergedTime,
        },
        pressrelease: {
          mode: prMode,
          interval_minutes: Number.isFinite(prIntervalNum as number) ? prIntervalNum : null,
          time: prTime,
        },
      });

      await api.post("/automation/scheduler-settings/restart?target=publication,mergedcache,pressrelease", {});
      setSchedSuccess("Setting scheduler disimpan & schedulers direstart.");
      await loadSchedulerSettings();
    } catch (e: unknown) {
      setSchedError(getErrorMessage(e, "Gagal menyimpan setting scheduler"));
    } finally {
      setSchedLoading(false);
    }
  }

  useEffect(() => {
    loadNotifications(0);
    loadPushLogs(0);
    loadSchedulerSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card text-card-foreground p-3 text-sm space-y-2">
          <div className="font-medium">Jadwal Scheduler (Notifikasi)</div>
          <div className="text-muted-foreground leading-relaxed">
            Setting ini mengatur kapan scheduler <b>Publication</b> dan <b>Merged Cache Watch</b> berjalan. Perubahan berlaku setelah restart scheduler.
          </div>

          {schedError ? <Alert variant="error">{schedError}</Alert> : null}
          {schedSuccess ? <Alert variant="success">{schedSuccess}</Alert> : null}

          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              Publication aktif: {activePublication?.enabled_env === false ? "DISABLED (env)" : activePublication?.state?.enabled === false ? "DISABLED" : "ENABLED"}
              {activePublication?.effective ? ` | effective=${activePublication.effective.mode}${activePublication.effective.intervalMinutes ? `(${activePublication.effective.intervalMinutes}m)` : activePublication.effective.runHour != null ? `@${String(activePublication.effective.runHour).padStart(2, "0")}:${String(activePublication.effective.runMinute || 0).padStart(2, "0")}` : ""} source=${activePublication.effective.source || "?"}` : ""}
              {activePublication?.state?.nextRunAt ? ` | next=${new Date(activePublication.state.nextRunAt).toLocaleString()}` : ""}
            </div>
            <div>
              MergedCache aktif: {activeMergedCache?.enabled_env === false ? "DISABLED (env)" : activeMergedCache?.state?.enabled === false ? "DISABLED" : "ENABLED"}
              {activeMergedCache?.effective ? ` | effective=${activeMergedCache.effective.mode}${activeMergedCache.effective.intervalMinutes ? `(${activeMergedCache.effective.intervalMinutes}m)` : activeMergedCache.effective.runHour != null ? `@${String(activeMergedCache.effective.runHour).padStart(2, "0")}:${String(activeMergedCache.effective.runMinute || 0).padStart(2, "0")}` : ""} source=${activeMergedCache.effective.source || "?"}` : ""}
              {activeMergedCache?.state?.nextRunAt ? ` | next=${new Date(activeMergedCache.state.nextRunAt).toLocaleString()}` : ""}
            </div>

            <div>
              Pressrelease aktif: {activePressRelease?.enabled_env === false ? "DISABLED (env)" : activePressRelease?.state?.enabled === false ? "DISABLED" : "ENABLED"}
              {activePressRelease?.effective ? ` | effective=${activePressRelease.effective.mode}${activePressRelease.effective.intervalMinutes ? `(${activePressRelease.effective.intervalMinutes}m)` : activePressRelease.effective.runHour != null ? `@${String(activePressRelease.effective.runHour).padStart(2, "0")}:${String(activePressRelease.effective.runMinute || 0).padStart(2, "0")}` : ""} source=${activePressRelease.effective.source || "?"}` : ""}
              {activePressRelease?.state?.nextRunAt ? ` | next=${new Date(activePressRelease.state.nextRunAt).toLocaleString()}` : ""}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="font-medium">Publication Scheduler</div>
              <div className="flex flex-col md:flex-row md:items-end gap-2">
                <div className="flex flex-col">
                  <label className="text-xs text-muted-foreground">Mode</label>
                  <select
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={pubMode}
                    onChange={(e) => setPubMode(e.target.value === "interval" ? "interval" : "daily")}
                    disabled={schedLoading}
                  >
                    <option value="daily">Jam harian</option>
                    <option value="interval">Interval (menit)</option>
                  </select>
                </div>

                <div className="flex flex-col">
                  <label className="text-xs text-muted-foreground">Interval (menit)</label>
                  <input
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={pubIntervalMinutes}
                    onChange={(e) => setPubIntervalMinutes(e.target.value)}
                    placeholder="mis. 30"
                    disabled={schedLoading || pubMode !== "interval"}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-xs text-muted-foreground">Jam (HH:MM)</label>
                  <input
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={pubTime}
                    onChange={(e) => setPubTime(e.target.value)}
                    placeholder="08:00"
                    disabled={schedLoading || pubMode !== "daily"}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="font-medium">Merged Cache Watch Scheduler</div>
              <div className="flex flex-col md:flex-row md:items-end gap-2">
                <div className="flex flex-col">
                  <label className="text-xs text-muted-foreground">Mode</label>
                  <select
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={mergedMode}
                    onChange={(e) => setMergedMode(e.target.value === "interval" ? "interval" : "daily")}
                    disabled={schedLoading}
                  >
                    <option value="daily">Jam harian</option>
                    <option value="interval">Interval (menit)</option>
                  </select>
                </div>

                <div className="flex flex-col">
                  <label className="text-xs text-muted-foreground">Interval (menit)</label>
                  <input
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={mergedIntervalMinutes}
                    onChange={(e) => setMergedIntervalMinutes(e.target.value)}
                    placeholder="mis. 30"
                    disabled={schedLoading || mergedMode !== "interval"}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-xs text-muted-foreground">Jam (HH:MM)</label>
                  <input
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={mergedTime}
                    onChange={(e) => setMergedTime(e.target.value)}
                    placeholder="08:00"
                    disabled={schedLoading || mergedMode !== "daily"}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="font-medium">Pressrelease (BRS) Scheduler</div>
              <div className="flex flex-col md:flex-row md:items-end gap-2">
                <div className="flex flex-col">
                  <label className="text-xs text-muted-foreground">Mode</label>
                  <select
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={prMode}
                    onChange={(e) => setPrMode(e.target.value === "interval" ? "interval" : "daily")}
                    disabled={schedLoading}
                  >
                    <option value="daily">Jam harian</option>
                    <option value="interval">Interval (menit)</option>
                  </select>
                </div>

                <div className="flex flex-col">
                  <label className="text-xs text-muted-foreground">Interval (menit)</label>
                  <input
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={prIntervalMinutes}
                    onChange={(e) => setPrIntervalMinutes(e.target.value)}
                    placeholder="mis. 30"
                    disabled={schedLoading || prMode !== "interval"}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-xs text-muted-foreground">Jam (HH:MM)</label>
                  <input
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={prTime}
                    onChange={(e) => setPrTime(e.target.value)}
                    placeholder="08:15"
                    disabled={schedLoading || prMode !== "daily"}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={schedLoading}
              onClick={() => loadSchedulerSettings()}
            >
              {schedLoading ? "Memuat…" : "Refresh"}
            </button>
            <button
              className="px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
              disabled={schedLoading}
              onClick={() => saveSchedulerSettings()}
            >
              Simpan
            </button>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold">Automation Notifikasi</h1>
          <p className="text-sm text-muted-foreground">
            Halaman ini menampilkan log untuk notifikasi (record di database) serta push (hasil pengiriman push ke daftar subscription). Log push bersifat ringkas: 1 baris per broadcast (bukan per-device).
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <div className="font-semibold">Log Notifikasi (app_notifications)</div>
              <div className="text-xs text-muted-foreground">Satu baris = satu record notifikasi (dedupe by unique_key)</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="px-3 py-2 rounded border border-border bg-background text-sm"
                value={notifType}
                onChange={(e) => setNotifType(e.target.value)}
              >
                <option value="">(semua type)</option>
                <option value="data">data</option>
                <option value="pressrelease">pressrelease</option>
                <option value="publication">publication</option>
                <option value="info">info</option>
              </select>
              <button
                className="px-3 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 text-sm"
                onClick={() => loadNotifications(0)}
                disabled={notifLoading}
              >
                Refresh
              </button>
            </div>
          </div>

          {notifLoading ? <LoadingSpinner label="Memuat notifikasi…" /> : null}
          {notifError ? <Alert variant="error">{notifError}</Alert> : null}

          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="px-4 py-2 text-left">Waktu</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Title</th>
                  <th className="px-4 py-2 text-left">Unique Key</th>
                  <th className="px-4 py-2 text-left">Link</th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((n) => (
                  <tr key={n.id} className="border-t border-border">
                    <td className="px-4 py-2 whitespace-nowrap">{fmt(n.created_at)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{n.type}</td>
                    <td className="px-4 py-2 max-w-[360px] truncate" title={n.title}>{n.title}</td>
                    <td className="px-4 py-2 max-w-[360px] truncate" title={n.unique_key}>{n.unique_key}</td>
                    <td className="px-4 py-2 max-w-[240px] truncate" title={n.link || ""}>{n.link || "-"}</td>
                  </tr>
                ))}
                {!notifLoading && notifications.length === 0 ? (
                  <tr className="border-t border-border">
                    <td className="px-4 py-6 text-center text-muted-foreground" colSpan={5}>
                      Tidak ada data
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <button
              className="px-3 py-2 rounded border border-border bg-background hover:bg-muted text-sm disabled:opacity-50"
              onClick={() => loadNotifications(Math.max(0, notifOffset - notifLimit))}
              disabled={!canPrevNotif || notifLoading}
            >
              Prev
            </button>
            <div className="text-xs text-muted-foreground">offset={notifOffset} limit={notifLimit}</div>
            <button
              className="px-3 py-2 rounded border border-border bg-background hover:bg-muted text-sm disabled:opacity-50"
              onClick={() => loadNotifications(notifOffset + notifLimit)}
              disabled={notifLoading}
            >
              Next
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <div className="font-semibold">Log Push (push_send_logs)</div>
              <div className="text-xs text-muted-foreground">Satu baris = satu broadcast push (ringkas: sent/failed/skipped)</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="px-3 py-2 rounded border border-border bg-background text-sm"
                value={pushTrigger}
                onChange={(e) => setPushTrigger(e.target.value)}
              >
                <option value="">(semua trigger)</option>
                <option value="notification:create">notification:create</option>
                <option value="notification:rebroadcast">notification:rebroadcast</option>
              </select>
              <button
                className="px-3 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 text-sm"
                onClick={() => loadPushLogs(0)}
                disabled={pushLoading}
              >
                Refresh
              </button>
            </div>
          </div>

          {pushLoading ? <LoadingSpinner label="Memuat log push…" /> : null}
          {pushError ? <Alert variant="error">{pushError}</Alert> : null}

          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="px-4 py-2 text-left">Waktu</th>
                  <th className="px-4 py-2 text-left">Trigger</th>
                  <th className="px-4 py-2 text-left">Notif ID</th>
                  <th className="px-4 py-2 text-left">Sent</th>
                  <th className="px-4 py-2 text-left">Failed</th>
                  <th className="px-4 py-2 text-left">Skipped</th>
                  <th className="px-4 py-2 text-left">Unique Key</th>
                </tr>
              </thead>
              <tbody>
                {pushLogs.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-4 py-2 whitespace-nowrap">{fmt(p.created_at)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{p.trigger}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{p.notification_id ?? "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{p.sent}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{p.failed}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{p.skipped ? "Ya" : "Tidak"}</td>
                    <td className="px-4 py-2 max-w-[360px] truncate" title={p.notification_unique_key || ""}>{p.notification_unique_key || "-"}</td>
                  </tr>
                ))}
                {!pushLoading && pushLogs.length === 0 ? (
                  <tr className="border-t border-border">
                    <td className="px-4 py-6 text-center text-muted-foreground" colSpan={7}>
                      Tidak ada data
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <button
              className="px-3 py-2 rounded border border-border bg-background hover:bg-muted text-sm disabled:opacity-50"
              onClick={() => loadPushLogs(Math.max(0, pushOffset - pushLimit))}
              disabled={!canPrevPush || pushLoading}
            >
              Prev
            </button>
            <div className="text-xs text-muted-foreground">offset={pushOffset} limit={pushLimit}</div>
            <button
              className="px-3 py-2 rounded border border-border bg-background hover:bg-muted text-sm disabled:opacity-50"
              onClick={() => loadPushLogs(pushOffset + pushLimit)}
              disabled={pushLoading}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
