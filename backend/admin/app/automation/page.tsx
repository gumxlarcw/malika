"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import { api } from "@/lib/axios";
import Alert from "@/components/Alert";
import { getErrorMessage } from "@/lib/errors";
import { fmt, maxDate, clampPercent } from "@/lib/formatters";

type AutomationItem = {
  source: { id: number; name: string | null };
  datasource: { type: "dynamic" | "static" | "interop" | "exim" | string };
  production: {
    tableName: string | null;
    exists: boolean;
    rows: number;
    last_update: string | null;
    last_pulled_at: string | null;
    error?: string | null;
  };
  automation: {
    enabled: boolean;
    mode: "daily" | "smart";
    last_run_at: string | null;
    last_success_at: string | null;
    last_pull_started_at: string | null;
    last_pull_finished_at: string | null;
    last_bps_last_update: string | null;
    last_signature: string | null;
    last_error: string | null;
  };
  exim_pod_filter?:
    | {
        enabled: boolean;
        pods_count: number;
        updated_at: string | null;
      }
    | null;
};

type AutomationStatusResponse = {
  scheduler_enabled: boolean;
  scheduler_mode?: "daily" | "interval" | null;
  scheduler_next_run_at?: string | null;
  poll_minutes: number;
  min_interval_hours: number;
  data_bps?: {
    available?: boolean;
    connected?: boolean;
    dbName?: string | null;
    error?: string | null;
  };
  items: AutomationItem[];
};

type AutomationStatusJob = {
  jobId: string;
  status: "running" | "done" | "failed";
  started_at: string | null;
  finished_at: string | null;
  progress?: {
    total?: number;
    loaded?: number;
    percent?: number;
    message?: string;
  };
  data?: AutomationStatusResponse;
  error?: string | null;
};

type AutomationStatusJobStartResponse = {
  ok: boolean;
  alreadyRunning?: boolean;
  job?: AutomationStatusJob;
  message?: string;
};

type AutomationStatusJobStatusResponse = {
  ok: boolean;
  job?: AutomationStatusJob;
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
  };
  active?: {
    automation?: {
      enabled_env?: boolean;
      effective?: any;
      state?: any;
    } | null;
  };
  message?: string;
};

type AutomationLastLogResponse = {
  ok?: boolean;
  mode?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  logs?: string[];
  message?: string;
};

type EximPodFilterGetResponse = {
  ok: boolean;
  source_id?: number;
  enabled?: boolean;
  pods?: string[];
  updated_at?: string | null;
  message?: string;
};

type EximPodFilterSaveResponse = {
  ok: boolean;
  source_id?: number;
  enabled?: boolean;
  pods?: string[];
  updated_at?: string | null;
  message?: string;
};

type EximPodOptionsResponse = {
  ok: boolean;
  source_id?: number;
  table?: string;
  pods?: string[];
  message?: string;
};

type AutomationRunJob = {
  jobId: string;
  source_id: number;
  mode: string;
  status: "running" | "done" | "failed";
  started_at: string | null;
  finished_at: string | null;
  progress?: {
    percent?: number;
    message?: string;
  };
  error?: string | null;
  logs?: string[];
};

type AutomationRunJobStartResponse = {
  ok: boolean;
  alreadyRunning?: boolean;
  job?: AutomationRunJob;
  message?: string;
};

type AutomationRunJobStatusResponse = {
  ok: boolean;
  job?: AutomationRunJob;
  message?: string;
};

function InlineSpinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
      </svg>
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export default function AutomationPage() {
  const [data, setData] = useState<AutomationStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total: number | null }>({ loaded: 0, total: null });
  const [savingId, setSavingId] = useState<number | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const PAGE_SIZE = 20;
  const [page, setPage] = useState<number>(1);

  const autoConfiguredRef = useRef<Set<number>>(new Set());
  const autoConfigInFlightRef = useRef(false);

  const [batchRun, setBatchRun] = useState<{
    active: boolean;
    total: number;
    done: number;
    failed: number;
  }>({ active: false, total: 0, done: 0, failed: 0 });

  const [batchScope, setBatchScope] = useState<"enabled" | "all" | "ids">("enabled");
  const [batchIds, setBatchIds] = useState<string>("");

  const [runJobs, setRunJobs] = useState<Record<number, AutomationRunJob>>({});

  const [logOpen, setLogOpen] = useState(false);
  const [logTitle, setLogTitle] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logOk, setLogOk] = useState<boolean | null>(null);
  const [logError, setLogError] = useState<string>("");

  const [podPanelOpen, setPodPanelOpen] = useState<Record<number, boolean>>({});
  const [podOptions, setPodOptions] = useState<Record<number, { loading: boolean; pods: string[]; error: string }>>({});
  const [podSelection, setPodSelection] = useState<Record<number, { loading: boolean; pods: string[]; saving: boolean; error: string }>>({});
  const [podSearch, setPodSearch] = useState<Record<number, string>>({});
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedError, setSchedError] = useState<string>("");
  const [schedSuccess, setSchedSuccess] = useState<string>("");
  const [schedMode, setSchedMode] = useState<"daily" | "interval">("daily");
  const [schedIntervalMinutes, setSchedIntervalMinutes] = useState<string>("");
  const [schedTime, setSchedTime] = useState<string>("08:00");
  const [schedActive, setSchedActive] = useState<any>(null);

  const refreshSeqRef = useRef(0);

  async function refresh() {
    const mySeq = ++refreshSeqRef.current;
    setLoading(true);
    setLoadingProgress({ loaded: 0, total: null });
    setError("");
    setSuccess("");
    try {
      const startRes = await api.post<AutomationStatusJobStartResponse>("/automation/status-job", {});
      const startPayload = startRes.data;
      const job = startPayload.job;
      if (!job?.jobId) throw new Error(startPayload.message || "Gagal memulai job status automasi");

      const poll = async () => {
        const statusRes = await api.get<AutomationStatusJobStatusResponse>(`/automation/status-job/${job.jobId}`);
        const statusPayload = statusRes.data;
        const j = statusPayload.job;
        if (!j) return null;

        const loaded = Number(j.progress?.loaded || 0);
        const total = Number.isFinite(Number(j.progress?.total)) ? Number(j.progress?.total) : null;
        setLoadingProgress({ loaded, total });
        if (j.data) setData(j.data);

        return j;
      };

      for (;;) {
        if (mySeq !== refreshSeqRef.current) return;
        const j = await poll();
        if (!j) break;
        if (j.status === "done") {
          setLoading(false);
          break;
        }
        if (j.status === "failed") {
          setLoading(false);
          setError(j.error || "Job status automasi gagal");
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat status automasi"));
      setLoading(false);
    } finally {
      // loading is set to false when progressive rendering is done
    }
  }

  useEffect(() => {
    refresh();
    loadSchedulerSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function shouldAutoDefaultSmartOn(it: AutomationItem) {
    const t = String(it.datasource?.type || "");
    if (t !== "dynamic" && t !== "interop") return false;

    const a = it.automation;
    // Heuristic for "baru masuk": belum pernah dijalankan & belum pernah ada hasil.
    const neverRan =
      !a.last_run_at &&
      !a.last_success_at &&
      !a.last_pull_started_at &&
      !a.last_pull_finished_at &&
      !a.last_bps_last_update &&
      !a.last_signature &&
      !a.last_error;

    return Boolean(neverRan && !a.enabled);
  }

  useEffect(() => {
    if (!data || loading) return;
    if (autoConfigInFlightRef.current) return;

    const candidates = (data.items || []).filter((it) => {
      const id = it.source.id;
      if (autoConfiguredRef.current.has(id)) return false;
      return shouldAutoDefaultSmartOn(it);
    });

    if (!candidates.length) return;

    autoConfigInFlightRef.current = true;
    for (const it of candidates) autoConfiguredRef.current.add(it.source.id);

    (async () => {
      let anyOk = false;
      try {
        for (const it of candidates) {
          try {
            await api.post(`/automation/${it.source.id}` as any, {
              enabled: true,
              mode: "smart",
            });
            anyOk = true;
          } catch {
            // Best-effort: if one fails, continue without blocking others.
          }
        }
      } finally {
        autoConfigInFlightRef.current = false;
        if (anyOk) {
          setSuccess(`Default otomatis: Smart + ON untuk ${candidates.length} indikator (dynamic/interop) yang baru.`);
          await refresh();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading]);

  async function loadSchedulerSettings() {
    setSchedLoading(true);
    setSchedError("");
    setSchedSuccess("");
    try {
      const { data } = await api.get<SchedulerSettingsGetResponse>("/automation/scheduler-settings");
      if (!data?.ok) throw new Error(data?.message || "Gagal memuat setting scheduler");

      setSchedActive(data?.active?.automation || null);

      const cfg = data?.settings?.automation;
      if (cfg) {
        const mode = cfg.mode === "interval" ? "interval" : "daily";
        setSchedMode(mode);
        setSchedIntervalMinutes(cfg.interval_minutes != null ? String(cfg.interval_minutes) : "");
        const hh = String(cfg.run_hour ?? 8).padStart(2, "0");
        const mm = String(cfg.run_minute ?? 0).padStart(2, "0");
        setSchedTime(`${hh}:${mm}`);
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
      const intervalNum = schedIntervalMinutes.trim() ? Number(schedIntervalMinutes) : null;

      await api.post("/automation/scheduler-settings", {
        automation: {
          mode: schedMode,
          interval_minutes: Number.isFinite(intervalNum as number) ? intervalNum : null,
          time: schedTime,
        },
      });

      await api.post("/automation/scheduler-settings/restart?target=automation", {});
      setSchedSuccess("Setting scheduler disimpan & scheduler direstart.");

      // Reload so UI reflects persisted DB + active runtime state.
      await loadSchedulerSettings();
    } catch (e: unknown) {
      setSchedError(getErrorMessage(e, "Gagal menyimpan setting scheduler"));
    } finally {
      setSchedLoading(false);
    }
  }

  async function runNow(it: AutomationItem) {
    setRunningId(it.source.id);
    setError("");
    setSuccess("");

    setLogOpen(true);
    setLogTitle(`Run automasi: ${it.source.name || `#${it.source.id}`}`);
    setLogLines([]);
    setLogOk(null);
    setLogError("");

    try {
      const startRes = await api.post<AutomationRunJobStartResponse>(`/automation/${it.source.id}/run-job`, { mode: it.automation.mode });
      const startPayload = startRes.data;
      const job = startPayload.job;
      if (!job?.jobId) throw new Error(startPayload.message || "Gagal memulai job automasi");

      setRunJobs((prev) => ({ ...prev, [it.source.id]: job }));

      const poll = async () => {
        const statusRes = await api.get<AutomationRunJobStatusResponse>(`/automation/run/job/${job.jobId}`);
        const statusPayload = statusRes.data;
        const j = statusPayload.job;
        if (j) setRunJobs((prev) => ({ ...prev, [it.source.id]: j }));
        return j;
      };

      // Poll until finished.
      for (;;) {
        const j = await poll();
        setLogOk(j?.status === "running" ? null : j?.status === "done");
        setLogError(typeof j?.error === "string" ? j.error : "");
        setLogLines(Array.isArray(j?.logs) ? j.logs : []);

        if (!j || j.status === "done" || j.status === "failed") break;
        await new Promise((r) => setTimeout(r, 1500));
      }

      await refresh();
    } catch (e: unknown) {
      const maybeData = (e as any)?.response?.data;
      const msg = getErrorMessage(e, "Gagal menjalankan automasi sekarang");
      setLogOk(false);
      setLogError(typeof maybeData?.message === "string" ? maybeData.message : msg);
      setLogLines([]);
    } finally {
      setRunningId(null);
    }
  }

  function parseIdList(input: string): { ids: number[]; error: string } {
    const raw = String(input || "");
    const maxExpand = 500;

    const out: number[] = [];
    const seen = new Set<number>();

    const push = (id: number) => {
      if (!Number.isFinite(id) || id <= 0) return;
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };

    // 1) Expand explicit ranges: 176-202, 176 - 202, 176–202
    let used = raw;
    const rangeRe = /(\d+)\s*[-–—]\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = rangeRe.exec(raw)) !== null) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      const span = to - from + 1;
      if (span > maxExpand) {
        return { ids: [], error: `Rentang terlalu besar (${from}-${to} = ${span} id). Maksimal ${maxExpand} id per rentang.` };
      }
      for (let id = from; id <= to; id++) push(id);
      // Remove the matched range so singles parsing won't double-count.
      used = used.replace(m[0], " ");
      if (out.length > maxExpand * 5) {
        return { ids: [], error: `Terlalu banyak id yang dipilih. Kurangi input (maks ~${maxExpand * 5} id).` };
      }
    }

    // 2) Parse remaining single ids.
    const singleParts = used
      .split(/[^0-9]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of singleParts) push(Number(s));

    return { ids: out, error: "" };
  }

  async function runAllNow(scope: "enabled" | "all" | "ids") {
    const allItems = data?.items || [];
    let items: AutomationItem[] = [];
    let titleSuffix = scope === "all" ? "semua" : scope === "enabled" ? "hanya ON" : "pilih No Indikator";
    let missingIds: number[] = [];

    if (scope === "all") {
      items = allItems;
    } else if (scope === "enabled") {
      items = allItems.filter((it) => it.automation.enabled);
    } else {
      const parsed = parseIdList(batchIds);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }
      const wanted = parsed.ids;
      if (!wanted.length) {
        setError("Masukkan No Indikator yang ingin dijalankan (contoh: 12, 15, 200 atau 176-202)");
        return;
      }

      const wantSet = new Set(wanted);
      items = allItems.filter((it) => wantSet.has(it.source.id));
      const foundSet = new Set(items.map((it) => it.source.id));
      missingIds = wanted.filter((id) => !foundSet.has(id));
      titleSuffix = `No Indikator: ${wanted.join(", ")}`;
    }

    if (!items.length) {
      if (scope === "ids") {
        setError("No Indikator tidak ditemukan di daftar automasi. Coba klik Refresh dulu.");
      } else {
        setError(scope === "all" ? "Tidak ada indikator untuk dijalankan." : "Tidak ada indikator yang ON untuk dijalankan.");
      }
      return;
    }

    setError("");
    setSuccess("");

    setBatchRun({ active: true, total: items.length, done: 0, failed: 0 });
    setLogOpen(true);
    setLogTitle(`Run automasi: ${titleSuffix} — ${items.length} indikator`);
    setLogLines([]);
    setLogOk(null);
    setLogError("");

    const pushLine = (line: string) => {
      setLogLines((prev) => {
        const next = [...prev, line];
        // Keep modal responsive.
        return next.length > 4000 ? next.slice(next.length - 4000) : next;
      });
    };

    let anyFailed = false;


    try {
      if (scope === "ids" && missingIds.length) {
        pushLine(`[WARN] Tidak ditemukan: ${missingIds.join(", ")}`);
      }
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const sid = it.source.id;

        setRunningId(sid);
        pushLine(`\n===== [${idx + 1}/${items.length}] #${sid} — ${it.source.name || "(tanpa nama)"} =====`);

        let startPayload: AutomationRunJobStartResponse | null = null;
        try {
          const startRes = await api.post<AutomationRunJobStartResponse>(`/automation/${sid}/run-job`, { mode: it.automation.mode });
          startPayload = startRes.data;
        } catch (e: unknown) {
          anyFailed = true;
          setBatchRun((prev) => ({ ...prev, failed: prev.failed + 1 }));
          pushLine(`[#${sid}] ERROR: ${getErrorMessage(e, "Gagal memulai job automasi")}`);
          setBatchRun((prev) => ({ ...prev, done: prev.done + 1 }));
          continue;
        }

        const job = startPayload?.job;
        if (!job?.jobId) {
          anyFailed = true;
          setBatchRun((prev) => ({ ...prev, failed: prev.failed + 1 }));
          pushLine(`[#${sid}] ERROR: ${startPayload?.message || "Gagal memulai job automasi"}`);
          setBatchRun((prev) => ({ ...prev, done: prev.done + 1 }));
          continue;
        }

        setRunJobs((prev) => ({ ...prev, [sid]: job }));

        let lastLogLen = 0;
        const poll = async () => {
          const statusRes = await api.get<AutomationRunJobStatusResponse>(`/automation/run/job/${job.jobId}`);
          const statusPayload = statusRes.data;
          const j = statusPayload.job;
          if (j) setRunJobs((prev) => ({ ...prev, [sid]: j }));
          return j;
        };

        for (;;) {
          const j = await poll();
          if (Array.isArray(j?.logs)) {
            const lines = j.logs;
            if (lines.length > lastLogLen) {
              const fresh = lines.slice(lastLogLen);
              for (const ln of fresh) pushLine(`[#${sid}] ${ln}`);
              lastLogLen = lines.length;
            }
          }

          if (!j || j.status === "done" || j.status === "failed") {
            if (j?.status === "failed") {
              anyFailed = true;
              setBatchRun((prev) => ({ ...prev, failed: prev.failed + 1 }));
              pushLine(`[#${sid}] FAILED: ${typeof j.error === "string" && j.error ? j.error : "Automation finished with errors"}`);
            } else {
              pushLine(`[#${sid}] OK`);
            }
            break;
          }

          await new Promise((r) => setTimeout(r, 1500));
        }

        setBatchRun((prev) => ({ ...prev, done: prev.done + 1 }));
      }

      setLogOk(!anyFailed);
      setLogError(anyFailed ? "Sebagian indikator gagal. Lihat log untuk detail." : "");
      await refresh();
    } finally {
      setRunningId(null);
      setBatchRun((prev) => ({ ...prev, active: false }));
    }
  }

  const runningJobPercent = useMemo(() => {
    if (runningId == null) return null;
    const j = runJobs[runningId];
    if (!j) return null;
    return clampPercent(j.progress?.percent);
  }, [runJobs, runningId]);

  const batchOverallPercent = useMemo(() => {
    if (!batchRun.active || batchRun.total <= 0) return null;
    const completed = Math.max(0, Math.min(batchRun.total, batchRun.done));
    const current = runningJobPercent == null ? 0 : clampPercent(runningJobPercent);
    const pct = (completed / batchRun.total) * 100 + current / batchRun.total;
    return clampPercent(pct);
  }, [batchRun.active, batchRun.total, batchRun.done, runningJobPercent]);

  async function viewLastLog(it: AutomationItem) {
    setError("");
    setSuccess("");

    setLogOpen(true);
    setLogTitle(`Log terakhir: ${it.source.name || `#${it.source.id}`}`);
    setLogLines([]);
    setLogOk(null);
    setLogError("");

    try {
      const res = await api.get<AutomationLastLogResponse>(`/automation/${it.source.id}/log`);
      const payload = res.data;
      setLogOk(typeof payload.ok === "boolean" ? payload.ok : null);
      setLogError(typeof payload.error === "string" ? payload.error : "");
      setLogLines(Array.isArray(payload.logs) ? payload.logs : []);
    } catch (e: unknown) {
      const maybeData = (e as any)?.response?.data as AutomationLastLogResponse | undefined;
      const status = (e as any)?.response?.status;
      const msg =
        (typeof maybeData?.message === "string" && maybeData.message) ||
        getErrorMessage(e, "Gagal memuat log terakhir");
      // If there is simply no log yet, show a neutral status.
      setLogOk(status === 404 ? null : false);
      setLogError(msg);
      setLogLines([]);
    }
  }

  function isEximMasterTarget(it: AutomationItem) {
    // Per request: only for EXIM master Ekspor/Impor indicators.
    return String(it.datasource?.type || "") === "exim" && (it.source.id === 159 || it.source.id === 160);
  }

  async function loadPodFilter(sourceId: number) {
    setPodSelection((prev) => ({
      ...prev,
      [sourceId]: {
        loading: true,
        pods: prev[sourceId]?.pods || [],
        saving: false,
        error: "",
      },
    }));

    try {
      const res = await api.get<EximPodFilterGetResponse>(`/automation/${sourceId}/pod-filter`);
      const payload = res.data;
      const pods = Array.isArray(payload.pods) ? payload.pods : [];
      setPodSelection((prev) => ({
        ...prev,
        [sourceId]: { loading: false, pods, saving: false, error: "" },
      }));
    } catch (e: unknown) {
      setPodSelection((prev) => ({
        ...prev,
        [sourceId]: { loading: false, pods: prev[sourceId]?.pods || [], saving: false, error: getErrorMessage(e, "Gagal memuat filter POD") },
      }));
    }
  }

  async function loadPodOptions(sourceId: number) {
    setPodOptions((prev) => ({
      ...prev,
      [sourceId]: { loading: true, pods: prev[sourceId]?.pods || [], error: "" },
    }));

    try {
      const res = await api.get<EximPodOptionsResponse>(`/automation/${sourceId}/pod-options`);
      const payload = res.data;
      const pods = Array.isArray(payload.pods) ? payload.pods : [];
      setPodOptions((prev) => ({
        ...prev,
        [sourceId]: { loading: false, pods, error: "" },
      }));
    } catch (e: unknown) {
      setPodOptions((prev) => ({
        ...prev,
        [sourceId]: { loading: false, pods: prev[sourceId]?.pods || [], error: getErrorMessage(e, "Gagal mengambil daftar POD") },
      }));
    }
  }

  async function savePodFilter(sourceId: number) {
    const selected = podSelection[sourceId]?.pods || [];
    setPodSelection((prev) => ({
      ...prev,
      [sourceId]: { loading: false, pods: selected, saving: true, error: "" },
    }));
    setError("");
    setSuccess("");

    try {
      const res = await api.post<EximPodFilterSaveResponse>(`/automation/${sourceId}/pod-filter`, { pods: selected });
      const payload = res.data;
      if (!payload.ok) throw new Error(payload.message || "Gagal menyimpan filter POD");
      setSuccess(`Filter POD disimpan untuk #${sourceId} (${selected.length} POD)`);
      await refresh();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal menyimpan filter POD"));
    } finally {
      setPodSelection((prev) => ({
        ...prev,
        [sourceId]: { loading: false, pods: selected, saving: false, error: prev[sourceId]?.error || "" },
      }));
    }
  }

  const pagedItems = useMemo(() => {
    const items = data?.items || [];
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(totalPages, page));
    const start = (safePage - 1) * PAGE_SIZE;
    return {
      items: items.slice(start, start + PAGE_SIZE),
      total: items.length,
      totalPages,
      page: safePage,
    };
  }, [data?.items, page]);

  useEffect(() => {
    // Clamp page when data count changes.
    if (!data) return;
    const total = data.items?.length || 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    setPage((p) => Math.max(1, Math.min(totalPages, p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.items?.length]);

  return (
    <RequireAuth>
      <div className="space-y-4">

                  <div className="rounded-xl border border-border bg-card text-card-foreground p-3 text-sm space-y-2">
                    <div className="font-medium">Jadwal Scheduler Automation (Metabase)</div>
                    <div className="text-muted-foreground leading-relaxed">
                      Pengaturan ini menentukan kapan <b>automation scheduler</b> berjalan (interval menit atau jam harian). Ini hanya berlaku jika <b>AUTOMATION_ENABLED=true</b> di backend.
                    </div>

                    {schedError ? <Alert variant="error">{schedError}</Alert> : null}
                    {schedSuccess ? <Alert variant="success">{schedSuccess}</Alert> : null}

                    <div className="text-xs text-muted-foreground">
                      Aktif sekarang: {schedActive?.enabled_env === false ? "DISABLED (env)" : schedActive?.state?.enabled === false ? "DISABLED" : "ENABLED"}
                      {schedActive?.effective ? ` | effective=${schedActive.effective.mode}${schedActive.effective.intervalMinutes ? `(${schedActive.effective.intervalMinutes}m)` : schedActive.effective.runHour != null ? `@${String(schedActive.effective.runHour).padStart(2, "0")}:${String(schedActive.effective.runMinute || 0).padStart(2, "0")}` : ""} source=${schedActive.effective.source || "?"}` : ""}
                      {schedActive?.state?.nextRunAt ? ` | next=${new Date(schedActive.state.nextRunAt).toLocaleString()}` : ""}
                    </div>

                    <div className="flex flex-col md:flex-row md:items-end gap-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-muted-foreground">Mode</label>
                        <select
                          className="border rounded px-2 py-1 text-sm bg-background"
                          value={schedMode}
                          onChange={(e) => setSchedMode(e.target.value === "interval" ? "interval" : "daily")}
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
                          value={schedIntervalMinutes}
                          onChange={(e) => setSchedIntervalMinutes(e.target.value)}
                          placeholder="mis. 30"
                          disabled={schedLoading || schedMode !== "interval"}
                        />
                      </div>

                      <div className="flex flex-col">
                        <label className="text-xs text-muted-foreground">Jam (HH:MM)</label>
                        <input
                          className="border rounded px-2 py-1 text-sm bg-background"
                          value={schedTime}
                          onChange={(e) => setSchedTime(e.target.value)}
                          placeholder="08:00"
                          disabled={schedLoading || schedMode !== "daily"}
                        />
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
                  </div>
        <h1 className="text-2xl font-bold">Automasi Update (Metabase)</h1>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <select
                className="border rounded px-2 py-1 text-sm bg-background"
                value={batchScope}
                disabled={batchRun.active || loading || runningId !== null || savingId !== null}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "all") setBatchScope("all");
                  else if (v === "ids") setBatchScope("ids");
                  else setBatchScope("enabled");
                }}
              >
                <option value="enabled">Hanya yang ON</option>
                <option value="all">Semua</option>
                <option value="ids">Pilih No Indikator…</option>
              </select>

              {batchScope === "ids" ? (
                <input
                  className="border rounded px-2 py-1 text-sm bg-background w-[260px]"
                  value={batchIds}
                  onChange={(e) => setBatchIds(e.target.value)}
                  placeholder="No indikator (mis. 12, 15, 200)"
                  disabled={batchRun.active || loading || runningId !== null || savingId !== null}
                />
              ) : null}

              <button
                className="px-3 py-1 rounded border disabled:opacity-50"
                disabled={batchRun.active || loading || runningId !== null || savingId !== null}
                onClick={() => runAllNow(batchScope)}
              >
                Run sekarang
              </button>
            </div>

            {batchRun.active ? (
              <div className="text-xs text-muted-foreground">
                Batch progress: <b>{batchRun.done}/{batchRun.total}</b>
                {batchOverallPercent != null ? <span> ({Math.round(batchOverallPercent)}%)</span> : null}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <button
                  className="px-2 py-1 rounded border disabled:opacity-50"
                  disabled={loading || page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span>
                  Page <b>{pagedItems.page}</b> / {pagedItems.totalPages} — total {pagedItems.total}
                </span>
                <button
                  className="px-2 py-1 rounded border disabled:opacity-50"
                  disabled={loading || pagedItems.page >= pagedItems.totalPages}
                  onClick={() => setPage((p) => Math.min(pagedItems.totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </div>
          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
            <table className="min-w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3">Indikator</th>
                  <th className="text-left p-3">Jenis Data</th>
                  <th className="text-left p-3">Tabel Produksi</th>
                  <th className="text-left p-3">Last Update (BPS)</th>
                  <th className="text-left p-3">Terakhir Ditarik</th>
                  <th className="text-left p-3">Mode</th>
                  <th className="text-left p-3">Toggle</th>
                  <th className="text-left p-3">Run</th>
                  <th className="text-left p-3">Status</th>
                </tr>
                {loading ? (
                  <tr>
                    <th className="p-2" colSpan={9}>
                      <div className="flex items-center justify-center">
                        <InlineSpinner
                          label={(() => {
                            const total = loadingProgress.total;
                            const loaded = loadingProgress.loaded;
                            if (!Number.isFinite(total as number) || total == null) return "Memuat…";
                            if (total <= 0) return "Memuat indikator…";
                            const pct = Math.round((loaded / total) * 100);
                            return `Memuat indikator ${loaded}/${total} (${pct}%)`;
                          })()}
                        />
                      </div>
                    </th>
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {pagedItems.items.map((it) => (
                  <tr key={it.source.id} className="border-t border-border">
                    <td className="p-3">
                      <div className="font-medium">{it.source.name || `#${it.source.id}`}</div>
                      <div className="text-xs text-muted-foreground">ID: {it.source.id}</div>

                      {(() => {
                        const j = runJobs[it.source.id];
                        if (!j) return null;
                        const percent = clampPercent(j.progress?.percent);
                        return (
                          <div className="mt-2 flex flex-col items-center justify-center text-center">
                            {j.status === "running" ? <InlineSpinner label={`${Math.round(percent)}%`} /> : null}
                            <div className="text-xs text-muted-foreground mt-1">{Math.round(percent)}%</div>
                          </div>
                        );
                      })()}
                    </td>

                    <td className="p-3">
                      <div className="font-medium">{String(it.datasource?.type || "-")}</div>
                    </td>

                    <td className="p-3">
                      <div>
                        <b>data_bps.{it.production.tableName || "-"}</b>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {it.production.error
                          ? `ERROR: ${it.production.error}`
                          : it.production.exists
                            ? `OK (${it.production.rows} baris)`
                            : String(it.datasource?.type || "") === "pressrelease"
                              ? "Belum ada (tarik pressrelease dulu)"
                              : "Belum ada (run manual dulu)"}
                      </div>
                    </td>
                    <td className="p-3">{fmt(it.production.last_update || it.automation.last_bps_last_update)}</td>
                    <td className="p-3">{fmt(maxDate(it.production.last_pulled_at, it.automation.last_pull_finished_at))}</td>
                    <td className="p-3">
                      <select
                        className="border rounded px-2 py-1"
                        value={it.automation.mode}
                        disabled={savingId === it.source.id}
                        onChange={async (e) => {
                          setSavingId(it.source.id);
                          setError("");
                          setSuccess("");
                          try {
                            await api.post(`/automation/${it.source.id}`, {
                              enabled: it.automation.enabled,
                              mode: e.target.value,
                            });
                            setSuccess(`Mode disimpan untuk #${it.source.id}`);
                            await refresh();
                          } catch (err: unknown) {
                            setError(getErrorMessage(err, "Gagal menyimpan mode"));
                          } finally {
                            setSavingId(null);
                          }
                        }}
                      >
                        <option value="daily">1x sehari (full)</option>
                        <option value="smart">Smart (cek update dulu)</option>
                      </select>
                      <div className="mt-2 text-[11px] text-muted-foreground leading-snug">
                        {it.automation.mode === "daily" ? (
                          <span>Selalu tarik semua tahun yang tersedia (full refresh).</span>
                        ) : (
                          <span>
                            Untuk <b>dynamic</b>: cek dulu update terbaru BPS; jika belum berubah maka skip. Untuk <b>exim</b>: cek tahun berurutan sampai ketemu tahun kosong, lalu update hanya tahun terakhir yang ada data.
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <button
                        className={`px-3 py-1 rounded text-white ${it.automation.enabled ? "bg-green-600" : "bg-gray-600"} disabled:opacity-50`}
                        disabled={savingId === it.source.id}
                        onClick={async () => {
                          setSavingId(it.source.id);
                          setError("");
                          setSuccess("");
                          try {
                            await api.post(`/automation/${it.source.id}`, {
                              enabled: !it.automation.enabled,
                              mode: it.automation.mode,
                            });
                            setSuccess(`Automasi ${!it.automation.enabled ? "diaktifkan" : "dimatikan"} untuk #${it.source.id}`);
                            await refresh();
                          } catch (err: unknown) {
                            setError(getErrorMessage(err, "Gagal mengubah toggle"));
                          } finally {
                            setSavingId(null);
                          }
                        }}
                      >
                        {it.automation.enabled ? "ON" : "OFF"}
                      </button>
                    </td>
                    <td className="p-3">
                      <button
                        className="px-3 py-1 rounded border disabled:opacity-50"
                        disabled={savingId === it.source.id || runningId !== null}
                        onClick={() => runNow(it)}
                      >
                        {(() => {
                          if (runningId !== it.source.id) return "Run sekarang";
                          const j = runJobs[it.source.id];
                          const p = j ? Math.round(clampPercent(j.progress?.percent)) : null;
                          return p == null ? "Running…" : `Running… ${p}%`;
                        })()}
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="text-xs text-muted-foreground">Last run: {fmt(it.automation.last_run_at)}</div>
                      {it.automation.last_error ? (
                        <>
                          <div className="text-xs font-semibold text-red-600">FAILED</div>
                          <div className="text-xs text-red-600">{it.automation.last_error}</div>
                        </>
                      ) : (
                        <div className="text-xs font-semibold text-green-700">OK</div>
                      )}

                      <button
                        className="mt-2 px-2 py-1 rounded border text-xs disabled:opacity-50"
                        disabled={runningId !== null}
                        onClick={() => viewLastLog(it)}
                      >
                        Log terakhir
                      </button>

                      {isEximMasterTarget(it) ? (
                        <div className="mt-3">
                          <div className="text-[11px] text-muted-foreground">
                            Filter POD: <b>{it.exim_pod_filter?.enabled ? `ON (${it.exim_pod_filter.pods_count})` : "OFF"}</b>
                          </div>
                          <button
                            className="mt-2 px-2 py-1 rounded border text-xs"
                            disabled={runningId !== null}
                            onClick={async () => {
                              const next = !podPanelOpen[it.source.id];
                              setPodPanelOpen((prev) => ({ ...prev, [it.source.id]: next }));
                              if (next) {
                                await loadPodFilter(it.source.id);
                              }
                            }}
                          >
                            {podPanelOpen[it.source.id] ? "Tutup filter POD" : "Atur filter POD"}
                          </button>

                          {podPanelOpen[it.source.id] ? (
                            <div className="mt-2 rounded border border-border bg-muted p-2">
                              <div className="flex items-center gap-2">
                                <button
                                  className="px-2 py-1 rounded border text-xs disabled:opacity-50"
                                  disabled={podOptions[it.source.id]?.loading || runningId !== null}
                                  onClick={() => loadPodOptions(it.source.id)}
                                >
                                  {podOptions[it.source.id]?.loading ? "Mengambil…" : "Ambil daftar POD"}
                                </button>
                                <button
                                  className="px-2 py-1 rounded border text-xs disabled:opacity-50"
                                  disabled={podSelection[it.source.id]?.saving || podSelection[it.source.id]?.loading || runningId !== null}
                                  onClick={() => savePodFilter(it.source.id)}
                                >
                                  {podSelection[it.source.id]?.saving ? "Menyimpan…" : "Simpan"}
                                </button>
                                <button
                                  className="px-2 py-1 rounded border text-xs disabled:opacity-50"
                                  disabled={podSelection[it.source.id]?.saving || runningId !== null}
                                  onClick={() =>
                                    setPodSelection((prev) => ({
                                      ...prev,
                                      [it.source.id]: { loading: false, pods: [], saving: false, error: "" },
                                    }))
                                  }
                                >
                                  Kosongkan
                                </button>
                              </div>

                              {podSelection[it.source.id]?.error ? <div className="mt-2 text-xs text-red-600">{podSelection[it.source.id].error}</div> : null}
                              {podOptions[it.source.id]?.error ? <div className="mt-2 text-xs text-red-600">{podOptions[it.source.id].error}</div> : null}

                              <div className="mt-2 text-[11px] text-muted-foreground">
                                Terpilih: <b>{(podSelection[it.source.id]?.pods || []).length}</b> POD. Filter diterapkan saat replikasi ke <b>data_bps</b> pada run berikutnya.
                              </div>

                              <div className="mt-2">
                                <input
                                  className="w-full border rounded px-2 py-1 text-xs bg-background"
                                  placeholder="Cari POD…"
                                  value={podSearch[it.source.id] || ""}
                                  onChange={(e) => setPodSearch((prev) => ({ ...prev, [it.source.id]: e.target.value }))}
                                />
                                {(() => {
                                  const all = podOptions[it.source.id]?.pods || [];
                                  const q = (podSearch[it.source.id] || "").trim().toLowerCase();
                                  if (!q) return null;
                                  const matched = all.filter((p) => p.toLowerCase().includes(q)).length;
                                  return <div className="mt-1 text-[11px] text-muted-foreground">Hasil: <b>{matched}</b> dari {all.length}</div>;
                                })()}
                              </div>

                              <div className="mt-2 max-h-44 overflow-auto rounded border border-border bg-card p-2">
                                {podOptions[it.source.id]?.pods?.length ? (
                                  <div className="space-y-1">
                                    {podOptions[it.source.id].pods
                                      .filter((pod) => {
                                        const q = (podSearch[it.source.id] || "").trim().toLowerCase();
                                        if (!q) return true;
                                        return pod.toLowerCase().includes(q);
                                      })
                                      .map((pod) => {
                                      const checked = (podSelection[it.source.id]?.pods || []).includes(pod);
                                      return (
                                        <label key={pod} className="flex items-center gap-2 text-xs">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => {
                                              const next = new Set(podSelection[it.source.id]?.pods || []);
                                              if (e.target.checked) next.add(pod);
                                              else next.delete(pod);
                                              setPodSelection((prev) => ({
                                                ...prev,
                                                [it.source.id]: {
                                                  loading: false,
                                                  pods: Array.from(next),
                                                  saving: false,
                                                  error: "",
                                                },
                                              }));
                                            }}
                                          />
                                          <span>{pod}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="text-xs text-muted-foreground">Klik “Ambil daftar POD” untuk menampilkan opsi.</div>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {logOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-3xl rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div>
                  <div className="font-semibold">{logTitle}</div>
                  <div className="text-xs text-muted-foreground">
                    Status:{" "}
                    {logOk === null ? (
                      <b>Running…{runningJobPercent != null ? ` ${Math.round(runningJobPercent)}%` : ""}</b>
                    ) : logOk ? (
                      <b className="text-green-700">OK</b>
                    ) : (
                      <b className="text-red-600">FAILED</b>
                    )}
                    {logError ? <span className="text-red-600"> — {logError}</span> : null}
                  </div>
                </div>
                <button
                  className="px-3 py-1 rounded border disabled:opacity-50"
                  disabled={runningId !== null}
                  onClick={() => setLogOpen(false)}
                >
                  Tutup
                </button>
              </div>

              <div className="p-4">
                <div className="rounded border border-border bg-muted p-3 max-h-[60vh] overflow-auto">
                  <pre className="text-xs whitespace-pre-wrap">
                    {logLines.length ? logLines.join("\n") : logOk === null ? "Menjalankan…" : "(Tidak ada log)"}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Catatan: Untuk Metabase produksi, gunakan tabel <b>data_bps.indikator_&lt;source_id&gt;</b> (dibuat saat run pertama). Endpoint on-demand seperti <b>/cache/merge</b> hanya untuk preview/debug; untuk konsumsi stabil gunakan hasil tersimpan (<b>/cache/merged</b>) atau langsung tabel data_bps.
        </div>
      </div>
    </RequireAuth>
  );
}
