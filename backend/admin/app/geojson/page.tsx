"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo, useRef, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import Alert from "@/components/Alert";
import { api } from "@/lib/axios";
import type { AxiosProgressEvent, AxiosRequestConfig } from "axios";
import type { GeoJsonObject } from "geojson";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON } from "leaflet";
import { getErrorMessage } from "@/lib/errors";
import { fmt, formatBytes } from "@/lib/formatters";

type UploadResponse = {
  ok: boolean;
  filename?: string;
  url?: string;
  size_bytes?: number | null;
  message?: string;
};

type ListResponse = {
  ok: boolean;
  items?: Array<{
    filename: string;
    url: string;
    size_bytes: number;
    size_human?: string;
    updated_at: string | null;
  }>;
  message?: string;
};

type DeleteResponse = {
  ok: boolean;
  filename?: string;
  message?: string;
};

type AdminRawResponse = {
  ok: boolean;
  filename?: string;
  geojson?: GeoJsonObject;
  message?: string;
};

type UpdatePropertiesResponse = {
  ok: boolean;
  filename?: string;
  changed_features?: number;
  total_features?: number;
  url?: string;
  message?: string;
};

export default function GeojsonUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resultUrl, setResultUrl] = useState<string>("");

  const [desiredFilename, setDesiredFilename] = useState<string>("");
  const [overwrite, setOverwrite] = useState<boolean>(true);

  const [items, setItems] = useState<ListResponse["items"]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [selectedFilename, setSelectedFilename] = useState<string>("");
  const [rawLoading, setRawLoading] = useState<boolean>(false);
  const [rawGeojson, setRawGeojson] = useState<GeoJsonObject | null>(null);
  const [editIdKey, setEditIdKey] = useState<string>("kdkab");
  const [editLabelKey, setEditLabelKey] = useState<string>("nama_kab");
  const [editIdDigits, setEditIdDigits] = useState<number>(2);
  const [previewMaxFeatures, setPreviewMaxFeatures] = useState<number>(200);
  const [mappingText, setMappingText] = useState<string>("");
  const [applyLoading, setApplyLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string>("");
  const [renderingPreview, setRenderingPreview] = useState<boolean>(false);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const geoLayerRef = useRef<LeafletGeoJSON | null>(null);

  const [uploadedBytes, setUploadedBytes] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const MAX_MB = 50;

  const fullUrl = useMemo(() => {
    if (!resultUrl) return "";
    if (typeof window === "undefined") return resultUrl;
    try {
      return new URL(resultUrl, window.location.origin).toString();
    } catch {
      return resultUrl;
    }
  }, [resultUrl]);

  const uploadPercent = useMemo(() => {
    if (!loading) return 0;
    if (!totalBytes) return 0;
    return Math.max(0, Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)));
  }, [loading, uploadedBytes, totalBytes]);

  const detectedPropertyKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!rawGeojson || typeof rawGeojson !== "object") return [];

    // Only scan a limited number of features to keep UI responsive for huge files.
    const anyGeo = rawGeojson as any;
    const features = Array.isArray(anyGeo?.features) ? anyGeo.features : [];
    const maxScan = Math.min(features.length, 300);

    for (let i = 0; i < maxScan; i++) {
      const f = features[i];
      const props = f && typeof f === "object" ? (f as any).properties : null;
      if (!props || typeof props !== "object") continue;
      for (const k of Object.keys(props)) {
        if (k && typeof k === "string") keys.add(k);
      }
    }

    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [rawGeojson]);

  const previewGeojson = useMemo(() => {
    if (!rawGeojson) return null;
    const limit = Number(previewMaxFeatures || 0);
    if (!Number.isFinite(limit) || limit <= 0) return rawGeojson;

    const g = rawGeojson as unknown as { type?: string; features?: unknown[] };
    if (g?.type !== "FeatureCollection" || !Array.isArray(g.features)) return rawGeojson;
    if (g.features.length <= limit) return rawGeojson;

    return {
      ...(rawGeojson as any),
      features: g.features.slice(0, limit),
    } as GeoJsonObject;
  }, [rawGeojson, previewMaxFeatures]);

  async function refreshList() {
    setListLoading(true);
    try {
      const res = await api.get<ListResponse>("/geojson/list");
      const payload = res.data;
      if (!payload.ok) throw new Error(payload.message || "Gagal memuat list geojson");
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat list GeoJSON"));
    } finally {
      setListLoading(false);
    }
  }

  async function deleteItem(filename: string) {
    if (loading || listLoading) return;
    const ok = typeof window !== "undefined" ? window.confirm(`Hapus file ini?\n\n${filename}`) : false;
    if (!ok) return;

    setError("");
    setSuccess("");
    try {
      const res = await api.delete<DeleteResponse>(`/geojson/file/${encodeURIComponent(filename)}`);
      const payload = res.data;
      if (!payload.ok) throw new Error(payload.message || "Gagal menghapus file");
      setSuccess(`File dihapus: ${payload.filename || filename}`);
      await refreshList();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal menghapus GeoJSON"));
    }
  }

  async function loadRaw(filename: string) {
    setSelectedFilename(filename);
    setRawLoading(true);
    setRawGeojson(null);
    setError("");
    setSuccess("");
    setPreviewError("");
    try {
      const res = await api.get<AdminRawResponse>(`/geojson/admin/raw/${encodeURIComponent(filename)}`);
      const payload = res.data;
      if (!payload.ok) throw new Error(payload.message || "Gagal memuat GeoJSON");
      setRawGeojson(payload.geojson || null);

      if (!mappingText.trim()) {
        setMappingText("01=Nama Kab 1\n02=Nama Kab 2\n71=Kota ...\n");
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat GeoJSON"));
    } finally {
      setRawLoading(false);
    }
  }

  function normalizeId(raw: string) {
    const s = String(raw || "")
      .trim()
      .replace(/^"|"$/g, "")
      .replace(/^'|'$/g, "");
    if (!s) return "";

    // If digits <= 0, no padding/normalization.
    const digits = Number(editIdDigits || 0);
    if (!Number.isFinite(digits) || digits <= 0) return s;

    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n) && n >= 0) return String(n).padStart(digits, "0");
    }
    return s;
  }

  function parseMapping(text: string) {
    const lines = String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    const updates: Array<{ id: string; label: string }> = [];
    for (const line of lines) {
      let id = "";
      let label = "";

      if (line.includes("=")) {
        const idx = line.indexOf("=");
        id = line.slice(0, idx).trim();
        label = line.slice(idx + 1).trim();
      } else if (line.includes(",")) {
        const parts = line.split(",");
        id = (parts[0] || "").trim();
        label = parts.slice(1).join(",").trim();
      } else {
        const parts = line.split(/\s+/);
        id = (parts[0] || "").trim();
        label = parts.slice(1).join(" ").trim();
      }

      const normId = normalizeId(id);
      const normLabel = String(label || "").trim();
      if (!normId || !normLabel) continue;
      updates.push({ id: normId, label: normLabel });
    }
    return updates;
  }

  async function applyMapping() {
    if (!selectedFilename) {
      setError("Pilih file GeoJSON untuk diedit.");
      return;
    }
    const updates = parseMapping(mappingText);
    if (!updates.length) {
      setError("Mapping kosong / format tidak valid. Contoh: 01=Halmahera Barat");
      return;
    }

    setApplyLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.post<UpdatePropertiesResponse>(
        `/geojson/admin/update-properties/${encodeURIComponent(selectedFilename)}`,
        {
          idKey: editIdKey,
          labelKey: editLabelKey,
          updates,
        }
      );
      const payload = res.data;
      if (!payload.ok) throw new Error(payload.message || "Gagal menyimpan perubahan");

      setSuccess(`Tersimpan. Berubah ${payload.changed_features ?? 0} dari ${payload.total_features ?? 0} feature.`);
      await refreshList();
      await loadRaw(selectedFilename);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal menyimpan perubahan"));
    } finally {
      setApplyLoading(false);
    }
  }

  useEffect(() => {
    refreshList();
  }, []);

  // Leaflet map init (no external tiles)
  useEffect(() => {
    let cancelled = false;
    async function ensureMap() {
      if (!mapRef.current) return;
      try {
        const L = await import("leaflet");
        if (cancelled) return;

        if (!mapInstanceRef.current) {
          const map = L.map(mapRef.current, {
            zoomControl: true,
            attributionControl: false,
          }).setView([0, 0], 5);
          mapInstanceRef.current = map;

          // Ensure correct sizing after initial paint.
          setTimeout(() => {
            try {
              map.invalidateSize();
            } catch {
              // ignore
            }
          }, 0);
        }
      } catch (e: unknown) {
        setPreviewError(getErrorMessage(e, "Gagal inisialisasi Leaflet"));
      }
    }
    ensureMap();
    return () => {
      cancelled = true;
      try {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
        }
      } catch {
        // ignore
      }
      mapInstanceRef.current = null;
      geoLayerRef.current = null;
    };
  }, []);

  // Re-render GeoJSON layer when data/keys change
  useEffect(() => {
    let cancelled = false;
    async function renderGeo() {
      const map = mapInstanceRef.current;
      if (!map) return;

      setRenderingPreview(true);
      setPreviewError("");

      let L: typeof import("leaflet");
      try {
        L = await import("leaflet");
      } catch (e: unknown) {
        setPreviewError(getErrorMessage(e, "Gagal memuat Leaflet"));
        setRenderingPreview(false);
        return;
      }
      if (cancelled) return;

      if (geoLayerRef.current) {
        try {
          geoLayerRef.current.remove();
        } catch {
          // ignore
        }
        geoLayerRef.current = null;
      }

      if (!previewGeojson) return;

      let layer: LeafletGeoJSON;
      try {
        layer = L.geoJSON(previewGeojson, {
        style: () => ({
          weight: 1,
          opacity: 1,
          fillOpacity: 0.12,
        }),
        onEachFeature: (feature: unknown, leafletLayer: unknown) => {
          try {
            const f = feature as { properties?: Record<string, unknown> };
            const props = (f && typeof f === "object" ? f.properties : null) || {};
            const kode = props[editIdKey];
            const label = props[editLabelKey];
            const title = label ? String(label) : kode ? String(kode) : "Feature";
            const l = leafletLayer as { bindTooltip?: (t: string, o?: unknown) => void };
            l?.bindTooltip?.(title, { sticky: true });
          } catch {
            // ignore
          }
        },
        });
      } catch (e: unknown) {
        setPreviewError(getErrorMessage(e, "Gagal render GeoJSON (format/ukuran mungkin bermasalah)"));
        setRenderingPreview(false);
        return;
      }

      geoLayerRef.current = layer;
      layer.addTo(map);

      try {
        const bounds = layer.getBounds();
        if (bounds && bounds.isValid && bounds.isValid()) {
          map.fitBounds(bounds.pad(0.05));
        }

        // Invalidate size after layer render (fixes blank map on first paint)
        setTimeout(() => {
          try {
            map.invalidateSize();
          } catch {
            // ignore
          }
        }, 0);
      } catch {
        // ignore
      }

      setRenderingPreview(false);
    }

    renderGeo();
    return () => {
      cancelled = true;
    };
  }, [previewGeojson, editIdKey, editLabelKey]);

  async function upload() {
    setError("");
    setSuccess("");
    setResultUrl("");
    setUploadedBytes(0);
    setTotalBytes(0);

    if (!file) {
      setError("Pilih file .geojson terlebih dahulu.");
      return;
    }

    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File terlalu besar untuk batas upload server (${MAX_MB}MB).`);
      return;
    }

    const form = new FormData();
    if (desiredFilename.trim()) form.append("filename", desiredFilename.trim());
    form.append("overwrite", overwrite ? "true" : "false");
    form.append("file", file);

    setLoading(true);
    try {
      const config: AxiosRequestConfig = {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt: AxiosProgressEvent) => {
          const loaded = Number(evt?.loaded || 0);
          const total = Number(evt?.total || file.size || 0);
          setUploadedBytes(loaded);
          setTotalBytes(total);
        },
      };

      const res = await api.post<UploadResponse>("/geojson/upload", form, config);
      const payload = res.data;
      if (!payload.ok) throw new Error(payload.message || "Upload gagal");
      if (!payload.url) throw new Error("Server tidak mengembalikan url");

      setResultUrl(payload.url);
      setSuccess(`Upload berhasil: ${payload.filename || "(tanpa nama)"}`);
      await refreshList();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal upload GeoJSON"));
    } finally {
      setLoading(false);
    }
  }

  function chooseFile(next: File | null) {
    setFile(next);
    setSuccess("");
    setError("");
    setResultUrl("");
    setUploadedBytes(0);
    setTotalBytes(0);
    if (!next) {
      setDesiredFilename("");
      setOverwrite(true);
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Upload GeoJSON (Public URL)</h1>

        <div className="text-sm text-muted-foreground">
          File yang diupload akan tersedia publik (tanpa login) dan bisa dipakai peta tematik.
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <div className="rounded-xl border border-border bg-card text-card-foreground p-4 space-y-4">
          <div
            className="rounded-xl border border-dashed border-border bg-muted/40 p-6 text-center cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer.files?.[0] || null;
              chooseFile(f);
            }}
            role="button"
            aria-label="Upload GeoJSON"
          >
            <div className="text-sm font-medium">Klik untuk pilih file atau drag & drop</div>
            <div className="mt-1 text-xs text-muted-foreground">Max {MAX_MB}MB • GeoJSON (.geojson / .json)</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              className="hidden"
              disabled={loading}
              onChange={(e) => chooseFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">File dipilih</div>
              <div className="text-xs text-muted-foreground break-all">
                {file ? (
                  <>
                    <b>{file.name}</b> • {formatBytes(file.size)}
                  </>
                ) : (
                  "-"
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <button className="px-3 py-2 rounded border disabled:opacity-50" disabled={loading || !file} onClick={() => upload()}>
                {loading ? "Uploading…" : "Upload"}
              </button>
              <button className="px-3 py-2 rounded border disabled:opacity-50" disabled={loading} onClick={() => chooseFile(null)}>
                Reset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Nama file (opsional)</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm bg-background disabled:opacity-50"
                placeholder="contoh: peta_kabkot-malut.geojson"
                value={desiredFilename}
                disabled={loading}
                onChange={(e) => setDesiredFilename(e.target.value)}
              />
              <div className="mt-1 text-xs text-muted-foreground">Jika diisi, URL publik akan stabil sesuai nama ini.</div>
            </div>
            <div className="md:col-span-1">
              <label className="block text-sm font-medium mb-1">Mode</label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overwrite} disabled={loading} onChange={(e) => setOverwrite(e.target.checked)} />
                Overwrite jika sudah ada
              </label>
              <div className="mt-1 text-xs text-muted-foreground">Disarankan ON untuk peta tematik.</div>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>
                  <b>{uploadPercent}%</b> • {formatBytes(uploadedBytes)} / {formatBytes(totalBytes || (file ? file.size : 0))}
                </span>
              </div>
              <div className="h-2 rounded bg-muted overflow-hidden border border-border">
                <div
                  className={
                    totalBytes
                      ? "h-full bg-green-600 transition-[width] duration-200"
                      : "h-full bg-green-600 animate-pulse"
                  }
                  style={{ width: `${totalBytes ? uploadPercent : 100}%` }}
                />
              </div>
            </div>
          ) : null}

          {fullUrl ? (
            <div className="rounded border border-border bg-muted p-3">
              <div className="text-xs text-muted-foreground mb-1">Public URL (pakai di peta tematik):</div>
              <div className="text-sm break-all">{fullUrl}</div>
              <div className="mt-2">
                <a className="text-sm underline" href={resultUrl} target="_blank" rel="noreferrer">
                  Buka raw GeoJSON
                </a>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Preview & Edit Properties</div>
              <div className="text-xs text-muted-foreground">
                Update label berdasarkan <b>kdkab</b> (kode 2 digit).
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">File:</div>
                <select
                  className="px-2 py-2 rounded border bg-background min-w-0 flex-1"
                  value={selectedFilename}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    loadRaw(v);
                  }}
                  disabled={rawLoading || listLoading || loading}
                >
                  <option value="">Pilih file…</option>
                  {(items || []).map((it) => (
                    <option key={it.filename} value={it.filename}>
                      {it.filename}
                    </option>
                  ))}
                </select>
                <button
                  className="px-3 py-2 rounded border disabled:opacity-50"
                  disabled={!selectedFilename || rawLoading || loading}
                  onClick={() => selectedFilename && loadRaw(selectedFilename)}
                >
                  {rawLoading ? "Loading…" : "Load"}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">ID key (kode)</label>
                  <select
                    className="w-full border rounded px-3 py-2 text-sm bg-background disabled:opacity-50 mb-2"
                    value={detectedPropertyKeys.includes(editIdKey) ? editIdKey : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) setEditIdKey(v);
                    }}
                    disabled={applyLoading || loading || rawLoading || !detectedPropertyKeys.length}
                    title={detectedPropertyKeys.length ? "Pilih dari key yang terdeteksi" : "Load file dulu agar key terdeteksi"}
                  >
                    <option value="">{detectedPropertyKeys.length ? "Pilih key terdeteksi…" : "(Load file dulu)"}</option>
                    {detectedPropertyKeys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm bg-background disabled:opacity-50"
                    value={editIdKey}
                    onChange={(e) => setEditIdKey(e.target.value)}
                    placeholder="kdkab"
                    disabled={applyLoading || loading}
                  />
                  <div className="mt-1 text-[11px] text-muted-foreground">Bisa pilih dari dropdown atau ketik manual.</div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Digit ID (padding)</label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm bg-background disabled:opacity-50"
                    type="number"
                    min={0}
                    step={1}
                    value={editIdDigits}
                    onChange={(e) => setEditIdDigits(Number(e.target.value || 0))}
                    placeholder="2"
                    disabled={applyLoading || loading}
                  />
                  <div className="mt-1 text-[11px] text-muted-foreground">Isi 0 untuk nonaktif.</div>

                  <label className="block text-xs font-medium mt-3 mb-1">Limit preview (features)</label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm bg-background disabled:opacity-50"
                    type="number"
                    min={0}
                    step={50}
                    value={previewMaxFeatures}
                    onChange={(e) => setPreviewMaxFeatures(Number(e.target.value || 0))}
                    placeholder="200"
                    disabled={loading || rawLoading}
                  />
                  <div className="mt-1 text-[11px] text-muted-foreground">Set 0 untuk preview semua (bisa berat).</div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Label key (nama)</label>
                  <select
                    className="w-full border rounded px-3 py-2 text-sm bg-background disabled:opacity-50 mb-2"
                    value={detectedPropertyKeys.includes(editLabelKey) ? editLabelKey : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) setEditLabelKey(v);
                    }}
                    disabled={applyLoading || loading || rawLoading || !detectedPropertyKeys.length}
                    title={detectedPropertyKeys.length ? "Pilih dari key yang terdeteksi" : "Load file dulu agar key terdeteksi"}
                  >
                    <option value="">{detectedPropertyKeys.length ? "Pilih key terdeteksi…" : "(Load file dulu)"}</option>
                    {detectedPropertyKeys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm bg-background disabled:opacity-50"
                    value={editLabelKey}
                    onChange={(e) => setEditLabelKey(e.target.value)}
                    placeholder="nama_kab"
                    disabled={applyLoading || loading}
                  />
                  <div className="mt-1 text-[11px] text-muted-foreground">Boleh pakai key baru (akan dibuat di properties).</div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Mapping (format: 01=Nama)</label>
                <textarea
                  className="w-full min-h-[180px] border rounded px-3 py-2 text-xs bg-background font-mono disabled:opacity-50"
                  value={mappingText}
                  onChange={(e) => setMappingText(e.target.value)}
                  placeholder={"01=Halmahera Barat\n02=Halmahera Tengah\n71=Kota Ternate"}
                  disabled={applyLoading || loading}
                />
                <div className="mt-1 text-xs text-muted-foreground">Kode dinormalisasi sesuai Digit ID (contoh: 1 → {String(editIdDigits || 0)} digit). Set 0 untuk nonaktif.</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-2 rounded border disabled:opacity-50"
                  disabled={!selectedFilename || applyLoading || loading}
                  onClick={() => applyMapping()}
                >
                  {applyLoading ? "Menyimpan…" : "Simpan Perubahan"}
                </button>

                {selectedFilename ? (
                  <a
                    className="text-xs underline text-muted-foreground"
                    href={`/geojson/${encodeURIComponent(selectedFilename)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Buka raw URL
                  </a>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Preview Map (tanpa tile eksternal)</div>
              <div className="rounded-lg border border-border overflow-hidden">
                <div ref={mapRef} className="h-[420px] w-full bg-muted" />
              </div>
              {previewError ? (
                <div className="text-xs text-red-700">{previewError}</div>
              ) : renderingPreview ? (
                <div className="text-xs text-muted-foreground">Render GeoJSON… (jika file besar bisa agak lama)</div>
              ) : !selectedFilename ? (
                <div className="text-xs text-muted-foreground">Pilih file lalu klik Load/Preview.</div>
              ) : rawLoading ? (
                <div className="text-xs text-muted-foreground">Memuat data…</div>
              ) : !rawGeojson ? (
                <div className="text-xs text-muted-foreground">Belum ada data untuk dipreview.</div>
              ) : (
                <div className="text-xs text-muted-foreground">OK.</div>
              )}
              <div className="text-xs text-muted-foreground">
                Tooltip menampilkan field <b>{editLabelKey}</b> (jika ada) atau <b>{editIdKey}</b>.
              </div>
            </div>
          </div>

        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div className="font-medium">Daftar GeoJSON</div>
            <button className="px-3 py-1 rounded border text-sm disabled:opacity-50" disabled={listLoading || loading} onClick={() => refreshList()}>
              {listLoading ? "Memuat…" : "Refresh"}
            </button>
          </div>
          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
            <table className="min-w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3">Nama File</th>
                  <th className="text-left p-3">Ukuran</th>
                  <th className="text-left p-3">Updated</th>
                  <th className="text-left p-3">Link</th>
                  <th className="text-left p-3">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(items || []).length ? (
                  (items || []).map((it) => (
                    <tr key={it.filename} className="border-t border-border">
                      <td className="p-3">
                        <div className="font-medium break-all">{it.filename}</div>
                      </td>
                      <td className="p-3">{it.size_human || formatBytes(it.size_bytes)}</td>
                      <td className="p-3">{fmt(it.updated_at)}</td>
                      <td className="p-3">
                        <a className="underline" href={it.url} target="_blank" rel="noreferrer">
                          Buka raw
                        </a>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            className="px-2 py-1 rounded border text-sm disabled:opacity-50"
                            disabled={loading || listLoading || rawLoading}
                            onClick={() => loadRaw(it.filename)}
                          >
                            Preview/Edit
                          </button>
                          <button
                            className="px-2 py-1 rounded border text-sm text-red-700 disabled:opacity-50"
                            disabled={loading || listLoading}
                            onClick={() => deleteItem(it.filename)}
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-border">
                    <td className="p-3 text-muted-foreground" colSpan={5}>
                      {listLoading ? "Memuat…" : "Belum ada file. Upload dulu di atas."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
