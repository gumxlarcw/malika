"use client";

import React, { useState, useEffect } from "react";
import { MalikaTypingIndicator } from "@/components/chat";

/**
 * Chat helper functions and small presentational components.
 * Extracted from ChatPageClient.tsx for modularity.
 */

// ---------------------------------------------------------------------------
// Pure utilities (no React)
// ---------------------------------------------------------------------------

export function backendBaseUrl() {
  return "/api/chat";
}

export function safeRandomId() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
    if (c?.getRandomValues) {
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    // ignore
  }
  return `uid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateMalikaUid() {
  const key = "malika_uid";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const next = safeRandomId();
    localStorage.setItem(key, next);
    return next;
  } catch {
    return safeRandomId();
  }
}

const MALIKA_TOKEN_KEY = "malika_token";
const TOKEN_RENEW_BEFORE_SECONDS = 30 * 24 * 60 * 60; // renew when < 30 days remain

function decodeTokenExp(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

/**
 * Ensure a signed identity token exists for `uid`. Reuses the stored token while
 * it has > 30 days to live; otherwise mints/renews via POST /api/chat/identity
 * (presenting the existing uid so the same anonymous identity is preserved —
 * legacy adoption). Returns the token, or null if minting failed — callers fall
 * back to the bare uid, which the backend still accepts while STRICT is off.
 */
export async function getOrCreateMalikaToken(uid: string): Promise<string | null> {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(MALIKA_TOKEN_KEY);
  } catch {
    stored = null;
  }
  if (stored) {
    const exp = decodeTokenExp(stored);
    if (exp && exp - Math.floor(Date.now() / 1000) > TOKEN_RENEW_BEFORE_SECONDS) {
      return stored;
    }
  }
  try {
    const res = await fetch(`${backendBaseUrl()}/identity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(stored ? { "x-malika-token": stored } : {}),
      },
      body: JSON.stringify({ uid }),
    });
    if (!res.ok) return stored;
    const json = await res.json();
    if (json?.token) {
      try {
        localStorage.setItem(MALIKA_TOKEN_KEY, json.token);
        if (json.uid) localStorage.setItem("malika_uid", json.uid);
      } catch {
        /* ignore persistence failure; token still returned for this session */
      }
      return json.token as string;
    }
    return stored;
  } catch {
    return stored;
  }
}

// Search history helpers
const SEARCH_HISTORY_KEY = "malika_search_history";
const MAX_SEARCH_HISTORY = 10;

export function getSearchHistory(): string[] {
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SEARCH_HISTORY) : [];
  } catch {
    return [];
  }
}

export function addToSearchHistory(query: string) {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 3) return;
  try {
    const history = getSearchHistory();
    const filtered = history.filter(h => h.toLowerCase() !== trimmed.toLowerCase());
    const updated = [trimmed, ...filtered].slice(0, MAX_SEARCH_HISTORY);
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
    } catch {
      // QuotaExceededError — trim to half and retry once
      const halved = updated.slice(0, Math.ceil(MAX_SEARCH_HISTORY / 2));
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(halved)); } catch { /* give up */ }
    }
  } catch {
    // ignore parse errors
  }
}

/** Indonesian locale overrides for assistant-ui */
export function IndonesianChatLocales() {
  return {
    "id-ID": {
      BackBottom: {
        newMsgOne: "{n} pesan baru",
        newMsgOther: "{n} pesan baru",
        bottom: "Kembali ke bawah",
      },
      Time: {
        weekdays: "Minggu_Senin_Selasa_Rabu_Kamis_Jumat_Sabtu".split("_"),
        formats: {
          LT: "HH:mm",
          lll: "HH:mm",
          WT: "HH:mm",
          YT: "HH:mm",
        },
      },
      Composer: { send: "Kirim" },
      SendConfirm: { title: "Kirim gambar", send: "Kirim", cancel: "Batal" },
      RateActions: { up: "Setuju", down: "Tidak setuju" },
      Recorder: {
        hold2talk: "Tahan untuk bicara",
        release2send: "Lepas untuk kirim",
        releaseOrSwipe: "Lepas untuk kirim, geser ke atas untuk batal",
        release2cancel: "Lepas untuk batal",
      },
      Search: { search: "Cari" },
    },
  };
}

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------

/**
 * Render text with lightweight markdown support.
 * Handles: [label](url), plain URLs, **bold**, *italic*, `code`, line breaks,
 * numbered lists (1. ...), bulleted lists (- ..., • ...),
 * headings (# ## ###), fenced code blocks (```), pipe tables (| col | col |).
 */
export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  // Split into lines for block-level parsing (lists vs paragraphs)
  const lines = text.split("\n");

  const blocks: React.ReactNode[] = [];
  let blockKey = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Detect fenced code block: ```lang ... ```
    if (line.trimStart().startsWith("```")) {
      const langMatch = line.trimStart().match(/^```(\w*)/);
      const lang = langMatch?.[1] || "";
      const codeLines: string[] = [];
      i++; // move past opening fence
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // move past closing fence
      blocks.push(
        <div key={blockKey++} className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
          {lang && (
            <div className="bg-gray-100 dark:bg-gray-800 px-3 py-1 text-[10px] font-mono text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              {lang}
            </div>
          )}
          <pre className="bg-gray-50 dark:bg-gray-900 px-3 py-2 overflow-x-auto text-[13px] leading-relaxed">
            <code className="font-mono text-gray-800 dark:text-gray-200">{codeLines.join("\n")}</code>
          </pre>
        </div>
      );
      continue;
    }

    // Detect heading: # Heading, ## Heading, ### Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length; // 1, 2, or 3
      const headingText = headingMatch[2];
      const headingClasses = [
        "", // unused index 0
        "text-lg font-bold text-gray-900 dark:text-white mt-3 mb-1.5", // h1 → rendered as h2
        "text-base font-semibold text-gray-800 dark:text-gray-100 mt-2.5 mb-1", // h2 → h3
        "text-sm font-semibold text-gray-700 dark:text-gray-200 mt-2 mb-0.5", // h3 → h4
      ];
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      blocks.push(
        <Tag key={blockKey++} className={headingClasses[level]}>
          {renderInline(headingText)}
        </Tag>
      );
      i++;
      continue;
    }

    // Detect pipe table: | col | col | (at least a header + separator row)
    if (line.includes("|") && line.trim().startsWith("|") && i + 1 < lines.length && lines[i + 1].match(/^\|[\s:|-]+\|/)) {
      const tableRows: string[][] = [];
      // Parse header
      const headerCells = parsePipeRow(line);
      tableRows.push(headerCells);
      i++; // skip header
      i++; // skip separator (---|--- row)
      // Parse body rows
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableRows.push(parsePipeRow(lines[i]));
        i++;
      }
      const headers = tableRows[0];
      const bodyRows = tableRows.slice(1);
      blocks.push(
        <div key={blockKey++} className="my-2 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800">
                {headers.map((h, ci) => (
                  <th key={ci} className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 1 ? "bg-gray-50/50 dark:bg-gray-800/30" : ""}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Detect numbered list item: "1. something", "2) something"
    const olMatch = line.match(/^(\d+)[.)]\s+(.+)/);
    if (olMatch) {
      const items: React.ReactNode[] = [];
      let firstNum = parseInt(olMatch[1], 10) || 1;
      while (i < lines.length) {
        const m = lines[i].match(/^(\d+)[.)]\s+(.+)/);
        if (!m) {
          // Allow single blank lines within a numbered list (AI models
          // sometimes insert blank lines between items).  Peek ahead: if
          // the next non-empty line is also a numbered item, skip the gap.
          if (!lines[i].trim() && i + 1 < lines.length && lines[i + 1].match(/^(\d+)[.)]\s+(.+)/)) {
            i++; // skip blank line
            continue;
          }
          break;
        }
        items.push(<li key={i}>{renderInline(m[2])}</li>);
        i++;
      }
      blocks.push(
        <ol key={blockKey++} className="malika-list-ol my-1.5 space-y-0.5"
            style={firstNum !== 1 ? { counterReset: `malika-ol ${firstNum - 1}` } : undefined}>
          {items}
        </ol>
      );
      continue;
    }

    // Detect bulleted list item: "- something", "• something", "* something" (but not **bold**)
    const ulMatch = line.match(/^[-•]\s+(.+)/) || line.match(/^\*\s+(?!\*)(.+)/);
    if (ulMatch) {
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^[-•]\s+(.+)/) || lines[i].match(/^\*\s+(?!\*)(.+)/);
        if (!m) {
          // Allow single blank lines within a bulleted list
          if (!lines[i].trim() && i + 1 < lines.length && (lines[i + 1].match(/^[-•]\s+(.+)/) || lines[i + 1].match(/^\*\s+(?!\*)(.+)/))) {
            i++; // skip blank line
            continue;
          }
          break;
        }
        items.push(<li key={i}>{renderInline(m[1])}</li>);
        i++;
      }
      blocks.push(
        <ul key={blockKey++} className="malika-list-ul my-1.5 space-y-0.5">
          {items}
        </ul>
      );
      continue;
    }

    // Empty line — spacer
    if (!line.trim()) {
      // Skip consecutive empty lines (just add one spacer)
      while (i < lines.length && !lines[i].trim()) i++;
      blocks.push(<div key={blockKey++} className="h-1.5" />);
      continue;
    }

    // Regular paragraph line — collect consecutive non-list, non-empty lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].match(/^(#{1,3})\s+/) && !lines[i].match(/^(\d+)[.)]\s+/) && !lines[i].match(/^[-•]\s+/) && !(lines[i].match(/^\*\s+(?!\*)/)) && !lines[i].trimStart().startsWith("```") && !(lines[i].includes("|") && lines[i].trim().startsWith("|") && i + 1 < lines.length && lines[i + 1]?.match(/^\|[\s:|-]+\|/))) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={blockKey++} className="my-0.5">
        {renderInline(paraLines.join("\n"))}
      </p>
    );
  }

  return blocks;
}

/** Parse a pipe table row: | cell1 | cell2 | → ["cell1", "cell2"] */
function parsePipeRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Sanitize href — only allow safe protocols */
function safeHref(url: string): string {
  const trimmed = url.trim();
  // Allow http, https, mailto, tel — block javascript:, data:, vbscript:, etc.
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed) || /^tel:/i.test(trimmed)) {
    return trimmed;
  }
  // Relative URLs (starting with /) are safe
  if (trimmed.startsWith("/")) return trimmed;
  // Block everything else (javascript:, data:, vbscript:, etc.)
  return "#";
}

/** Render inline markdown within a single paragraph */
function renderInline(text: string): React.ReactNode {
  if (!text) return null;

  // Combined regex for inline patterns (order matters):
  // 1. [label](url)  2. **bold**  3. *italic*  4. `code`
  // 5. plain URLs  6. phone numbers (+62/08/62 prefix)  7. newline
  const pattern =
    /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|(?<!\*)\*([^*]+)\*(?!\*)|`([^`]+)`|(https?:\/\/[^\s<>"'\]\)]+)|(?<!\d)(\+62|62|08)[\s\-.]?(\d{2,4})[\s\-.]?(\d{2,4})[\s\-.]?(\d{2,6})(?!\d)|(\n)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Markdown link [label](url) — sanitize href to block javascript: etc.
      const href = safeHref(match[2]);
      parts.push(
        <a key={key++} href={href} target="_blank" rel="noopener noreferrer"
           className="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 underline">
          {match[1]}
        </a>
      );
    } else if (match[3] !== undefined) {
      // Bold **text**
      parts.push(<strong key={key++} className="font-semibold">{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      // Italic *text*
      parts.push(<em key={key++}>{match[4]}</em>);
    } else if (match[5] !== undefined) {
      // Inline code `text`
      parts.push(
        <code key={key++} className="rounded bg-gray-200 px-1 py-0.5 text-[0.85em] font-mono dark:bg-gray-700">
          {match[5]}
        </code>
      );
    } else if (match[6] !== undefined) {
      // Plain URL
      parts.push(
        <a key={key++} href={match[6]} target="_blank" rel="noopener noreferrer"
           className="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 underline break-all">
          {match[6].length > 60 ? match[6].slice(0, 57) + "\u2026" : match[6]}
        </a>
      );
    } else if (match[7] !== undefined && match[8] !== undefined) {
      // Indonesian phone number — link to WhatsApp
      const raw = match[0].replace(/[\s\-.]/g, "");
      const digits = raw.startsWith("+") ? raw.slice(1) : raw.startsWith("0") ? "62" + raw.slice(1) : raw;
      const waUrl = `https://wa.me/${digits}`;
      parts.push(
        <a key={key++} href={waUrl} target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 underline">
          <svg className="h-3.5 w-3.5 inline-block" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          {match[0]}
        </a>
      );
    } else if (match[11] !== undefined) {
      // Single newline → <br/>
      parts.push(<br key={key++} />);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function BubbleText({ content }: { content: string }) {
  return (
    <div className="Bubble text">
      {renderMarkdown(content)}
    </div>
  );
}

/** Typing indicator wrapper with optional status text */
export function TypingIndicator({ status }: { status?: string }) {
  return (
    <div className="flex items-center gap-2">
      <MalikaTypingIndicator />
      {status && (
        <span className="text-xs text-gray-500 dark:text-gray-400 animate-pulse">
          {status}
        </span>
      )}
    </div>
  );
}

/** Streaming text that types out character by character */
export function TypingText({
  content,
  options,
}: {
  content: string;
  options?: { interval?: number; step?: number };
}) {
  const interval = options?.interval ?? 14;
  const step = options?.step ?? 1;
  const [index, setIndex] = useState(() => Math.min(5, content.length));

  useEffect(() => {
    setIndex(Math.min(5, content.length));
  }, [content]);

  useEffect(() => {
    if (index >= content.length) return;
    const t = window.setTimeout(() => {
      setIndex((i) => Math.min(content.length, i + Math.max(1, step)));
    }, interval);
    return () => window.clearTimeout(t);
  }, [content.length, index, interval, step]);

  return (
    <div className="Bubble richtext" data-effect={index < content.length ? "typing" : undefined}>
      <div>
        {renderMarkdown(content.slice(0, index))}
      </div>
    </div>
  );
}
