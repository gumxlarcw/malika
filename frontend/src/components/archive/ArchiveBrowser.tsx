"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import "./archive.css";

type Kind = "all" | "report" | "publication";

type ArchiveItem = {
  kind: "report" | "publication";
  id: string;
  rawId: string | number;
  title: string;
  abstract?: string;
  rl_date?: string;
  cover?: string;
  pdf?: string;
  pages?: number;
  hue: number;
  label: string;
  eyebrow: string;
};

type BpsListMeta = {
  page: number;
  pages: number;
  per_page: number;
  count: number;
  total: number;
};

type BrsRaw = {
  brs_id: number;
  title: string;
  abstract?: string;
  rl_date?: string;
  pdf?: string;
  thumbnail?: string;
};

type PubRaw = {
  pub_id: string;
  title: string;
  abstract?: string;
  rl_date?: string;
  cover?: string;
  pdf?: string;
  size?: string;
};

const MONTHS_ID = [
  "Januari","Februari","Maret","April","Mei","Juni",
  "Juli","Agustus","September","Oktober","November","Desember",
];
const MONTHS_SHORT_EN = [
  "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
];

function formatDate(iso?: string): string {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts;
    const monthIdx = Number.parseInt(m, 10) - 1;
    const day = Number.parseInt(d, 10);
    if (!Number.isNaN(day) && monthIdx >= 0 && monthIdx < 12) {
      return `${String(day).padStart(2, "0")} ${MONTHS_SHORT_EN[monthIdx]} ${y}`;
    }
  }
  return iso;
}

function formatDateLong(iso?: string): string {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts;
    const monthIdx = Number.parseInt(m, 10) - 1;
    const day = Number.parseInt(d, 10);
    if (!Number.isNaN(day) && monthIdx >= 0 && monthIdx < 12) {
      return `${day} ${MONTHS_ID[monthIdx]} ${y}`;
    }
  }
  return iso;
}

function decodeBasicEntities(input: string): string {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function sanitizeText(input?: string, opts?: { preserveNewlines?: boolean }): string {
  let text = String(input || "");
  if (!text) return "";
  const preserveNewlines = opts?.preserveNewlines === true;

  text = decodeBasicEntities(text);
  text = text.replace(/<\s*br\s*\/?>/gi, "\n");
  text = text.replace(/<\s*\/\s*(p|div|li|ul|ol|h\d)\s*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  if (/[ÃÂâ€]/.test(text)) {
    try {
      const bytes = new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (decoded && decoded !== text && !decoded.includes("�")) {
        text = decoded;
      }
    } catch {
      // ignore
    }
  }

  if (preserveNewlines) {
    text = text.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, " ");
    text = text.replace(/\n\s+/g, "\n");
    text = text.replace(/[ \t\f\v]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    text = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  } else {
    text = text.replace(/[\x00-\x1F\x7F]/g, " ");
    text = text.replace(/\s+/g, " ").trim();
  }

  return text;
}

function parseBullets(raw?: string, max = 8): string[] {
  const s = sanitizeText(raw, { preserveNewlines: true });
  if (!s) return [];
  const bulletRe = /^[\s]*[■▪●◘•◦◾–—\-*]\s+/;
  const lines = s.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  let bullets: string[] = [];
  if (lines.some((l) => bulletRe.test(l))) {
    bullets = lines.filter((l) => bulletRe.test(l)).map((l) => l.replace(bulletRe, ""));
  } else if (lines.length > 1) {
    bullets = lines;
  } else {
    bullets = s.split(/;\s+|\.\s+(?=[A-Z0-9])/).map((p) => p.trim()).filter(Boolean);
  }
  return bullets.slice(0, max);
}

function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function labelFromTitle(title: string): string {
  const cleaned = sanitizeText(title).replace(/[^A-Za-zÀ-ɏ]/g, " ").trim();
  if (!cleaned) return "—";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function brsToItem(b: BrsRaw): ArchiveItem {
  const id = `BRS-${b.brs_id}`;
  return {
    kind: "report",
    id,
    rawId: b.brs_id,
    title: sanitizeText(b.title),
    abstract: b.abstract,
    rl_date: b.rl_date,
    cover: b.thumbnail || undefined,
    pdf: b.pdf || undefined,
    hue: hueFromString(id),
    label: labelFromTitle(b.title),
    eyebrow: "Statistical Report",
  };
}

function pubToItem(p: PubRaw): ArchiveItem {
  const id = `PUB-${p.pub_id}`;
  return {
    kind: "publication",
    id,
    rawId: p.pub_id,
    title: sanitizeText(p.title),
    abstract: p.abstract,
    rl_date: p.rl_date,
    cover: p.cover || undefined,
    pdf: p.pdf || undefined,
    hue: hueFromString(id),
    label: labelFromTitle(p.title),
    eyebrow: "Publication",
  };
}

const BPS_API_KEY =
  process.env.NEXT_PUBLIC_BPS_API_KEY || "e5d1be11320576d466bdeb2f7f210387";
const BPS_DOMAIN = "8200";

function buildBrsListUrl(opts: { page: number; keyword?: string; year?: string }) {
  let url = `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/${BPS_DOMAIN}/page/${opts.page}`;
  if (opts.keyword?.trim()) url += `/keyword/${encodeURIComponent(opts.keyword.trim())}`;
  if (opts.year) url += `/year/${opts.year}`;
  url += `/key/${BPS_API_KEY}/`;
  return url;
}

function buildPubListUrl(opts: { page: number; keyword?: string; year?: string }) {
  const params = new URLSearchParams();
  params.set("page", String(opts.page));
  if (opts.keyword?.trim()) params.set("keyword", opts.keyword.trim());
  if (opts.year) params.set("year", opts.year);
  return `/api/publikasi?${params.toString()}`;
}

function getYearOptions(): string[] {
  const cur = new Date().getFullYear();
  const ys: string[] = [];
  for (let y = cur; y >= 2020; y--) ys.push(String(y));
  return ys;
}

export interface ArchiveBrowserProps {
  defaultKind: Kind;
}

export default function ArchiveBrowser({ defaultKind }: ArchiveBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialKind = useMemo<Kind>(() => {
    const k = searchParams?.get("kind") as Kind | null;
    if (k === "all" || k === "report" || k === "publication") return k;
    return defaultKind;
  }, [defaultKind, searchParams]);

  const [kind, setKind] = useState<Kind>(initialKind);
  const [query, setQuery] = useState<string>(() => searchParams?.get("keyword") || "");
  const [year, setYear] = useState<string>(() => searchParams?.get("year") || "");
  const [page, setPage] = useState<number>(1);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [meta, setMeta] = useState<BpsListMeta | null>(null);
  const [active, setActive] = useState<ArchiveItem | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedForIdRef = useRef<string | null>(null);

  const yearOptions = useMemo(() => getYearOptions(), []);

  const pushUrl = useCallback(
    (next: { kind?: Kind; keyword?: string; year?: string; id?: string | null }) => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      if (next.kind !== undefined) {
        if (next.kind === defaultKind) params.delete("kind");
        else params.set("kind", next.kind);
      }
      if (next.keyword !== undefined) {
        if (next.keyword.trim()) params.set("keyword", next.keyword.trim());
        else params.delete("keyword");
      }
      if (next.year !== undefined) {
        if (next.year) params.set("year", next.year);
        else params.delete("year");
      }
      if (next.id !== undefined) {
        params.delete("brs_id");
        params.delete("pub_id");
        if (next.id) {
          if (next.id.startsWith("BRS-")) params.set("brs_id", next.id.slice(4));
          else if (next.id.startsWith("PUB-")) params.set("pub_id", next.id.slice(4));
        }
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [defaultKind, pathname, router, searchParams],
  );

  const handleKindChange = useCallback(
    (k: Kind) => {
      setKind(k);
      setPage(1);
      pushUrl({ kind: k });
    },
    [pushUrl],
  );

  const handleSearchChange = useCallback(
    (v: string) => {
      setQuery(v);
      setPage(1);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        pushUrl({ keyword: v });
      }, 500);
    },
    [pushUrl],
  );

  const handleYearChange = useCallback(
    (v: string) => {
      const next = v === "all" ? "" : v;
      setYear(next);
      setPage(1);
      pushUrl({ year: next });
    },
    [pushUrl],
  );

  // ── Data fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setStatus("loading");
      try {
        if (kind === "all") {
          const [brsRes, pubRes] = await Promise.all([
            fetch(buildBrsListUrl({ page: 1, keyword: query, year }), {
              signal: controller.signal,
              cache: "no-store",
            }).then((r) => r.json()).catch(() => null),
            fetch(buildPubListUrl({ page: 1, keyword: query, year }), {
              signal: controller.signal,
              cache: "no-store",
            }).then((r) => r.json()).catch(() => null),
          ]);

          const brsItems: ArchiveItem[] = Array.isArray(brsRes?.data?.[1])
            ? (brsRes.data[1] as BrsRaw[]).map(brsToItem)
            : [];
          const pubItems: ArchiveItem[] = Array.isArray(pubRes?.items)
            ? (pubRes.items as PubRaw[]).map(pubToItem)
            : [];

          const merged = [...brsItems, ...pubItems].sort((a, b) => {
            const da = Date.parse(a.rl_date || "") || 0;
            const db = Date.parse(b.rl_date || "") || 0;
            return db - da;
          });

          if (controller.signal.aborted) return;
          setItems(merged);
          setMeta(null);
          setStatus("ready");
          return;
        }

        if (kind === "report") {
          const res = await fetch(buildBrsListUrl({ page, keyword: query, year }), {
            signal: controller.signal,
            cache: "no-store",
          });
          const raw = (await res.json()) as { data?: [BpsListMeta, BrsRaw[]] };
          if (controller.signal.aborted) return;
          const m = (raw?.data?.[0] || null) as BpsListMeta | null;
          const list = Array.isArray(raw?.data?.[1]) ? raw.data![1].map(brsToItem) : [];
          setMeta(m);
          setItems(list);
          setStatus("ready");
          return;
        }

        // kind === "publication"
        const res = await fetch(buildPubListUrl({ page, keyword: query, year }), {
          signal: controller.signal,
          cache: "no-store",
        });
        const raw = (await res.json()) as { meta?: BpsListMeta | null; items?: PubRaw[] };
        if (controller.signal.aborted) return;
        setMeta((raw?.meta || null) as BpsListMeta | null);
        setItems(Array.isArray(raw?.items) ? raw.items.map(pubToItem) : []);
        setStatus("ready");
      } catch {
        if (controller.signal.aborted) return;
        setStatus("error");
      }
    };

    load();
    return () => controller.abort();
  }, [kind, query, year, page]);

  // ── Deep-link to a single item ──────────────────────────────────────
  const deepLinkId = useMemo<string | null>(() => {
    const b = searchParams?.get("brs_id");
    if (b) return `BRS-${b}`;
    const p = searchParams?.get("pub_id");
    if (p) return `PUB-${p}`;
    return null;
  }, [searchParams]);

  useEffect(() => {
    openedForIdRef.current = null;
  }, [deepLinkId]);

  useEffect(() => {
    if (!deepLinkId) return;
    if (openedForIdRef.current === deepLinkId) return;
    if (active?.id === deepLinkId) {
      openedForIdRef.current = deepLinkId;
      return;
    }
    const inList = items.find((it) => it.id === deepLinkId);
    if (inList) {
      openedForIdRef.current = deepLinkId;
      queueMicrotask(() => setActive(inList));
      return;
    }

    const controller = new AbortController();
    const fetchOne = async () => {
      try {
        if (deepLinkId.startsWith("BRS-")) {
          const id = deepLinkId.slice(4);
          const url = `https://webapi.bps.go.id/v1/api/view/domain/${BPS_DOMAIN}/model/pressrelease/lang/ind/id/${id}/key/${BPS_API_KEY}/`;
          const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
          const raw = (await res.json()) as { data?: Record<string, unknown> };
          const d = raw?.data && typeof raw.data === "object" ? raw.data : null;
          if (!d) return;
          const mapped = brsToItem({
            brs_id: Number(id),
            title: String((d as Record<string, unknown>).title || ""),
            abstract: (d as Record<string, unknown>).abstract != null ? String((d as Record<string, unknown>).abstract) : undefined,
            rl_date: (d as Record<string, unknown>).rl_date != null ? String((d as Record<string, unknown>).rl_date) : undefined,
            pdf: (d as Record<string, unknown>).pdf != null ? String((d as Record<string, unknown>).pdf) : undefined,
            thumbnail: (d as Record<string, unknown>).thumbnail != null ? String((d as Record<string, unknown>).thumbnail) : undefined,
          });
          if (controller.signal.aborted) return;
          if (openedForIdRef.current === deepLinkId) return;
          if (mapped.title || mapped.pdf) {
            openedForIdRef.current = deepLinkId;
            setActive(mapped);
          }
          return;
        }
        if (deepLinkId.startsWith("PUB-")) {
          const id = deepLinkId.slice(4);
          const url = `https://webapi.bps.go.id/v1/api/view/domain/${BPS_DOMAIN}/model/publication/lang/ind/id/${encodeURIComponent(id)}/key/${BPS_API_KEY}/`;
          const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
          const raw = (await res.json()) as { data?: Record<string, unknown> };
          const d = raw?.data && typeof raw.data === "object" ? raw.data : null;
          if (!d) return;
          const mapped = pubToItem({
            pub_id: id,
            title: String((d as Record<string, unknown>).title || ""),
            abstract: (d as Record<string, unknown>).abstract != null ? String((d as Record<string, unknown>).abstract) : undefined,
            rl_date: (d as Record<string, unknown>).rl_date != null ? String((d as Record<string, unknown>).rl_date) : undefined,
            cover: (d as Record<string, unknown>).cover != null ? String((d as Record<string, unknown>).cover) : undefined,
            pdf: (d as Record<string, unknown>).pdf != null ? String((d as Record<string, unknown>).pdf) : undefined,
          });
          if (controller.signal.aborted) return;
          if (openedForIdRef.current === deepLinkId) return;
          if (mapped.title || mapped.pdf) {
            openedForIdRef.current = deepLinkId;
            setActive(mapped);
          }
        }
      } catch {
        // best-effort
      }
    };
    fetchOne();
    return () => controller.abort();
  }, [deepLinkId, items, active?.id]);

  const openItem = useCallback(
    (it: ArchiveItem) => {
      setActive(it);
      pushUrl({ id: it.id });
    },
    [pushUrl],
  );

  const closePreview = useCallback(() => {
    setActive(null);
    pushUrl({ id: null });
  }, [pushUrl]);

  // ── Pagination items (mirror BRSCard logic) ─────────────────────────
  const totalPages = meta?.pages || 1;
  const paginationItems = useMemo(() => {
    const out: Array<{ type: "page"; value: number } | { type: "ellipsis"; key: string }> = [];
    if (totalPages <= 1) return [{ type: "page" as const, value: 1 }];
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => ({ type: "page" as const, value: i + 1 }));
    }
    if (page >= totalPages - 1) {
      out.push({ type: "page", value: 1 });
      out.push({ type: "ellipsis", key: "start" });
      out.push({ type: "page", value: totalPages - 2 });
      out.push({ type: "page", value: totalPages - 1 });
      out.push({ type: "page", value: totalPages });
      return out;
    }
    const start = page <= 2 ? 1 : page - 1;
    out.push({ type: "page", value: start });
    out.push({ type: "page", value: start + 1 });
    out.push({ type: "page", value: start + 2 });
    out.push({ type: "ellipsis", key: "end" });
    out.push({ type: "page", value: totalPages });
    return out;
  }, [page, totalPages]);

  const featured = items[0] || null;
  const rest = items.slice(1);
  const isEmpty = status === "ready" && items.length === 0;
  const canPaginate = kind !== "all";

  return (
    <div className="archive-root" data-density="regular">
      <div className="ar-shell">
        <Toolbar
          kind={kind}
          query={query}
          year={year}
          yearOptions={yearOptions}
          onKindChange={handleKindChange}
          onSearchChange={handleSearchChange}
          onYearChange={handleYearChange}
        />

        <div className="ar-section-head">
          <h2 className="ar-section-h">
            <span className="ar-section-h-pre">— </span>Latest releases
          </h2>
          <span className="ar-section-count">
            {status === "loading"
              ? "Loading…"
              : status === "error"
                ? "Error"
                : `${items.length}${meta?.total ? ` of ${meta.total}` : ""}`}
          </span>
        </div>

        {status === "error" ? (
          <ErrorState onRetry={() => setPage((p) => p)} />
        ) : isEmpty ? (
          <EmptyState query={query} />
        ) : status === "loading" ? (
          <div className="ar-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            {featured && <FeaturedCard item={featured} onOpen={openItem} />}
            <div className="ar-grid">
              {rest.map((it) => (
                <ItemCard key={it.id} item={it} onOpen={openItem} />
              ))}
            </div>
            {canPaginate && totalPages > 1 && (
              <div className="ar-pag">
                <button
                  type="button"
                  className="ar-pag-btn"
                  disabled={page <= 1 || status !== "ready"}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </button>
                {paginationItems.map((it) =>
                  it.type === "ellipsis" ? (
                    <span key={it.key} className="ar-pag-ellipsis">…</span>
                  ) : (
                    <button
                      key={it.value}
                      type="button"
                      className={`ar-pag-btn ${it.value === page ? "is-on" : ""}`}
                      disabled={status !== "ready"}
                      onClick={() => setPage(it.value)}
                    >
                      {it.value}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="ar-pag-btn"
                  disabled={page >= totalPages || status !== "ready"}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <Preview item={active} onClose={closePreview} />
    </div>
  );
}

// ── Toolbar ────────────────────────────────────────────────────────────
function Toolbar({
  kind,
  query,
  year,
  yearOptions,
  onKindChange,
  onSearchChange,
  onYearChange,
}: {
  kind: Kind;
  query: string;
  year: string;
  yearOptions: string[];
  onKindChange: (k: Kind) => void;
  onSearchChange: (v: string) => void;
  onYearChange: (v: string) => void;
}) {
  const tabs: Array<[Kind, string]> = [
    ["all", "All"],
    ["report", "Reports"],
    ["publication", "Publications"],
  ];
  return (
    <header className="ar-bar">
      <div className="ar-bar-brand">
        <span className="ar-brand-mark">◆</span>
        <span className="ar-brand-name">ARCHIVE</span>
        <span className="ar-brand-sub">/ Statistical releases</span>
      </div>

      <div className="ar-bar-tools">
        <div className="ar-seg" role="tablist" aria-label="Document kind">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              className={`ar-seg-btn ${kind === k ? "is-on" : ""}`}
              onClick={() => onKindChange(k)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <label className="ar-search">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <line x1="9.2" y1="9.2" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search titles, topics…"
            value={query}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>

        <select
          className="ar-select"
          value={year || "all"}
          onChange={(e) => onYearChange(e.target.value)}
          aria-label="Year"
        >
          <option value="all">All years</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </header>
  );
}

// ── Cover ──────────────────────────────────────────────────────────────
function Cover({
  item,
  large = false,
}: {
  item: ArchiveItem;
  large?: boolean;
}) {
  const hasImg = Boolean(item.cover);
  return (
    <div
      className={`ar-cv ${large ? "ar-cv--lg" : ""} ${hasImg ? "ar-cv--has-img" : ""}`}
      style={{ ["--hue" as string]: item.hue }}
    >
      {hasImg && (
        <img
          src={item.cover}
          alt=""
          loading="lazy"
          className="ar-cv-img"
          referrerPolicy="no-referrer"
        />
      )}
      <div className="ar-cv-bleed" />
      <div className="ar-cv-grain" />
      <div className="ar-cv-mark">{item.label}</div>
      <div className="ar-cv-foot">
        <span className="ar-cv-id">{item.id}</span>
        <span className="ar-cv-kind">{item.kind === "publication" ? "PUB" : "RPT"}</span>
      </div>
    </div>
  );
}

// ── Cards ──────────────────────────────────────────────────────────────
function ItemCard({ item, onOpen }: { item: ArchiveItem; onOpen: (it: ArchiveItem) => void }) {
  const excerpt = useMemo(() => parseBullets(item.abstract)[0] || "", [item.abstract]);
  return (
    <button type="button" className="ar-card" onClick={() => onOpen(item)}>
      <Cover item={item} />
      <div className="ar-card-body">
        <div className="ar-card-meta">
          <span>{item.eyebrow}</span>
          <span className="ar-dot" />
          <span>{formatDate(item.rl_date)}</span>
        </div>
        <h3 className="ar-card-title">{item.title || "(Untitled)"}</h3>
        {excerpt && <p className="ar-card-excerpt">{excerpt}</p>}
      </div>
    </button>
  );
}

function FeaturedCard({ item, onOpen }: { item: ArchiveItem; onOpen: (it: ArchiveItem) => void }) {
  const bullets = useMemo(() => parseBullets(item.abstract).slice(0, 3), [item.abstract]);
  return (
    <button type="button" className="ar-feat" onClick={() => onOpen(item)}>
      <div className="ar-feat-cover">
        <Cover item={item} large />
      </div>
      <div className="ar-feat-body">
        <div className="ar-feat-eyebrow">
          <span className="ar-pill">{item.kind === "publication" ? "Publication" : "Statistical report"}</span>
          <span className="ar-feat-date">{formatDate(item.rl_date)}</span>
        </div>
        <h2 className="ar-feat-title">{item.title || "(Untitled)"}</h2>
        {bullets.length > 0 && (
          <ul className="ar-feat-bullets">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        <div className="ar-feat-cta">
          Open release
          <svg width="14" height="14" viewBox="0 0 14 14" style={{ marginLeft: 6 }} aria-hidden="true">
            <path d="M2 7 H11 M7 3 L11 7 L7 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </button>
  );
}

function CardSkeleton() {
  return (
    <div className="ar-card ar-card--sk" aria-hidden="true">
      <div className="ar-cv ar-cv--sk" />
      <div className="ar-card-body">
        <div className="ar-sk" style={{ width: "40%" }} />
        <div className="ar-sk ar-sk-lg" style={{ width: "90%" }} />
        <div className="ar-sk ar-sk-lg" style={{ width: "70%" }} />
        <div className="ar-sk" style={{ width: "60%" }} />
      </div>
    </div>
  );
}

// ── Empty / Error ──────────────────────────────────────────────────────
function EmptyState({ query }: { query: string }) {
  return (
    <div className="ar-empty">
      <svg width="48" height="48" viewBox="0 0 48 48" className="ar-empty-mark" aria-hidden="true">
        <rect x="10" y="6" width="22" height="30" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <line x1="14" y1="14" x2="28" y2="14" stroke="currentColor" strokeWidth="1.3" />
        <line x1="14" y1="19" x2="28" y2="19" stroke="currentColor" strokeWidth="1.3" />
        <line x1="14" y1="24" x2="22" y2="24" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="33" cy="36" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="38" y1="41" x2="44" y2="46" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <h3 className="ar-empty-h">
        No releases match{query ? <> &ldquo;<em>{query}</em>&rdquo;</> : null}
      </h3>
      <p className="ar-empty-p">Try clearing filters, or browse the full archive going back to 2020.</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="ar-empty ar-empty--err">
      <svg width="48" height="48" viewBox="0 0 48 48" className="ar-empty-mark" aria-hidden="true">
        <path d="M24 6 L44 40 H4 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <line x1="24" y1="18" x2="24" y2="28" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="24" cy="34" r="1.4" fill="currentColor" />
      </svg>
      <h3 className="ar-empty-h">Couldn&rsquo;t load releases</h3>
      <p className="ar-empty-p">The catalogue service didn&rsquo;t respond. Check the connection or try again.</p>
      <button type="button" className="ar-pv-btn ar-pv-btn--primary" onClick={onRetry} style={{ marginTop: 18 }}>
        Retry
      </button>
    </div>
  );
}

// ── Preview overlay ────────────────────────────────────────────────────
function Preview({ item, onClose }: { item: ArchiveItem | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [item, onClose]);

  if (typeof window === "undefined" || !item) return null;

  const bullets = parseBullets(item.abstract);
  const isPub = item.kind === "publication";

  const overlay = (
    <div className="ar-pv-scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="ar-pv-panel" onClick={(e) => e.stopPropagation()} style={{ ["--hue" as string]: item.hue }}>
        {/* PDF-page side */}
        <div className="ar-pv-doc">
          <div className="ar-pv-doc-stack" aria-hidden="true">
            <div className="ar-pv-doc-page ar-pv-doc-page--back" />
            <div className="ar-pv-doc-page ar-pv-doc-page--mid" />
            <div className="ar-pv-doc-page ar-pv-doc-page--front">
              <div className="ar-pv-doc-band" />
              <div className="ar-pv-doc-eyebrow">{item.eyebrow}</div>
              <h2 className="ar-pv-doc-title">{item.title}</h2>
              <div className="ar-pv-doc-rule" />
              <div className="ar-pv-doc-meta">
                <span>No. {item.id}</span>
                <span>{formatDate(item.rl_date)}</span>
              </div>
              <div className="ar-pv-doc-lines">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span key={i} style={{ width: `${65 + ((i * 13) % 30)}%` }} />
                ))}
              </div>
              <div className="ar-pv-doc-pagenum">— 1 —</div>
            </div>
          </div>
          <div className="ar-pv-doc-controls">
            <span>{item.pages ? `Page 1 of ${item.pages}` : "Press release"}</span>
          </div>
        </div>

        {/* Metadata side */}
        <div className="ar-pv-side">
          <div className="ar-pv-side-top">
            <div className="ar-pv-tag">{isPub ? "Publication" : "Statistical Report"}</div>
            <button
              ref={closeRef}
              className="ar-pv-close"
              onClick={onClose}
              aria-label="Close"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="ar-pv-side-body">
            <div className="ar-pv-meta-row">
              <span>{item.eyebrow}</span>
              <span className="ar-pv-meta-dot">·</span>
              <span>{formatDateLong(item.rl_date)}</span>
            </div>
            <h1 className="ar-pv-title">{item.title}</h1>

            <div className="ar-pv-stats">
              <div>
                <div className="ar-pv-stat-n">{String(item.rawId).slice(0, 8)}</div>
                <div className="ar-pv-stat-l">Catalogue</div>
              </div>
              <div>
                <div className="ar-pv-stat-n">PDF</div>
                <div className="ar-pv-stat-l">Format</div>
              </div>
              <div>
                <div className="ar-pv-stat-n">{isPub ? "PUB" : "RPT"}</div>
                <div className="ar-pv-stat-l">Kind</div>
              </div>
            </div>

            {bullets.length > 0 && (
              <>
                <h3 className="ar-pv-h3">Highlights</h3>
                <ul className="ar-pv-bullets">
                  {bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="ar-pv-side-foot">
            {item.pdf ? (
              <a
                href={item.pdf}
                target="_blank"
                rel="noopener noreferrer"
                className="ar-pv-btn ar-pv-btn--primary"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" style={{ marginRight: 6 }} aria-hidden="true">
                  <path
                    d="M7 1 V9 M3.5 6 L7 9.5 L10.5 6 M2 12 H12"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Open PDF
              </a>
            ) : (
              <span className="ar-pv-btn" style={{ opacity: 0.5, cursor: "not-allowed" }}>
                No PDF available
              </span>
            )}
            <button
              type="button"
              className="ar-pv-btn"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard && typeof window !== "undefined") {
                  navigator.clipboard.writeText(window.location.href).catch(() => {});
                }
              }}
            >
              Share link
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
