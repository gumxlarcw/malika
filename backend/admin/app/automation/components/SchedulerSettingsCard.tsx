"use client";

import Alert from "@/components/Alert";

type SchedulerSettingsProps = {
  mode: "daily" | "interval";
  setMode: (mode: "daily" | "interval") => void;
  intervalMinutes: string;
  setIntervalMinutes: (val: string) => void;
  time: string;
  setTime: (val: string) => void;
  loading: boolean;
  error: string;
  success: string;
  active: {
    enabled_env?: boolean;
    effective?: { mode?: string; intervalMinutes?: number; runHour?: number; runMinute?: number; source?: string };
    state?: { enabled?: boolean; nextRunAt?: string };
  } | null;
  onRefresh: () => void;
  onSave: () => void;
};

export default function SchedulerSettingsCard({
  mode,
  setMode,
  intervalMinutes,
  setIntervalMinutes,
  time,
  setTime,
  loading,
  error,
  success,
  active,
  onRefresh,
  onSave,
}: SchedulerSettingsProps) {
  const effectiveInfo = active?.effective
    ? `${active.effective.mode}${
        active.effective.intervalMinutes
          ? `(${active.effective.intervalMinutes}m)`
          : active.effective.runHour != null
          ? `@${String(active.effective.runHour).padStart(2, "0")}:${String(active.effective.runMinute || 0).padStart(2, "0")}`
          : ""
      } source=${active.effective.source || "?"}`
    : "";

  const statusText =
    active?.enabled_env === false
      ? "DISABLED (env)"
      : active?.state?.enabled === false
      ? "DISABLED"
      : "ENABLED";

  const nextRunText = active?.state?.nextRunAt
    ? `next=${new Date(active.state.nextRunAt).toLocaleString()}`
    : "";

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground p-3 text-sm space-y-2">
      <div className="font-medium">Jadwal Scheduler Automation</div>
      <div className="text-muted-foreground leading-relaxed">
        Pengaturan ini menentukan kapan <b>automation scheduler</b> berjalan (interval menit atau jam harian). Ini hanya berlaku jika <b>AUTOMATION_ENABLED=true</b> di backend.
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <div className="text-xs text-muted-foreground">
        Aktif sekarang: {statusText}
        {effectiveInfo && ` | effective=${effectiveInfo}`}
        {nextRunText && ` | ${nextRunText}`}
      </div>

      <div className="flex flex-col md:flex-row md:items-end gap-2">
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground">Mode</label>
          <select
            className="border rounded px-2 py-1 text-sm bg-background"
            value={mode}
            onChange={(e) => setMode(e.target.value === "interval" ? "interval" : "daily")}
            disabled={loading}
          >
            <option value="daily">Jam harian</option>
            <option value="interval">Interval (menit)</option>
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground">Interval (menit)</label>
          <input
            className="border rounded px-2 py-1 text-sm bg-background"
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(e.target.value)}
            placeholder="mis. 30"
            disabled={loading || mode !== "interval"}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground">Jam (HH:MM)</label>
          <input
            className="border rounded px-2 py-1 text-sm bg-background"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="08:00"
            disabled={loading || mode !== "daily"}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded border disabled:opacity-50"
            disabled={loading}
            onClick={onRefresh}
          >
            {loading ? "Memuat…" : "Refresh"}
          </button>
          <button
            className="px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
            disabled={loading}
            onClick={onSave}
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
