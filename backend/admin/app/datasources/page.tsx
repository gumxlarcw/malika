"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import { api } from "@/lib/axios";
import Alert from "@/components/Alert";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/components/AuthProvider";
import { getErrorMessage } from "@/lib/errors";
import { Pagination } from "@/components/ui";
import { usePagination } from "@/hooks";

import { DataSourceRow, EximSeedJob } from "./types";
import {
  DatasourceTable,
  AddEditModal,
  BulkImportModal,
  PressReleaseModal,
  ReindexMetaModal,
  EximJobLog,
} from "./components";

const CATEGORY_ALL = "__all__";
const CATEGORY_EMPTY = "__empty__";
const TYPE_ALL = "__all__";
const PAGE_SIZE = 20;

export default function DatasourcesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<DataSourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [seedingExim, setSeedingExim] = useState(false);
  const [reindexingTerms, setReindexingTerms] = useState(false);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>(CATEGORY_ALL);
  const [typeFilter, setTypeFilter] = useState<string>(TYPE_ALL);

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editItem, setEditItem] = useState<DataSourceRow | undefined>(undefined);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [prCreateOpen, setPrCreateOpen] = useState(false);
  const [reindexMetaOpen, setReindexMetaOpen] = useState(false);

  // EXIM job
  const [eximJob, setEximJob] = useState<EximSeedJob | null>(null);
  const [eximJobId, setEximJobId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.get<DataSourceRow[]>("/datasource/admin");
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat datasources"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const ds of items) {
      const c = String(ds.category || "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const types = useMemo(() => {
    const set = new Set<string>();
    for (const ds of items) {
      const t = String(ds.type || "").trim();
      if (t) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    let out = items;
    if (typeFilter !== TYPE_ALL) {
      out = out.filter((ds) => String(ds.type || "").trim() === typeFilter);
    }
    if (categoryFilter === CATEGORY_ALL) return out;
    if (categoryFilter === CATEGORY_EMPTY) {
      return out.filter((ds) => !String(ds.category || "").trim());
    }
    return out.filter((ds) => String(ds.category || "").trim() === categoryFilter);
  }, [items, categoryFilter, typeFilter]);

  const pagination = usePagination({ initialLimit: PAGE_SIZE });
  
  // Update pagination total when filtered items change
  useEffect(() => {
    pagination.setTotal(filteredItems.length);
    // Go to page 1 if current page is out of range
    if (filteredItems.length > 0 && pagination.page > Math.ceil(filteredItems.length / PAGE_SIZE)) {
      pagination.goTo(1);
    }
  }, [filteredItems.length]);

  const pagedItems = useMemo(() => {
    const start = (pagination.page - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, pagination.page]);

  function openAdd() {
    setModalMode("add");
    setEditItem(undefined);
    setModalOpen(true);
  }

  function openEdit(ds: DataSourceRow) {
    setModalMode("edit");
    setEditItem(ds);
    setModalOpen(true);
  }

  async function remove(ds: DataSourceRow) {
    if (!confirm(`Delete datasource #${ds.id}? (soft delete: visible=0)`)) return;
    setError("");
    setSuccess("");
    try {
      await api.delete(`/datasource/${ds.id}`);
      setSuccess("Datasource dihapus (hidden)");
      await refresh();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal menghapus datasource"));
    }
  }

  async function hardRemove(ds: DataSourceRow) {
    if (!confirm(`HARD DELETE datasource #${ds.id}? Ini akan menghapus permanen (termasuk cache) dan tidak bisa dibatalkan.`)) return;
    setError("");
    setSuccess("");
    try {
      await api.delete(`/datasource/${ds.id}/hard`);
      setSuccess(`Datasource #${ds.id} berhasil dihapus permanen`);
      await refresh();
    } catch (e: unknown) {
      setError(getErrorMessage(e, `Gagal hard delete datasource #${ds.id}`));
    }
  }

  async function seedExim() {
    if (!confirm("Seed EXIM mode MASTER (hanya 2 datasource: Ekspor + Impor)?")) return;
    setSeedingExim(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.post("/datasource/exim/seed/job", {
        startYear: 2020,
        endYear: new Date().getFullYear(),
        visible: true,
        mode: "master",
      });
      const job = (res.data?.job || null) as EximSeedJob | null;
      if (!job?.jobId) {
        setError("Gagal memulai job seed EXIM (jobId tidak ditemukan)");
        return;
      }
      setEximJob(job);
      setEximJobId(job.jobId);
      setSuccess("Job seed EXIM dimulai. Menampilkan log proses...");
    } catch (e: unknown) {
      const maybeAxios = e as { response?: { status?: number; data?: { code?: string; job?: EximSeedJob } } };
      if (maybeAxios?.response?.status === 409 && maybeAxios?.response?.data?.job?.jobId) {
        setEximJob(maybeAxios.response.data.job);
        setEximJobId(maybeAxios.response.data.job.jobId);
        setSuccess("Job seed EXIM sudah berjalan. Menampilkan log proses...");
      } else {
        setError(getErrorMessage(e, "Gagal seed EXIM"));
      }
    } finally {
      setSeedingExim(false);
    }
  }

  // Poll EXIM job status
  useEffect(() => {
    if (!eximJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api.get(`/datasource/exim/seed/job/${eximJobId}`);
        const job = (res.data?.job || null) as EximSeedJob | null;
        if (!job) return;
        setEximJob(job);
        if (job.status === "done") {
          setSuccess(`Seed EXIM selesai: created=${job.progress.created}, updated=${job.progress.updated}, errors=${job.progress.errors}`);
          await refresh();
          return;
        }
        if (job.status === "failed") {
          setError(job.error ? `Seed EXIM gagal: ${job.error}` : "Seed EXIM gagal");
          return;
        }
        timer = setTimeout(poll, 1200);
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Gagal mengambil status seed EXIM"));
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [eximJobId]);

  async function reindexSearchTerms() {
    if (!confirm("Reindex Search Terms untuk semua datasource yang visible?")) return;
    setError("");
    setSuccess("");
    setReindexingTerms(true);
    try {
      const res = await api.post("/datasource/search-terms/reindex", { onlyVisible: true });
      const results = Array.isArray(res.data?.results) ? res.data.results : [];
      const okCount = results.filter((r: { ok?: boolean }) => r?.ok).length;
      const failCount = results.filter((r: { ok?: boolean }) => r?.ok === false).length;
      const insertedTotal = results.reduce((acc: number, r: { inserted?: number }) => acc + (Number(r?.inserted) || 0), 0);
      setSuccess(`Reindex Search Terms selesai: ok=${okCount}, gagal=${failCount}, inserted=${insertedTotal}`);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal reindex Search Terms"));
    } finally {
      setReindexingTerms(false);
    }
  }

  const eximJobLogs: { ts: string; message: string; type: "ok" | "error" | "info" }[] = useMemo(() => {
    if (!eximJob?.logs?.length) return [];
    return eximJob.logs.map((log, idx) => ({
      ts: String(idx + 1).padStart(3, "0"),
      message: log,
      type: log.toLowerCase().includes("error") ? "error" : log.toLowerCase().includes("ok") || log.toLowerCase().includes("created") ? "ok" : "info",
    }));
  }, [eximJob]);

  return (
    <RequireAuth>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-2xl font-bold">Datasources</h1>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button className="px-3 py-2 rounded border border-border bg-emerald-600/20 text-emerald-700 dark:text-emerald-400" onClick={() => setBulkOpen(true)}>
              Import URL
            </button>
            <button className="px-3 py-2 rounded border border-border bg-secondary text-secondary-foreground disabled:opacity-50" onClick={seedExim} disabled={seedingExim}>
              {seedingExim ? "Seeding EXIM…" : "Seed EXIM"}
            </button>
            <button className="px-3 py-2 rounded border border-border bg-purple-600/20 text-purple-700 dark:text-purple-400" onClick={() => setPrCreateOpen(true)}>
              Press Release
            </button>
            {user?.role === "admin" && (
              <>
                <button className="px-3 py-2 rounded border border-border bg-secondary text-secondary-foreground disabled:opacity-50" onClick={reindexSearchTerms} disabled={reindexingTerms} title="Reindex kata kunci">
                  {reindexingTerms ? "Reindexing…" : "Reindex Terms"}
                </button>
                <button className="px-3 py-2 rounded border border-border bg-secondary text-secondary-foreground" onClick={() => setReindexMetaOpen(true)} title="Reindex metadata dari cache">
                  Reindex Metadata
                </button>
              </>
            )}
            <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={openAdd}>
              Tambah
            </button>
          </div>
        </div>

        {/* Alerts */}
        {loading && <LoadingSpinner label="Memuat…" />}
        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        {/* Filters */}
        <div className="rounded-xl border border-border bg-card text-card-foreground p-3">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Filter Kategori</label>
                <select
                  className="border rounded-lg px-3 py-2 w-full bg-background"
                  value={categoryFilter}
                  onChange={(e) => { setCategoryFilter(e.target.value); pagination.goTo(1); }}
                >
                  <option value={CATEGORY_ALL}>Semua kategori</option>
                  <option value={CATEGORY_EMPTY}>(Tanpa kategori)</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Filter Type</label>
                <select
                  className="border rounded-lg px-3 py-2 w-full bg-background"
                  value={typeFilter}
                  onChange={(e) => { setTypeFilter(e.target.value); pagination.goTo(1); }}
                >
                  <option value={TYPE_ALL}>Semua type</option>
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={pagination.goTo}
              itemsPerPage={PAGE_SIZE}
              totalItems={filteredItems.length}
            />
          </div>
        </div>

        {/* EXIM Job Log */}
        <EximJobLog jobs={eximJobLogs} />

        {/* Table */}
        <DatasourceTable
          items={pagedItems}
          loading={loading}
          onEdit={openEdit}
          onDelete={remove}
          onHardDelete={user?.role === "admin" ? hardRemove : undefined}
        />

        {/* Add/Edit Modal */}
        <AddEditModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          mode={modalMode}
          editItem={editItem}
          onSuccess={(msg) => { setSuccess(msg); refresh(); }}
          onError={setError}
        />

        {/* Bulk Import Modal */}
        <BulkImportModal
          isOpen={bulkOpen}
          onClose={() => setBulkOpen(false)}
          onSuccess={setSuccess}
          onError={setError}
          existingItems={items}
          onRefresh={refresh}
        />

        {/* Press Release Modal */}
        <PressReleaseModal
          isOpen={prCreateOpen}
          onClose={() => setPrCreateOpen(false)}
          onSuccess={setSuccess}
          onError={setError}
          onRefresh={refresh}
        />

        {/* Reindex Metadata Modal */}
        <ReindexMetaModal
          isOpen={reindexMetaOpen}
          onClose={() => setReindexMetaOpen(false)}
          onSuccess={setSuccess}
          onError={setError}
          existingItems={items}
        />
      </div>
    </RequireAuth>
  );
}
