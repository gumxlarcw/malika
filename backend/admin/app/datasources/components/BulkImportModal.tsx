"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import { BulkImportResult, DataSourceRow, PrepareResponse } from "../types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  existingItems: DataSourceRow[];
  onRefresh: () => void;
};

export default function BulkImportModal({ isOpen, onClose, onSuccess, onError, existingItems, onRefresh }: Props) {
  const [bulkText, setBulkText] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkImportResult[]>([]);
  const [bulkDefaultCategory, setBulkDefaultCategory] = useState("");
  const [bulkSetDisplayOrder, setBulkSetDisplayOrder] = useState(false);
  const [bulkDisplayOrderStart, setBulkDisplayOrderStart] = useState(0);
  const [bulkDisplayOrderStep, setBulkDisplayOrderStep] = useState(1);
  const bulkCancelRef = useRef(false);

  function parseBulkUrls(text: string) {
    const raw = String(text || "").split(/\r?\n/g).map((s) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const u of raw) {
      const norm = u.replace(/\s+/g, " ").trim().toLowerCase();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      unique.push(u);
    }
    return { rawCount: raw.length, unique };
  }

  function stopBulkImport() {
    bulkCancelRef.current = true;
  }

  async function runBulkImport() {
    onError("");

    const { rawCount, unique } = parseBulkUrls(bulkText);
    if (unique.length === 0) {
      onError("Tidak ada URL yang valid");
      return;
    }
    if (unique.length > 500) {
      onError(`Maksimal 500 URL. Saat ini: ${unique.length} (unik) dari ${rawCount} baris.`);
      return;
    }

    const existingByApiUrl = new Map<string, number>();
    for (const ds of existingItems) {
      const key = String(ds.api_url || "").trim().toLowerCase();
      if (key) existingByApiUrl.set(key, ds.id);
    }

    bulkCancelRef.current = false;
    setBulkRunning(true);
    setBulkResults([]);

    const CONCURRENCY = 4;
    const out: BulkImportResult[] = new Array(unique.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < unique.length && !bulkCancelRef.current) {
        const idx = cursor++;
        const inputUrl = unique[idx];

        try {
          const res = await api.post<PrepareResponse>("/datasource/prepare", { url: inputUrl });
          const payload = res.data;
          const detectedType = payload?.detectedType;
          const suggested = (payload?.suggested || {}) as Partial<DataSourceRow>;

          if (detectedType === "exim") {
            out[idx] = { inputUrl, status: "skipped", detectedType, message: "Skip: EXIM dibuat via tombol Seed EXIM" };
            setBulkResults(out.filter(Boolean));
            continue;
          }

          if (detectedType === "pressrelease") {
            out[idx] = { inputUrl, status: "skipped", detectedType, message: "Skip: Press Release dibuat via tombol Press Release" };
            setBulkResults(out.filter(Boolean));
            continue;
          }

          const nameFinal = String(suggested?.name ?? "").trim();
          const apiUrlFinal = String(suggested?.api_url ?? "").trim();
          const apiUrlKey = apiUrlFinal.toLowerCase();

          if (!nameFinal || !apiUrlFinal) {
            out[idx] = { inputUrl, status: "error", detectedType, message: "Gagal: hasil parse tidak lengkap", api_url: apiUrlFinal, name: nameFinal };
            setBulkResults(out.filter(Boolean));
            continue;
          }

          const existingId = existingByApiUrl.get(apiUrlKey);
          if (existingId) {
            out[idx] = { inputUrl, status: "skipped", detectedType, message: `Skip: api_url sudah ada (#${existingId})`, api_url: apiUrlFinal, name: nameFinal };
            setBulkResults(out.filter(Boolean));
            continue;
          }

          const displayOrderFinal = bulkSetDisplayOrder ? bulkDisplayOrderStart + idx * bulkDisplayOrderStep : Number(suggested?.display_order ?? 0);

          const createPayload = {
            name: nameFinal,
            description: suggested?.description ?? null,
            aliases: suggested?.aliases ?? null,
            type: detectedType,
            api_url: apiUrlFinal,
            period_key: suggested?.period_key ?? null,
            category: suggested?.category || bulkDefaultCategory || null,
            auto_period: suggested?.auto_period ?? (detectedType === "dynamic" || detectedType === "interop"),
            visible: suggested?.visible ?? true,
            status: suggested?.status ?? true,
            display_order: Number.isFinite(displayOrderFinal) ? displayOrderFinal : 0,
          };

          try {
            const created = await api.post<DataSourceRow>("/datasource", createPayload);
            const createdId = Number((created.data as any)?.id);
            if (Number.isFinite(createdId) && createdId > 0) {
              existingByApiUrl.set(apiUrlKey, createdId);
            }
            out[idx] = { inputUrl, status: "created", detectedType, message: `OK: dibuat #${createdId || "?"}`, createdId: createdId || undefined, api_url: apiUrlFinal, name: nameFinal };
          } catch (e: any) {
            const status = e?.response?.status;
            const data = e?.response?.data;

            if (status === 409 && data?.code === "DATASOURCE_NAME_EXISTS") {
              const matches = Array.isArray(data?.matches) ? data.matches : [];
              out[idx] = { inputUrl, status: "skipped", detectedType, message: `Skip: nama duplikat (${matches.map((m: any) => `#${m.id}`).join(", ")})`, api_url: apiUrlFinal, name: nameFinal };
            } else {
              out[idx] = { inputUrl, status: "error", detectedType, message: getErrorMessage(e, "Gagal create datasource"), api_url: apiUrlFinal, name: nameFinal };
            }
          }
        } catch (e: unknown) {
          out[idx] = { inputUrl, status: "error", message: getErrorMessage(e, "Gagal memproses URL") };
        }

        setBulkResults(out.filter(Boolean));
      }
    };

    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
      if (bulkCancelRef.current) {
        onSuccess("Import dihentikan (stop)");
      } else {
        onSuccess("Import selesai");
      }
      await onRefresh();
    } finally {
      setBulkRunning(false);
    }
  }

  const { rawCount, unique } = parseBulkUrls(bulkText);

  return (
    <Modal isOpen={isOpen} onClose={bulkRunning ? () => {} : onClose} title="Import Banyak URL (maks. 500)" size="xl">
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          Tempel URL (1 per baris). Sistem akan auto-parse, lalu create. Duplikat akan di-skip.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Kategori default (opsional)</label>
            <input
              className="border rounded px-3 py-2 w-full"
              value={bulkDefaultCategory}
              onChange={(e) => setBulkDefaultCategory(e.target.value)}
              placeholder="Mis. Ekonomi / Sosial"
              disabled={bulkRunning}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Display Order</label>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={bulkSetDisplayOrder} onChange={(e) => setBulkSetDisplayOrder(e.target.checked)} disabled={bulkRunning} />
              <span className="text-sm">Set otomatis</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="border rounded px-3 py-2 w-full" value={bulkDisplayOrderStart} onChange={(e) => setBulkDisplayOrderStart(Number(e.target.value))} disabled={bulkRunning || !bulkSetDisplayOrder} placeholder="Start" />
              <input type="number" className="border rounded px-3 py-2 w-full" value={bulkDisplayOrderStep} onChange={(e) => setBulkDisplayOrderStep(Number(e.target.value))} disabled={bulkRunning || !bulkSetDisplayOrder} placeholder="Step" />
            </div>
          </div>
        </div>

        <textarea
          className="border rounded px-3 py-2 w-full font-mono text-xs"
          rows={10}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder="https://webapi.bps.go.id/v1/api/list/model/data/domain/8200/..."
          disabled={bulkRunning}
        />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            Baris: {rawCount} · Unik: {unique.length}
          </div>
          <div className="flex gap-2">
            {bulkRunning && <button className="px-3 py-2 rounded border border-border" onClick={stopBulkImport}>Stop</button>}
            <button className="px-3 py-2 rounded border border-border" onClick={onClose} disabled={bulkRunning}>Tutup</button>
            <button className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50" onClick={runBulkImport} disabled={bulkRunning}>
              {bulkRunning ? "Mengimpor…" : "Mulai Import"}
            </button>
          </div>
        </div>

        {bulkResults.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Hasil: dibuat={bulkResults.filter((r) => r.status === "created").length} · skip={bulkResults.filter((r) => r.status === "skipped").length} · error={bulkResults.filter((r) => r.status === "error").length}
            </div>
            <div className="rounded border border-border overflow-hidden max-h-80 overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2 w-28">Status</th>
                    <th className="text-left p-2">URL</th>
                    <th className="text-left p-2">Info</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkResults.map((r, idx) => (
                    <tr key={idx} className="border-t border-border">
                      <td className="p-2">
                        <span className={r.status === "created" ? "text-emerald-600" : r.status === "skipped" ? "text-amber-600" : "text-red-600"}>
                          {r.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-2 font-mono break-all">{r.inputUrl}</td>
                      <td className="p-2">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
