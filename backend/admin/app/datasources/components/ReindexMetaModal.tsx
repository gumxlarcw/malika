"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import { DataSourceRow } from "../types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  existingItems: DataSourceRow[];
};

type ReindexResult = {
  id: number;
  name: string;
  status: "ok" | "error" | "skip";
  message?: string;
};

export default function ReindexMetaModal({ isOpen, onClose, onSuccess, onError, existingItems }: Props) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ReindexResult[]>([]);
  const [targetIds, setTargetIds] = useState<string>("");
  const [targetTypes, setTargetTypes] = useState<string[]>(["dynamic", "interop"]);

  function toggleType(t: string) {
    setTargetTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function runReindex() {
    setRunning(true);
    setResults([]);
    onError("");

    const idList = targetIds
      .split(/[,\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    let filtered = existingItems.filter((ds) => targetTypes.includes(ds.type));
    if (idList.length > 0) {
      filtered = filtered.filter((ds) => idList.includes(ds.id));
    }

    if (filtered.length === 0) {
      onError("Tidak ada datasource yang cocok");
      setRunning(false);
      return;
    }

    const out: ReindexResult[] = [];
    for (const ds of filtered) {
      try {
        const cacheRes = await api.get(`/cache/${ds.id}`);
        const cache = cacheRes.data?.data;

        if (!cache || !cache.processed_json) {
          out.push({ id: ds.id, name: ds.name, status: "skip", message: "Tidak ada cache" });
          setResults([...out]);
          continue;
        }

        const processed = typeof cache.processed_json === "string" ? JSON.parse(cache.processed_json) : cache.processed_json;
        const columns = Array.isArray(processed?.columns) ? processed.columns : [];
        const data = Array.isArray(processed?.data) ? processed.data : [];

        if (columns.length === 0 && data.length === 0) {
          out.push({ id: ds.id, name: ds.name, status: "skip", message: "Cache kosong" });
          setResults([...out]);
          continue;
        }

        const desc = columns.join(", ").slice(0, 255);
        const rowCount = data.length;

        await api.patch(`/datasource/${ds.id}`, {
          description: desc || ds.description,
          row_count: rowCount,
        });

        out.push({ id: ds.id, name: ds.name, status: "ok", message: `${rowCount} rows, ${columns.length} cols` });
      } catch (e) {
        out.push({ id: ds.id, name: ds.name, status: "error", message: getErrorMessage(e, "Error") });
      }
      setResults([...out]);
    }

    onSuccess(`Reindex selesai: ${out.filter((r) => r.status === "ok").length} OK, ${out.filter((r) => r.status === "skip").length} skip, ${out.filter((r) => r.status === "error").length} error`);
    setRunning(false);
  }

  return (
    <Modal isOpen={isOpen} onClose={running ? () => {} : onClose} title="Reindex Metadata dari Cache" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Mengupdate description dan row_count dari data cache terakhir.
        </p>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Filter ID (kosongkan untuk semua)</label>
          <input
            className="border rounded px-3 py-2 w-full font-mono text-sm"
            value={targetIds}
            onChange={(e) => setTargetIds(e.target.value)}
            placeholder="Contoh: 1, 2, 5 (pisah koma)"
            disabled={running}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Filter Type</label>
          <div className="flex gap-4">
            {["dynamic", "interop", "static", "exim", "pressrelease"].map((t) => (
              <label key={t} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={targetTypes.includes(t)} onChange={() => toggleType(t)} disabled={running} />
                {t}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button className="px-3 py-2 rounded border border-border" onClick={onClose} disabled={running}>
            Tutup
          </button>
          <button className="px-3 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50" onClick={runReindex} disabled={running}>
            {running ? "Memproses…" : "Mulai Reindex"}
          </button>
        </div>

        {results.length > 0 && (
          <div className="rounded border border-border overflow-hidden max-h-60 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="text-left p-2 w-16">ID</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2 w-24">Status</th>
                  <th className="text-left p-2">Info</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2">{r.id}</td>
                    <td className="p-2 truncate max-w-xs">{r.name}</td>
                    <td className="p-2">
                      <span className={r.status === "ok" ? "text-emerald-600" : r.status === "skip" ? "text-amber-600" : "text-red-600"}>
                        {r.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
