"use client";

import { useState, useCallback } from "react";
import { Link2, Download, FileText, Check } from "lucide-react";
import { fmtNumber } from "../colorScale";
import { buildShareUrl } from "../useUrlState";
import type { FilterState, DataPoint, IndikatorMeta } from "../types";
import type { BinningMethod, Palette } from "../colorScale";

interface Props {
  filters: FilterState;
  binning: BinningMethod;
  palette: Palette;
  data: DataPoint[];
  meta?: IndikatorMeta | null;
  indikatorName: string;
  kategori?: string;
}

const MONTH_LABELS = [
  "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// A3 landscape @ 150dpi — matches the design's artboard size exactly.
const A3_W = 2480;
const A3_H = 1754;

// Vertical sectioning — single source of truth for layout math.
const TOP_RULE_H = 6;
const BOTTOM_RULE_H = 6;
const HEADER_BAND_BOTTOM = 380;
const KPI_BAND_BOTTOM = 540;
const FOOTER_BAND_TOP = 1500;
const PAD_X = 80;

const FONT_DISPLAY = `"Outfit", system-ui, sans-serif`;
const FONT_MONO = `ui-monospace, "SF Mono", "Menlo", "Consolas", monospace`;

// Restrained palette: 4 ink shades + a single accent (carried by `palette.accent`).
const COLOR = {
  ink: "#0f172a",       // slate-900 — body
  inkSoft: "#475569",   // slate-600 — secondary
  ghost: "#94a3b8",     // slate-400 — labels / quiet meta
  hairline: "#e2e8f0",  // slate-200 — section dividers
  white: "#ffffff",
  panel: "#fafbfc",
};

/**
 * Polls the DOM until every visible Leaflet tile has the `leaflet-tile-loaded`
 * class, or until `timeoutMs` elapses. Prevents html2canvas from capturing a
 * basemap with placeholder/missing tiles.
 */
async function waitForLeafletTiles(root: HTMLElement, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tiles = root.querySelectorAll(".leaflet-tile");
    if (tiles.length > 0) {
      const loaded = root.querySelectorAll(".leaflet-tile.leaflet-tile-loaded");
      if (loaded.length === tiles.length) return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Greedy word-wrap based on ctx.measureText. Respects current ctx.font. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w;
    if (ctx.measureText(trial).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function ellipsizeToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = `${text.slice(0, mid).trimEnd()}…`;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  return `${text.slice(0, Math.max(0, lo - 1)).trimEnd()}…`;
}

interface InlineSeg {
  text: string;
  sup: boolean;
}

function parseInlineHtml(input: string): InlineSeg[] {
  if (!input) return [];
  let s = String(input);
  for (let pass = 0; pass < 2; pass++) {
    s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  }
  const segs: InlineSeg[] = [];
  const re = /<sup[^>]*>([\s\S]*?)<\/sup>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      segs.push({ text: s.slice(last, m.index).replace(/<[^>]*>/g, ""), sup: false });
    }
    segs.push({ text: m[1].replace(/<[^>]*>/g, "").trim(), sup: true });
    last = re.lastIndex;
  }
  if (last < s.length) segs.push({ text: s.slice(last).replace(/<[^>]*>/g, ""), sup: false });
  return segs.filter((seg) => seg.text.length > 0);
}

function layoutInlineSegments(
  ctx: CanvasRenderingContext2D,
  segs: InlineSeg[],
  maxWidth: number,
  baseSize: number,
): InlineSeg[][] {
  const lines: InlineSeg[][] = [[]];
  let curWidth = 0;
  const measureSeg = (seg: InlineSeg, text: string) => {
    ctx.font = seg.sup
      ? `600 ${Math.round(baseSize * 0.55)}px ${FONT_DISPLAY}`
      : `600 ${baseSize}px ${FONT_DISPLAY}`;
    return ctx.measureText(text).width;
  };
  for (const seg of segs) {
    if (seg.sup) {
      const w = measureSeg(seg, seg.text);
      if (curWidth + w > maxWidth && lines[lines.length - 1].length > 0) {
        lines.push([]);
        curWidth = 0;
      }
      lines[lines.length - 1].push(seg);
      curWidth += w;
      continue;
    }
    const words = seg.text.split(/\s+/).filter(Boolean);
    for (const word of words) {
      const wWithSpace = (lines[lines.length - 1].length === 0 ? "" : " ") + word;
      const wWidth = measureSeg(seg, wWithSpace);
      if (curWidth + wWidth > maxWidth && lines[lines.length - 1].length > 0) {
        lines.push([]);
        curWidth = 0;
        const firstWidth = measureSeg(seg, word);
        lines[lines.length - 1].push({ text: word, sup: false });
        curWidth += firstWidth;
      } else {
        lines[lines.length - 1].push({ text: wWithSpace, sup: false });
        curWidth += wWidth;
      }
    }
  }
  return lines.filter((line) => line.length > 0);
}

function drawInlineLine(
  ctx: CanvasRenderingContext2D,
  line: InlineSeg[],
  x: number,
  y: number,
  baseSize: number,
  color: string,
) {
  let cx = x;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  for (const seg of line) {
    if (seg.sup) {
      const supSize = Math.round(baseSize * 0.55);
      ctx.font = `600 ${supSize}px ${FONT_DISPLAY}`;
      const supOffset = Math.round(supSize * 0.05);
      ctx.fillText(seg.text, cx, y + supOffset);
      cx += ctx.measureText(seg.text).width;
    } else {
      ctx.font = `600 ${baseSize}px ${FONT_DISPLAY}`;
      ctx.fillText(seg.text, cx, y);
      cx += ctx.measureText(seg.text).width;
    }
  }
}

function hairline(ctx: CanvasRenderingContext2D, x1: number, y: number, x2: number, color = COLOR.hairline) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y + 0.5);
  ctx.lineTo(x2, y + 0.5);
  ctx.stroke();
}

function vline(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, color = COLOR.hairline) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y1);
  ctx.lineTo(x + 0.5, y2);
  ctx.stroke();
}

function fitContain(srcW: number, srcH: number, dstW: number, dstH: number) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  let drawW: number;
  let drawH: number;
  if (srcRatio > dstRatio) {
    drawW = dstW;
    drawH = Math.round(dstW / srcRatio);
  } else {
    drawH = dstH;
    drawW = Math.round(dstH * srcRatio);
  }
  return {
    w: drawW,
    h: drawH,
    dx: Math.round((dstW - drawW) / 2),
    dy: Math.round((dstH - drawH) / 2),
  };
}


export default function ShareBar({ filters, binning, palette, data, meta, indikatorName, kategori }: Props) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleCopyLink = useCallback(async () => {
    const url = buildShareUrl(filters, binning, palette.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Salin URL:", url);
    }
  }, [filters, binning, palette.id]);

  const handleDownloadCsv = useCallback(() => {
    if (!data || data.length === 0) return;
    const header = "kdkab,nama_kab,value\n";
    const rows = data
      .map((d) => `"${d.kdkab}","${d.nama_kab.replace(/"/g, '""')}",${d.value ?? ""}`)
      .join("\n");
    const csv = header + rows + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = (indikatorName || `indikator-${filters.indikator}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    a.href = url;
    a.download = `peta-tematik-${slug}-${filters.year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [data, filters.indikator, filters.year, indikatorName]);

  const handleDownloadPng = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas-pro")).default;

      const leafletEl = document.querySelector<HTMLElement>(".leaflet-container");
      if (!leafletEl) throw new Error("Leaflet map not found");
      await waitForLeafletTiles(leafletEl, 3000);

      // Map slot dimensions on the A3 canvas — drives capture scale.
      const sidePanelW = 580;
      const mapSlotX = PAD_X;
      const mapSlotY = KPI_BAND_BOTTOM;
      const mapSlotW = A3_W - PAD_X * 2 - sidePanelW;
      const mapSlotH = FOOTER_BAND_TOP - KPI_BAND_BOTTOM;
      const captureScale = Math.max(2, Math.ceil(mapSlotW / leafletEl.offsetWidth));

      const mapCanvas = await html2canvas(leafletEl, {
        backgroundColor: "#ffffff",
        scale: captureScale,
        useCORS: true,
        logging: false,
      });

      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = A3_W;
      finalCanvas.height = A3_H;
      const ctx = finalCanvas.getContext("2d");
      if (!ctx) throw new Error("ctx null");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // White background
      ctx.fillStyle = COLOR.white;
      ctx.fillRect(0, 0, A3_W, A3_H);

      // Top + bottom accent rules — visual frame of the document
      ctx.fillStyle = palette.accent;
      ctx.fillRect(0, 0, A3_W, TOP_RULE_H);
      ctx.fillRect(0, A3_H - BOTTOM_RULE_H, A3_W, BOTTOM_RULE_H);

      const today = new Date().toLocaleDateString("id-ID", {
        day: "numeric", month: "long", year: "numeric",
      });

      const valid = data.filter((d) => d.value != null) as Array<DataPoint & { value: number }>;
      const totalValue = valid.reduce((s, d) => s + d.value, 0);
      const max = valid.reduce((m, d) => (d.value > m.value ? d : m), valid[0]);
      const min = valid.reduce((m, d) => (d.value < m.value ? d : m), valid[0]);
      const avg = valid.length ? Math.round(totalValue / valid.length) : 0;

      // Resolve unit label — prefer explicit meta.unit, fall back to empty string
      // (drop the misleading hardcoded "ha"). The KPI strip's "unit" slot below
      // each value is a *unit label* slot — it shows the actual measure unit
      // when available, the kab/kota name for tertinggi/terendah otherwise.
      const unitLabel = meta?.unit ?? "";

      drawHeader(ctx, {
        accent: palette.accent,
        accentSoft: palette.colors[0],
        indikatorName,
        titleHtml: meta?.title_id_html ?? null,
        komoditi: filters.metric && filters.metric !== "value" ? filters.metric : null,
        year: filters.year,
        month: filters.month,
        indikatorId: filters.indikator,
        nValid: valid.length,
      });

      drawKpiStrip(ctx, {
        accent: palette.accent,
        cells: [
          { label: "Total", value: fmtNumber(totalValue), unit: unitLabel, color: palette.accent },
          { label: "Tertinggi", value: fmtNumber(max?.value ?? 0), unit: trim(max?.nama_kab.replace(/^(Kabupaten|Kota)\s+/i, ""), 18), color: COLOR.ink },
          { label: "Terendah", value: fmtNumber(min?.value ?? 0), unit: trim(min?.nama_kab.replace(/^(Kabupaten|Kota)\s+/i, ""), 18), color: COLOR.ink },
          { label: "Rata-rata", value: fmtNumber(avg), unit: unitLabel, color: COLOR.ink },
          { label: "Wilayah", value: String(valid.length), unit: "kab/kota", color: COLOR.ink },
        ],
      });

      drawMapPanel(ctx, mapCanvas, {
        palette,
        data: valid,
        x: mapSlotX, y: mapSlotY, mapW: mapSlotW, h: mapSlotH, sideW: sidePanelW,
      });

      drawFooter(ctx, {
        accent: palette.accent,
        kategori: meta?.responsible_party || kategori,
        indikator: filters.indikator,
        today,
        legend: meta?.data_legend ?? null,
        bpsLastUpdate: meta?.bps_last_update ?? null,
      });

      // Download
      const blob: Blob = await new Promise((res, rej) =>
        finalCanvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = (indikatorName || `indikator-${filters.indikator}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      a.href = url;
      a.download = `peta-tematik-${slug}-${filters.year}-A3.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("PNG export:", e);
      alert("Gagal export PNG.");
    } finally {
      setExporting(false);
    }
  }, [exporting, palette, indikatorName, filters.metric, filters.year, filters.month, filters.indikator, data, kategori]);

  const buttonClass =
    "flex items-center gap-2 px-3 py-1.5 pt-mono text-[11px] uppercase tracking-wider border border-[var(--pt-border-strong)] hover:bg-[var(--pt-canvas-deep)] transition-colors rounded-xl";

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 justify-end">
      <button onClick={handleCopyLink} className={buttonClass} aria-label="Salin link">
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-[var(--pt-delta-pos)]" />
            <span className="text-[var(--pt-delta-pos)]">Tersalin</span>
          </>
        ) : (
          <>
            <Link2 className="w-3.5 h-3.5" />
            Salin Link
          </>
        )}
      </button>
      <button onClick={handleDownloadCsv} className={buttonClass} aria-label="Unduh CSV">
        <FileText className="w-3.5 h-3.5" />
        CSV
      </button>
      <button onClick={handleDownloadPng} disabled={exporting} className={buttonClass + " disabled:opacity-50"} aria-label="Unduh PNG">
        <Download className="w-3.5 h-3.5" />
        {exporting ? "Memproses…" : "PNG"}
      </button>
    </div>
  );
}

// ─── Drawing helpers — A3 (2480 × 1754) ────────────────────────────────────────

function drawHeader(
  ctx: CanvasRenderingContext2D,
  opts: {
    accent: string;
    accentSoft: string;
    indikatorName: string;
    titleHtml: string | null;
    komoditi: string | null;
    year: number | null;
    month: number | null;
    indikatorId: number | null;
    nValid: number;
  },
) {
  const { accent, accentSoft, indikatorName, titleHtml, komoditi, year, month, indikatorId, nValid } = opts;
  const top = TOP_RULE_H + 60;

  ctx.textBaseline = "top";

  // Eyebrow row (left) + brand wordmark stack (right)
  ctx.font = `600 12px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.ghost;
  ctx.fillText("PETA TEMATIK · CHOROPLETH", PAD_X, top);

  drawBrandMarks(ctx, A3_W - PAD_X, top, accent);

  // Title — 52px, max 2 lines
  // Parse the BPS-supplied HTML title into segments so we can render
  // <sup>…</sup> footnote markers inline without losing them.
  const titleY = top + 50;
  const titleSize = 52;
  ctx.font = `600 ${titleSize}px ${FONT_DISPLAY}`;
  const titleMaxW = A3_W - PAD_X * 2 - 280;

  const segments = parseInlineHtml(titleHtml || indikatorName);
  const titleLines = layoutInlineSegments(ctx, segments, titleMaxW, titleSize).slice(0, 2);

  let cy = titleY;
  for (const line of titleLines) {
    drawInlineLine(ctx, line, PAD_X, cy, titleSize, COLOR.ink);
    cy += Math.round(titleSize * 1.05);
  }
  ctx.fillStyle = accent;
  // Append accent-colored period at end of last line
  const lastLine = titleLines[titleLines.length - 1];
  if (lastLine) {
    const lastLineWidth = lastLine.reduce((w, seg) => {
      ctx.font = seg.sup
        ? `600 ${Math.round(titleSize * 0.55)}px ${FONT_DISPLAY}`
        : `600 ${titleSize}px ${FONT_DISPLAY}`;
      return w + ctx.measureText(seg.text).width;
    }, 0);
    ctx.font = `600 ${titleSize}px ${FONT_DISPLAY}`;
    ctx.fillText(".", PAD_X + lastLineWidth, cy - Math.round(titleSize * 1.05));
  }

  // Subtitle row — komoditi chip + meta
  const subY = cy + 22;
  let subX = PAD_X;
  if (komoditi) {
    drawChip(ctx, subX, subY, komoditi, accentSoft, accent);
    subX += measureChip(ctx, komoditi) + 16;
  }
  const metaParts: string[] = [];
  if (year != null) {
    const m = month && month >= 1 && month <= 12 ? ` ${MONTH_LABELS[month]}` : "";
    metaParts.push(`Tahun ${year}${m}`);
  }
  metaParts.push(`${nValid} kabupaten/kota`);
  if (indikatorId != null) metaParts.push(`INDIKATOR_${indikatorId}`);
  ctx.font = `400 16px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.inkSoft;
  ctx.textBaseline = "middle";
  ctx.fillText(metaParts.join("  ·  "), subX, subY + 18);
  ctx.textBaseline = "top";

  hairline(ctx, PAD_X, HEADER_BAND_BOTTOM, A3_W - PAD_X);
}

function measureChip(ctx: CanvasRenderingContext2D, text: string): number {
  const prevFont = ctx.font;
  ctx.font = `600 14px ${FONT_DISPLAY}`;
  const w = ctx.measureText(text).width + 24;
  ctx.font = prevFont;
  return w;
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, text: string,
  bg: string, fg: string,
) {
  ctx.font = `600 14px ${FONT_DISPLAY}`;
  const w = ctx.measureText(text).width + 24;
  const h = 36;
  // Pill rounded-rect (radius ~4px for editorial feel; not pill)
  const r = 4;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 12, y + h / 2);
  ctx.textBaseline = "top";
}

function drawBrandMarks(ctx: CanvasRenderingContext2D, rightX: number, topY: number, accent: string) {
  // Right-aligned, two-line wordmarks stacked vertically.
  // Top: "BPS PROVINSI MALUKU UTARA" (mono, ghost)
  // Bottom: "MALIKA" (display, accent)
  ctx.textBaseline = "top";
  ctx.font = `500 11px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.ghost;
  const bps = "BPS PROVINSI MALUKU UTARA";
  const bpsW = ctx.measureText(bps).width;
  ctx.fillText(bps, rightX - bpsW, topY);

  ctx.font = `700 28px ${FONT_DISPLAY}`;
  ctx.fillStyle = accent;
  const mal = "malika";
  const malW = ctx.measureText(mal).width;
  ctx.fillText(mal, rightX - malW, topY + 22);

  // Tiny URL stamp under wordmark
  ctx.font = `400 10px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.ghost;
  const url = "bpsmalut.com / peta-tematik";
  const urlW = ctx.measureText(url).width;
  ctx.fillText(url, rightX - urlW, topY + 60);
}

function drawKpiStrip(
  ctx: CanvasRenderingContext2D,
  opts: {
    accent: string;
    cells: Array<{ label: string; value: string; unit?: string; color: string }>;
  },
) {
  const { cells } = opts;
  const stripTop = HEADER_BAND_BOTTOM;
  const stripH = KPI_BAND_BOTTOM - HEADER_BAND_BOTTOM;
  const innerL = PAD_X;
  const innerR = A3_W - PAD_X;
  const innerW = innerR - innerL;
  const colW = innerW / cells.length;

  ctx.textBaseline = "top";

  cells.forEach((c, i) => {
    const x = innerL + colW * i;
    if (i > 0) {
      vline(ctx, x, stripTop + 24, stripTop + stripH - 24);
    }

    // Label (mono, ghost, uppercase)
    ctx.font = `500 12px ${FONT_MONO}`;
    ctx.fillStyle = COLOR.ghost;
    ctx.fillText(c.label.toUpperCase(), x + 28, stripTop + 32);

    // Big value (display, large, tabular)
    ctx.font = `600 38px ${FONT_DISPLAY}`;
    ctx.fillStyle = c.color;
    ctx.fillText(c.value, x + 28, stripTop + 60);

    // Unit / sub-detail
    if (c.unit) {
      ctx.font = `400 13px ${FONT_MONO}`;
      ctx.fillStyle = COLOR.inkSoft;
      ctx.fillText(c.unit, x + 28, stripTop + 116);
    }
  });

  hairline(ctx, PAD_X, KPI_BAND_BOTTOM, A3_W - PAD_X);
}

function drawMapPanel(
  ctx: CanvasRenderingContext2D,
  mapCanvas: HTMLCanvasElement,
  opts: {
    palette: Palette;
    data: Array<DataPoint & { value: number }>;
    x: number; y: number; mapW: number; h: number; sideW: number;
  },
) {
  const { palette, data, x, y, mapW, h, sideW } = opts;
  const sideX = x + mapW;

  // Map slot — fit-contain on white background
  ctx.fillStyle = COLOR.white;
  ctx.fillRect(x, y, mapW, h);
  const fit = fitContain(mapCanvas.width, mapCanvas.height, mapW, h);
  ctx.drawImage(mapCanvas, x + fit.dx, y + fit.dy, fit.w, fit.h);

  // Single hairline divider between map and side panel
  vline(ctx, sideX, y, y + h);

  // Side panel — soft panel background + rank
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(sideX + 1, y, sideW - 1, h);
  drawSideRank(ctx, {
    x: sideX, y, w: sideW, h, palette, data,
  });

  // Bottom hairline closing the map+rank band
  hairline(ctx, PAD_X, FOOTER_BAND_TOP, A3_W - PAD_X);

  // Legend overlay — bottom-left of map area
  const legW = 540;
  const legH = 86;
  const legX = x + 32;
  const legY = y + h - legH - 32;
  drawLegend(ctx, {
    x: legX, y: legY, w: legW, h: legH, palette, data,
  });
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number; y: number; w: number; h: number;
    palette: Palette;
    data: Array<DataPoint & { value: number }>;
  },
) {
  const { x, y, w, h, palette, data } = opts;
  // White overlay rect with hairline border
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLOR.hairline;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // Heading
  ctx.font = `600 11px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.ghost;
  ctx.textBaseline = "top";
  ctx.fillText(`SKALA · ${palette.label.toUpperCase()} · 5 KELAS`, x + 18, y + 14);

  // Compute 5-bin quantile breaks
  const sorted = [...data].map((d) => d.value).sort((a, b) => a - b);
  const breaks: number[] = [];
  for (let i = 1; i < 5; i++) breaks.push(sorted[Math.floor((i / 5) * sorted.length)] ?? 0);
  const lo = sorted[0] ?? 0;
  const hi = sorted[sorted.length - 1] ?? 0;
  const ticks = [lo, ...breaks, hi];

  // Swatches — 5 stripes filling available width
  const swatchAreaX = x + 18;
  const swatchAreaW = w - 36;
  const swatchH = 14;
  const swatchY = y + 38;
  const segW = swatchAreaW / 5;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = palette.colors[i];
    ctx.fillRect(swatchAreaX + segW * i, swatchY, segW, swatchH);
  }

  // Tick labels — under the segment boundaries (6 ticks for 5 segments)
  ctx.font = `400 10px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.inkSoft;
  const labelY = swatchY + swatchH + 8;
  for (let i = 0; i < ticks.length; i++) {
    const tickX = swatchAreaX + segW * i;
    const text = i === ticks.length - 1 ? `${fmtNumber(ticks[i])}+` : fmtNumber(ticks[i]);
    const tw = ctx.measureText(text).width;
    let lx = tickX - tw / 2;
    if (i === 0) lx = swatchAreaX;
    if (i === ticks.length - 1) lx = swatchAreaX + swatchAreaW - tw;
    ctx.fillText(text, lx, labelY);
  }
}

function drawSideRank(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number; y: number; w: number; h: number;
    palette: Palette;
    data: Array<DataPoint & { value: number }>;
  },
) {
  const { x, y, w, h, palette, data } = opts;
  const padX = 36;
  const padTop = 40;

  // Heading
  ctx.font = `600 22px ${FONT_DISPLAY}`;
  ctx.fillStyle = COLOR.ink;
  ctx.textBaseline = "top";
  ctx.fillText("Peringkat 10 Kab/Kota", x + padX, y + padTop);

  ctx.font = `500 11px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.ghost;
  ctx.fillText("DARI NILAI TERTINGGI", x + padX, y + padTop + 32);

  // Sort + breaks
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value ?? 1;

  const ascValues = [...sorted].map((s) => s.value).sort((a, b) => a - b);
  const breaks: number[] = [];
  for (let i = 1; i < 5; i++) breaks.push(ascValues[Math.floor((i / 5) * ascValues.length)] ?? 0);
  const binIdx = (v: number) => {
    for (let i = 0; i < breaks.length; i++) if (v <= breaks[i]) return i;
    return palette.colors.length - 1;
  };

  // Layout — 10 rows in remaining vertical space
  const listTop = y + padTop + 80;
  const listBottom = y + h - 32;
  const rowH = (listBottom - listTop) / 10;

  // Column geometry — single source of truth so values right-align cleanly.
  const rankColW = 36;
  const valueColW = 130;
  const labelX = x + padX + rankColW + 8;
  const valueRightX = x + w - padX;
  const barX = labelX;
  const barW = valueRightX - barX - valueColW - 12;

  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const ry = listTop + rowH * i;
    const centerY = ry + rowH / 2;

    // Rank number — mono, ghost, right-aligned in its column
    ctx.font = `500 14px ${FONT_MONO}`;
    ctx.fillStyle = COLOR.ghost;
    ctx.textBaseline = "middle";
    const rankText = String(i + 1).padStart(2, "0");
    const rankW = ctx.measureText(rankText).width;
    ctx.fillText(rankText, x + padX + rankColW - rankW, centerY - 8);

    // Name — display, ink
    ctx.font = `500 16px ${FONT_DISPLAY}`;
    ctx.fillStyle = COLOR.ink;
    const cleanName = f.nama_kab.replace(/^(Kabupaten|Kota)\s+/i, "");
    const name = ellipsizeToWidth(ctx, cleanName, barW);
    ctx.fillText(name, labelX, centerY - 8);

    // Bar — track + fill, very thin (4px) so it reads as data, not decoration
    const trackY = centerY + 14;
    ctx.fillStyle = "#eef2f7";
    ctx.fillRect(barX, trackY, barW, 4);
    const pct = max > 0 ? f.value / max : 0;
    ctx.fillStyle = palette.colors[binIdx(f.value)];
    ctx.fillRect(barX, trackY, Math.round(barW * pct), 4);

    // Value — mono, right-aligned at fixed column edge
    ctx.font = `600 15px ${FONT_MONO}`;
    ctx.fillStyle = COLOR.ink;
    ctx.textBaseline = "middle";
    const val = fmtNumber(f.value);
    const vw = ctx.measureText(val).width;
    ctx.fillText(val, valueRightX - vw, centerY - 8);
  }

  ctx.textBaseline = "top";
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  opts: {
    accent: string;
    kategori?: string;
    indikator: number | null;
    today: string;
    legend?: Record<string, string> | null;
    bpsLastUpdate?: string | null;
  },
) {
  const { accent, kategori, indikator, today, legend, bpsLastUpdate } = opts;
  const top = FOOTER_BAND_TOP;
  const padTop = 36;
  const lineY = top + padTop;
  const labelW = 110;

  ctx.textBaseline = "top";

  // Row 1 — SUMBER
  ctx.font = `500 11px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.ghost;
  ctx.fillText("SUMBER", PAD_X, lineY);

  ctx.font = `500 16px ${FONT_DISPLAY}`;
  ctx.fillStyle = COLOR.ink;
  const sourceText = kategori
    ? `Badan Pusat Statistik Provinsi Maluku Utara · ${kategori}`
    : "Badan Pusat Statistik Provinsi Maluku Utara";
  // Truncate to leave room for version stamp on right
  const versionText = "MALIKA · v1.0 · A3 LANDSCAPE";
  ctx.font = `500 11px ${FONT_MONO}`;
  const versionW = ctx.measureText(versionText).width;
  ctx.font = `500 16px ${FONT_DISPLAY}`;
  const sourceMaxW = A3_W - PAD_X * 2 - labelW - versionW - 40;
  ctx.fillText(ellipsizeToWidth(ctx, sourceText, sourceMaxW), PAD_X + labelW, lineY - 2);

  ctx.font = `500 11px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.ghost;
  ctx.fillText(versionText, A3_W - PAD_X - versionW, lineY);

  hairline(ctx, PAD_X, lineY + 46, A3_W - PAD_X);

  // Row 2 — DOKUMEN
  const lineY2 = lineY + 60;
  ctx.font = `500 11px ${FONT_MONO}`;
  ctx.fillStyle = COLOR.ghost;
  ctx.fillText("DOKUMEN", PAD_X, lineY2);

  ctx.font = `500 16px ${FONT_DISPLAY}`;
  ctx.fillStyle = COLOR.ink;
  const docParts: string[] = [];
  docParts.push(`Generated ${today}`);
  if (bpsLastUpdate) {
    const d = new Date(bpsLastUpdate);
    if (Number.isFinite(d.getTime())) {
      docParts.push(`Data BPS: ${d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`);
    }
  }
  if (indikator != null) docParts.push(`INDIKATOR_${indikator}`);
  ctx.fillText(docParts.join("  ·  "), PAD_X + labelW, lineY2 - 2);

  ctx.font = `500 11px ${FONT_MONO}`;
  ctx.fillStyle = accent;
  const urlText = "bpsmalut.com/peta-tematik";
  const urlW = ctx.measureText(urlText).width;
  ctx.fillText(urlText, A3_W - PAD_X - urlW, lineY2);

  // Row 3 — KETERANGAN (footnote legend) — only if BPS provided one
  if (legend && Object.keys(legend).length > 0) {
    hairline(ctx, PAD_X, lineY2 + 46, A3_W - PAD_X);
    const lineY3 = lineY2 + 60;
    ctx.font = `500 11px ${FONT_MONO}`;
    ctx.fillStyle = COLOR.ghost;
    ctx.fillText("KETERANGAN", PAD_X, lineY3);

    // Render the most useful flag entries inline. Skip "...", "–", "NA"
    // (covered universally) and prioritize the meaningful provisional flags.
    const priority = ["r", "e", "*", "**", "***", "~0", "...", "–", "NA"];
    const entries: string[] = [];
    for (const k of priority) {
      if (legend[k]) entries.push(`${k} ${legend[k]}`);
    }
    ctx.font = `500 14px ${FONT_DISPLAY}`;
    ctx.fillStyle = COLOR.inkSoft;
    const text = entries.join("   ·   ");
    const maxW = A3_W - PAD_X * 2 - labelW;
    ctx.fillText(ellipsizeToWidth(ctx, text, maxW), PAD_X + labelW, lineY3 - 2);
  }
}

function trim(s: string | undefined, max: number): string | undefined {
  if (!s) return s;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Re-export type for caller convenience
export { fmtNumber };
