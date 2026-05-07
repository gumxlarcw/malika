/**
 * Chat utility functions
 * Extracted from ChatPageClient.tsx for reusability
 */

import type { ChatMessageType, ChatUiMessage, MalikaUiMetaV1 } from "@/types/chat";

/**
 * Get the start of day in milliseconds for a timestamp
 */
export function toDayStartMs(ts: number): number {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return Date.now();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Format timestamp as full Indonesian date (e.g., "13 Januari 2026")
 */
export function fmtFullDateId(ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Format timestamp as short time (e.g., "14:30")
 */
export function fmtShortTime(ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Format ISO date string as short date (e.g., "13 Jan 2026")
 */
export function fmtShortDateIso(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Decode basic HTML entities
 */
export function decodeBasicEntities(input: string): string {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

/**
 * Sanitize text - remove HTML, fix mojibake, normalize whitespace
 * Shared with BRSCard/PublikasiCard
 */
export function sanitizeText(
  input: string,
  opts?: { preserveNewlines?: boolean }
): string {
  let text = String(input || "");
  const preserveNewlines = opts?.preserveNewlines === true;

  // Decode entities first so encoded tags like &lt;li&gt; can be removed.
  text = decodeBasicEntities(text);

  // Preserve intended line breaks before stripping tags.
  text = text.replace(/<\s*br\s*\/?>/gi, "\n");
  text = text.replace(/<\s*\/\s*(p|div|li|ul|ol|h\d)\s*>/gi, "\n");

  // Strip HTML tags early (API sometimes returns rich text)
  text = text.replace(/<[^>]+>/g, " ");

  // Heuristic mojibake fix for UTF-8 interpreted as Latin-1/Win1252.
  if (/[ÃÂâ€]/.test(text)) {
    try {
      const bytes = new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (decoded && decoded !== text && !decoded.includes("\uFFFD")) {
        text = decoded;
      }
    } catch {
      // ignore
    }
  }

  // Remove control chars and normalize whitespace
  if (preserveNewlines) {
    text = text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ");
    text = text.replace(/\n\s+/g, "\n");
    text = text.replace(/[ \t\f\v]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    text = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  } else {
    text = text.replace(/[\u0000-\u001F\u007F]/g, " ");
    text = text.replace(/\s+/g, " ").trim();
  }

  return text;
}

/**
 * Parse abstract into bullet points
 * Shared with BRSCard/PublikasiCard
 */
export function parseAbstractBullets(abstract?: string): string[] {
  const text = sanitizeText(abstract || "", { preserveNewlines: true });
  if (!text) return [];

  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const bulletPrefix =
    /^[\u25A0\u25AA\u25CF\u25D8\u2022\u25E6\u25FE\u25AA\-–—*]+\s*/;
  const hasBullets = rawLines.some((l) => bulletPrefix.test(l));
  if (hasBullets) {
    return rawLines
      .map((l) => l.replace(bulletPrefix, "").trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  if (rawLines.length > 1) {
    return rawLines.slice(0, 6);
  }

  // Fallback: split into sentences
  return text
    .split(/;|\.(?:\s+|$)/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Format cell value for display in data tables
 */
export function formatCellValue(v: any, columnName?: string): string {
  if (v == null) return "-";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "-";
    // Don't format years (4-digit numbers in valid year range, or column named "Tahun")
    const isYearColumn = columnName?.toLowerCase() === "tahun";
    const isLikelyYear = Number.isInteger(v) && v >= 1900 && v <= 2100;
    if (isYearColumn || isLikelyYear) {
      return String(v);
    }
    // Format numbers with thousand separator
    return v.toLocaleString("id-ID");
  }
  const s = String(v).trim();
  return s || "-";
}

/**
 * Normalize a message object to ChatUiMessage format
 */
export function normalizeChatUiMessage(
  m: any,
  fallbackId?: string
): ChatUiMessage {
  const createdAtRaw = Number(m?.createdAt ?? Date.now());
  const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
  const _id = String(
    m?._id || fallbackId || Math.random().toString(36).slice(2)
  );
  return {
    _id,
    type: (m?.type || "text") as ChatMessageType,
    content: m?.content ?? {},
    position: m?.position || "left",
    createdAt,
    hasTime: m?.hasTime,
  };
}

/**
 * Convert assistant text to compact form for display
 */
export function toCompactAssistantText(textRaw: string): string {
  const text = String(textRaw || "").trim();
  if (!text) return "";

  // Keep it compact so it complements (not duplicates) the preview panel.
  const lines = text.replace(/\n{3,}/g, "\n\n").split("\n");
  const clippedLines = lines.length > 6 ? lines.slice(0, 6) : lines;
  let out = clippedLines.join("\n").trim();

  const maxLen = 420;
  if (out.length > maxLen) {
    out = out
      .slice(0, maxLen)
      .replace(/\s+\S*$/, "")
      .trim() + "…";
  }
  return out;
}

/**
 * Extract MALIKA_UI block from assistant content.
 * Supports both HTML comment format <!--MALIKA_UI:{json}--> and markdown code block format ```malika_ui {json}```
 */
export function extractMalikaUiBlock(content: string): {
  text: string;
  ui: MalikaUiMetaV1 | null;
} {
  const text = String(content || "");
  
  // Try markdown code block format first: ```malika_ui {...} ```
  const mdMatch = text.match(/```\s*malika_ui\s*([\s\S]*?)```/i);
  if (mdMatch) {
    const jsonPart = String(mdMatch[1] || "").trim();
    const cleaned = text.replace(mdMatch[0], "").replace(/\n{3,}/g, "\n\n").trim();
    try {
      const parsed = JSON.parse(jsonPart);
      if (parsed && parsed.v === 1) {
        return { text: cleaned, ui: parsed as MalikaUiMetaV1 };
      }
    } catch {
      // ignore parse errors; fall through to HTML comment format
    }
  }
  
  // Try HTML comment format: <!--MALIKA_UI:{json}-->
  const markerStart = "<!--MALIKA_UI:";
  const markerEnd = "-->";
  
  const startIdx = text.indexOf(markerStart);
  if (startIdx === -1) {
    return { text: text.trim(), ui: null };
  }
  
  const jsonStart = startIdx + markerStart.length;
  const endIdx = text.indexOf(markerEnd, jsonStart);
  if (endIdx === -1) {
    return { text: text.trim(), ui: null };
  }
  
  const jsonStr = text.slice(jsonStart, endIdx).trim();
  const textBefore = text.slice(0, startIdx).trim();
  const textAfter = text.slice(endIdx + markerEnd.length).trim();
  const cleanedText = [textBefore, textAfter].filter(Boolean).join("\n\n");
  
  try {
    const ui = JSON.parse(jsonStr);
    return { text: cleanedText, ui };
  } catch {
    return { text: text.trim(), ui: null };
  }
}

/**
 * Format Indonesian month names
 */
export const BULAN_INDO = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

/**
 * Format date string (YYYY-MM-DD) to Indonesian format
 */
export function formatDateIndo(dateStr: string): string | null {
  if (!dateStr) return null;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [tahun, bulan, tanggal] = parts;
  const monthIndex = Number.parseInt(bulan, 10) - 1;
  const day = Number.parseInt(tanggal, 10);
  if (Number.isNaN(day) || monthIndex < 0 || monthIndex > 11) return dateStr;
  return `${day} ${BULAN_INDO[monthIndex]} ${tahun}`;
}

/**
 * Validate and sanitize href for security
 */
export function safeHref(hrefRaw: unknown): string {
  const href = String(hrefRaw || "").trim();
  if (!href) return "";
  if (href.startsWith("/")) return href;
  try {
    const u = new URL(href);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {
    // ignore
  }
  return "";
}

/**
 * Strip "Sumber:" references and phone/WhatsApp numbers from assistant text.
 * These are moved to the second bubble (DataSummaryBubble) for cleaner separation.
 *
 * Removes:
 * - Lines starting with "Sumber:" / "Sumber :" / "*Sumber:*" / "**Sumber:**"
 * - Inline WhatsApp links: [+62 851-7676-4422](https://wa.me/...)
 * - Sentences containing "hubungi BPS" + WhatsApp references
 * - Lines that are ONLY a WhatsApp link/number
 *
 * Preserves:
 * - "Sumber" used in normal context (e.g., "sumber daya", "sumber data")
 * - Phone numbers that are part of data (not contact info)
 */
export function cleanAssistantBubbleText(text: string): string {
  if (!text) return text;

  let cleaned = text;

  // 1. Remove "Sumber:" citation lines (at start of line or after newline)
  //    Matches: "Sumber: ...", "*Sumber: ...*", "**Sumber: ...**", "(Sumber: ...)"
  //    Captures the entire line until the next newline
  cleaned = cleaned.replace(
    /^[\s]*(?:\*{0,2}|\()?Sumber\s*:\s*.+?(?:\*{0,2}|\))?$/gim,
    "",
  );

  // 2. Remove "[Sumber: ...]" bracketed references inline
  cleaned = cleaned.replace(/\[Sumber:\s*[^\]]+\]/gi, "");

  // 3. Remove WhatsApp contact sentences 
  //    "Untuk konfirmasi lebih lanjut, silakan hubungi BPS Maluku Utara via WhatsApp di [...]"
  //    "...hubungi BPS Maluku Utara via WhatsApp di +62 851-7676-4422"
  cleaned = cleaned.replace(
    /(?:untuk\s+(?:konfirmasi|informasi|bantuan)[^.]*?)?(?:silakan\s+)?hubungi\s+BPS\s+Maluku\s+Utara\s+via\s+WhatsApp[^.\n]*[.\n]?/gi,
    "",
  );

  // 4. Remove standalone WhatsApp link lines
  //    Lines that are just a WhatsApp number/link
  cleaned = cleaned.replace(
    /^[\s]*\[?\+?62[\s\-]?851[\s\-]?7676[\s\-]?4422\]?\s*(?:\(https?:\/\/wa\.me\/[^)]+\))?\s*$/gim,
    "",
  );

  // 5. Remove markdown-linked WhatsApp numbers: [+62 851-7676-4422](https://wa.me/...)
  cleaned = cleaned.replace(
    /\[?\+?62[\s\-]?851[\s\-]?7676[\s\-]?4422\]?\s*\(https?:\/\/wa\.me\/[^)]+\)/g,
    "",
  );

  // 6. Remove standalone "WhatsApp di ..." fragments left after cleanup
  cleaned = cleaned.replace(/WhatsApp\s+di\s*\.?\s*$/gim, "");

  // 7. Clean up resulting double/triple newlines and trailing whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // 8. Remove trailing sentence fragments like "silakan hubungi ." or "via ."
  cleaned = cleaned.replace(/(?:silakan|via)\s*\.?\s*$/im, "").trim();

  return cleaned;
}
