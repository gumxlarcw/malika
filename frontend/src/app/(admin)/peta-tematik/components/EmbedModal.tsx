"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Code2, X, Check, Copy } from "lucide-react";
import { buildShareUrl } from "../useUrlState";
import type { FilterState } from "../types";
import type { BinningMethod } from "../colorScale";

interface Props {
  filters: FilterState;
  binning: BinningMethod;
  indikatorName: string;
}

const EMBED_PRESETS = [
  { width: "100%", height: "600", label: "Lebar Penuh", icon: "▭" },
  { width: "640", height: "480", label: "Standar", icon: "▭" },
  { width: "480", height: "360", label: "Kompak", icon: "▫" },
];

/**
 * Generate iframe HTML snippet untuk embed di blog/media outlet.
 * Dimension presets + manual customization.
 * Includes both share-url and direct iframe code.
 */
export default function EmbedModal({ filters, binning, indikatorName }: Props) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState("100%");
  const [height, setHeight] = useState("600");
  const [copied, setCopied] = useState<"iframe" | "url" | null>(null);
  const [shareUrl, setShareUrl] = useState("");

  useEffect(() => {
    if (open) setShareUrl(buildShareUrl(filters, binning));
  }, [open, filters, binning]);

  const iframeCode = `<iframe
  src="${shareUrl}"
  width="${width}"
  height="${height}"
  frameborder="0"
  loading="lazy"
  title="Peta Tematik · ${indikatorName.replace(/"/g, "&quot;").slice(0, 80)}"
  style="border: 1px solid #E5DCC5; border-radius: 4px;"
></iframe>`;

  const copy = async (text: string, kind: "iframe" | "url") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Salin manual:", text);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 pt-mono text-[11px] uppercase tracking-wider border border-[var(--pt-border-strong)] hover:bg-[var(--pt-canvas-deep)] transition-colors rounded-xl"
      >
        <Code2 className="w-3.5 h-3.5" />
        Embed
      </button>

      <AnimatePresence>
        {open && (
          <div className="peta-tematik-page">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-gray-900/40 backdrop-blur-[2px] z-[1500]"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1501]
                         w-[min(680px,calc(100vw-32px))] max-h-[85vh] overflow-y-auto
                         bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl
                         shadow-2xl p-6 sm:p-8"
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute top-4 right-4 p-2 hover:bg-[var(--pt-canvas-deep)] rounded-xl"
              >
                <X className="w-5 h-5 text-[var(--pt-ink-soft)]" />
              </button>

              <div className="pt-eyebrow mb-2">Embed di Situs Anda</div>
              <h2 className="pt-display text-2xl sm:text-3xl text-[var(--pt-ink)] font-light leading-tight">
                Bagi Peta Tematik
              </h2>
              <p className="pt-body text-sm text-[var(--pt-ink-soft)] mt-2 mb-6 leading-relaxed">
                Tempelkan kode di bawah ke artikel/blog Anda. Peta akan ditampilkan dengan filter saat ini, dan dapat diakses langsung dari domain pembaca.
              </p>

              {/* Preset sizes */}
              <div className="mb-4">
                <div className="pt-eyebrow mb-2">Ukuran</div>
                <div className="flex gap-2 flex-wrap">
                  {EMBED_PRESETS.map((p) => {
                    const active = width === p.width && height === p.height;
                    return (
                      <button
                        key={p.label}
                        onClick={() => { setWidth(p.width); setHeight(p.height); }}
                        className={`px-3 py-2 pt-body text-xs rounded-xl border transition-colors ${
                          active
                            ? "bg-[var(--pt-ink)] text-[var(--pt-canvas)] border-[var(--pt-ink)]"
                            : "bg-[var(--pt-canvas-elevated)] text-[var(--pt-ink)] border-[var(--pt-border)] hover:border-[var(--pt-border-strong)]"
                        }`}
                      >
                        <span className="mr-1.5">{p.icon}</span>
                        {p.label}
                        <span className={`ml-1.5 pt-mono text-[10px] ${active ? "text-[var(--pt-canvas-deep)]" : "text-[var(--pt-ink-faint)]"}`}>
                          {p.width}×{p.height}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Manual size */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="pt-eyebrow block mb-1.5">Lebar</label>
                  <input
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    className="w-full px-3 py-2 pt-mono text-sm bg-[var(--pt-canvas-elevated)] border border-[var(--pt-border)] rounded-xl text-[var(--pt-ink)]"
                  />
                </div>
                <div>
                  <label className="pt-eyebrow block mb-1.5">Tinggi (px)</label>
                  <input
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    className="w-full px-3 py-2 pt-mono text-sm bg-[var(--pt-canvas-elevated)] border border-[var(--pt-border)] rounded-xl text-[var(--pt-ink)]"
                  />
                </div>
              </div>

              {/* Iframe code */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="pt-eyebrow">Kode HTML iframe</span>
                  <button
                    onClick={() => copy(iframeCode, "iframe")}
                    className="flex items-center gap-1.5 pt-mono text-[10px] uppercase tracking-wider hover:text-[var(--pt-accent)] transition-colors"
                  >
                    {copied === "iframe" ? (
                      <>
                        <Check className="w-3 h-3 text-[var(--pt-delta-pos)]" />
                        <span className="text-[var(--pt-delta-pos)]">Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Salin
                      </>
                    )}
                  </button>
                </div>
                <pre className="bg-[var(--pt-canvas-deep)] border border-[var(--pt-border)] rounded-xl p-3 pt-mono text-[11px] text-[var(--pt-ink)] overflow-x-auto whitespace-pre">
{iframeCode}
                </pre>
              </div>

              {/* Direct URL */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="pt-eyebrow">Tautan Langsung</span>
                  <button
                    onClick={() => copy(shareUrl, "url")}
                    className="flex items-center gap-1.5 pt-mono text-[10px] uppercase tracking-wider hover:text-[var(--pt-accent)] transition-colors"
                  >
                    {copied === "url" ? (
                      <>
                        <Check className="w-3 h-3 text-[var(--pt-delta-pos)]" />
                        <span className="text-[var(--pt-delta-pos)]">Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Salin
                      </>
                    )}
                  </button>
                </div>
                <input
                  readOnly
                  value={shareUrl}
                  onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                  className="w-full px-3 py-2 pt-mono text-[11px] bg-[var(--pt-canvas-deep)] border border-[var(--pt-border)] rounded-xl text-[var(--pt-ink)] cursor-text"
                />
              </div>

              <div className="mt-6 pt-4 border-t border-dotted border-[var(--pt-ink-faint)]/30 text-xs pt-body text-[var(--pt-ink-soft)] leading-relaxed">
                <strong className="pt-display not-italic font-medium text-[var(--pt-ink)]">
                  Tips:
                </strong>{" "}
                Embed di blog WordPress, Medium, atau platform sejenis dengan paste kode HTML di atas.
                Pengunjung dapat berinteraksi langsung dengan peta. Sumber data tetap{" "}
                <strong className="pt-display not-italic font-medium text-[var(--pt-ink)]">
                  malika.bpsmalut.com
                </strong>.
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
