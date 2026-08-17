"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import { ArrowDown, ArrowUp, Save } from "lucide-react";

type Candidate = {
  sourceId: number;
  name: string;
  category: string;
  shape: "province" | "regional" | "dimensional";
};

const MAX_HEADLINE = 12;

function DashboardCurationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [headline, setHeadline] = useState<number[]>([]);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get("/dashboard/admin/curation");
        setCandidates(data.candidates || []);
        setHeadline(data.headline || []);
        // Fall back to the live category list so the order editor is never empty.
        setCategoryOrder(
          (data.categoryOrder || []).length ? data.categoryOrder : data.categories || []
        );
      } catch (e) {
        setError(getErrorMessage(e, "Gagal memuat kurasi. Pastikan sudah login."));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Only province-shaped indicators carry a headline number worth leading with.
  const pickable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates
      .filter((c) => c.shape === "province")
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true));
  }, [candidates, search]);

  const byId = useMemo(() => new Map(candidates.map((c) => [c.sourceId, c])), [candidates]);

  function toggle(sourceId: number) {
    setHeadline((prev) =>
      prev.includes(sourceId)
        ? prev.filter((id) => id !== sourceId)
        : prev.length >= MAX_HEADLINE
          ? prev
          : [...prev, sourceId]
    );
  }

  function moveCategory(index: number, delta: number) {
    setCategoryOrder((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.put("/dashboard/admin/curation", { headline, categoryOrder });
      setSuccess("Kurasi dashboard tersimpan.");
    } catch (e) {
      setError(getErrorMessage(e, "Gagal menyimpan kurasi."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingSpinner label="Memuat kurasi dashboard…" />;

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold">Kurasi Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pilih indikator yang tampil di strip &ldquo;Angka utama&rdquo; dan atur urutan seksi
          kategori pada halaman /dashboard.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <section className="rounded-lg border border-gray-200 p-4">
        <h2 className="font-medium">
          Angka utama{" "}
          <span className="text-sm font-normal text-gray-500">
            ({headline.length}/{MAX_HEADLINE} dipilih)
          </span>
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Hanya indikator yang punya baris provinsi yang bisa dipilih — indikator lain tidak
          memiliki satu angka tingkat provinsi untuk ditampilkan.
        </p>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari indikator…"
          aria-label="Cari indikator"
          className="mt-3 h-9 w-full max-w-md rounded border border-gray-300 px-3 text-sm"
        />

        {headline.length > 0 ? (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
            {headline.map((id) => (
              <li key={id}>{byId.get(id)?.name ?? `#${id}`}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            Belum ada pilihan — dashboard memakai enam kartu provinsi pertama secara otomatis.
          </p>
        )}

        <div className="mt-3 max-h-80 overflow-y-auto rounded border border-gray-100">
          {pickable.map((c) => (
            <label
              key={c.sourceId}
              className="flex items-start gap-2 border-b border-gray-100 p-2 text-sm last:border-b-0"
            >
              <input
                type="checkbox"
                checked={headline.includes(c.sourceId)}
                onChange={() => toggle(c.sourceId)}
                className="mt-0.5"
              />
              <span>
                <span className="block">{c.name}</span>
                <span className="block text-xs text-gray-500">{c.category}</span>
              </span>
            </label>
          ))}
          {pickable.length === 0 ? (
            <p className="p-3 text-sm text-gray-500">Tidak ada indikator yang cocok.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 p-4">
        <h2 className="font-medium">Urutan kategori</h2>
        <p className="mt-1 text-sm text-gray-500">
          Kategori yang belum ada dalam daftar ini tetap tampil, di urutan paling bawah.
        </p>
        <ul className="mt-3 divide-y divide-gray-100 rounded border border-gray-100">
          {categoryOrder.map((name, i) => (
            <li key={name} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span>
                <span className="mr-2 text-gray-400">{i + 1}.</span>
                {name}
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  onClick={() => moveCategory(i, -1)}
                  disabled={i === 0}
                  aria-label={`Naikkan ${name}`}
                  className="rounded border border-gray-200 p-1 disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveCategory(i, 1)}
                  disabled={i === categoryOrder.length - 1}
                  aria-label={`Turunkan ${name}`}
                  className="rounded border border-gray-200 p-1 disabled:opacity-40"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        <Save className="h-4 w-4" />
        {saving ? "Menyimpan…" : "Simpan"}
      </button>
    </div>
  );
}

export default function Page() {
  return (
    <RequireAuth>
      <DashboardCurationPage />
    </RequireAuth>
  );
}
