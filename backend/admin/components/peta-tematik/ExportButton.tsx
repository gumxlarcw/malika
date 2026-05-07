"use client";

import { useState } from "react";
import { Download } from "lucide-react";

interface Props {
  fileNameSeed: string;
  targetId?: string;
}

export default function ExportButton({ fileNameSeed, targetId = "peta-tematik-export-area" }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    if (loading) return;
    setLoading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const node = document.getElementById(targetId);
      if (!node) throw new Error("Export area not found");
      const canvas = await html2canvas(node, {
        backgroundColor: "#fff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed"))));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `peta-tematik-${fileNameSeed}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export PNG failed:", e);
      alert("Gagal export PNG. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border
                 hover:bg-muted text-sm transition-colors disabled:opacity-50"
    >
      <Download className="h-4 w-4" />
      <span>{loading ? "Exporting…" : "Export PNG"}</span>
    </button>
  );
}
