"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import "./archive.css";

type Kind = "all" | "report" | "publication";
type SortKey = "baru" | "lama";

/**
 * Subjects come from the items themselves, not from webapi's `subject` model.
 * That endpoint answers with a different taxonomy — `sub_id` 108 "Agama",
 * 40 "Gender" — while releases are tagged with CSA subjects (`subcsa_id` 520
 * "Tenaga Kerja"). Filtering by an id from the wrong scheme returns nothing,
 * so the options are accumulated from the releases actually seen.
 */
type SubjectOption = { id: string; label: string };

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
  subjectId?: string;
  subject?: string;
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
  subcsa?: string;
  subcsa_id?: number | string;
};

type PubRaw = {
  pub_id: string;
  title: string;
  abstract?: string;
  rl_date?: string;
  cover?: string;
  pdf?: string;
  size?: string;
  /* Array through `/api/publikasi`, which parses it; the stringified list
     `"['A', 'B']"` if the raw webapi is ever read directly. */
  subject_csa?: string | string[] | null;
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

/**
 * First subject of a publication, for display only.
 *
 * Two shapes reach this: `/api/publikasi` parses `subject_csa` into a real
 * array, while the raw webapi sends the stringified list `"['Gender…', …]"`.
 * Both are handled — assuming the string form threw `e.match is not a
 * function` on the very first publication and took the whole page to its
 * error state.
 *
 * Label-only on purpose: webapi accepts `subject/{id}` on publications and
 * answers with the unfiltered 572 regardless, so it is never used to filter.
 */
function parseFirstSubject(raw?: string | string[] | null): string | undefined {
  if (!raw || raw === "None") return undefined;
  const first = Array.isArray(raw)
    ? raw.find((v) => typeof v === "string" && v.trim())
    : (raw.match(/'([^']+)'|"([^"]+)"/) ?? [])[1] ?? raw;
  if (typeof first !== "string") return undefined;
  const clean = sanitizeText(first).trim();
  return clean || undefined;
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
    eyebrow: "Berita Resmi Statistik",
    // webapi sends the literal string "None" rather than omitting the field.
    subjectId:
      b.subcsa_id != null && String(b.subcsa_id) !== "None" ? String(b.subcsa_id) : undefined,
    subject: b.subcsa && b.subcsa !== "None" ? sanitizeText(b.subcsa) : undefined,
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
    eyebrow: "Publikasi",
    subject: parseFirstSubject(p.subject_csa),
  };
}

const BPS_API_KEY =
  process.env.NEXT_PUBLIC_BPS_API_KEY || "e5d1be11320576d466bdeb2f7f210387";
const BPS_DOMAIN = "8200";

function buildBrsListUrl(opts: { page: number; keyword?: string; year?: string; subject?: string }) {
  let url = `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/${BPS_DOMAIN}/page/${opts.page}`;
  if (opts.keyword?.trim()) url += `/keyword/${encodeURIComponent(opts.keyword.trim())}`;
  if (opts.year) url += `/year/${opts.year}`;
  // Measured against the live API: `subject/{subcsa_id}` narrows pressrelease
  // (774 releases down to 25 for Tenaga Kerja). `subcat` — the name the docs
  // suggest — is accepted and silently ignored, which is why it is not used.
  if (opts.subject) url += `/subject/${encodeURIComponent(opts.subject)}`;
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

/*
 * Earliest year each catalogue actually holds, read off the last page of the
 * live API: pressrelease bottoms out at 2014-01-04 (78 pages), publication at
 * 2003-04-21 (58 pages). The list used to stop at 2020, which put eleven years
 * of releases and seventeen years of publications out of reach of the filter —
 * they were in the archive, just unselectable.
 */
const EARLIEST_YEAR: Record<Kind, number> = { all: 2003, report: 2014, publication: 2003 };

function getYearOptions(kind: Kind): string[] {
  const cur = new Date().getFullYear();
  const floor = EARLIEST_YEAR[kind];
  const ys: string[] = [];
  for (let y = cur; y >= floor; y--) ys.push(String(y));
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
  const [subject, setSubject] = useState<string>(() => searchParams?.get("subject") || "");
  const [sort, setSort] = useState<SortKey>(() =>
    searchParams?.get("sort") === "lama" ? "lama" : "baru",
  );
  const [view, setView] = useState<"kartu" | "daftar">("kartu");
  const [page, setPage] = useState<number>(1);
  // Grows as pages are browsed; see SubjectOption on why it is not fetched.
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [meta, setMeta] = useState<BpsListMeta | null>(null);
  const [active, setActive] = useState<ArchiveItem | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedForIdRef = useRef<string | null>(null);

  const yearOptions = useMemo(() => getYearOptions(kind), [kind]);

  const pushUrl = useCallback(
    (next: {
      kind?: Kind;
      keyword?: string;
      year?: string;
      subject?: string;
      sort?: SortKey;
      id?: string | null;
    }) => {
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
      if (next.subject !== undefined) {
        if (next.subject) params.set("subject", next.subject);
        else params.delete("subject");
      }
      if (next.sort !== undefined) {
        if (next.sort === "lama") params.set("sort", "lama");
        else params.delete("sort");
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

  /** Accumulates subject options from releases already fetched. */
  const collectSubjects = useCallback((list: ArchiveItem[]) => {
    setSubjectOptions((prev) => {
      const byId = new Map(prev.map((o) => [o.id, o]));
      let added = false;
      for (const it of list) {
        if (!it.subjectId || !it.subject || byId.has(it.subjectId)) continue;
        byId.set(it.subjectId, { id: it.subjectId, label: it.subject });
        added = true;
      }
      if (!added) return prev;
      return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, "id"));
    });
  }, []);

  const handleSubjectChange = useCallback(
    (v: string) => {
      const next = v === "all" ? "" : v;
      setSubject(next);
      setPage(1);
      pushUrl({ subject: next });
    },
    [pushUrl],
  );

  const handleSortChange = useCallback(
    (v: SortKey) => {
      setSort(v);
      setPage(1);
      pushUrl({ sort: v });
    },
    [pushUrl],
  );

  const handleClearFilters = useCallback(() => {
    setQuery("");
    setYear("");
    setSubject("");
    setSort("baru");
    setPage(1);
    pushUrl({ keyword: "", year: "", subject: "", sort: "baru" });
  }, [pushUrl]);

  // ── Data fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setStatus("loading");
      try {
        if (kind === "all") {
          const [brsRes, pubRes] = await Promise.all([
            fetch(buildBrsListUrl({ page: 1, keyword: query, year, subject }), {
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
          collectSubjects(brsItems);
          setMeta(null);
          setStatus("ready");
          return;
        }

        if (kind === "report") {
          /*
           * webapi only ever serves newest-first, ten at a time, with no page
           * size or order parameter. "Terlama" therefore reads the archive from
           * the far end: probe for the page count, mirror the requested page
           * onto it, and reverse the ten rows that come back. That costs one
           * extra request and gives the genuine oldest releases — sorting the
           * ten rows already on screen would only relabel the newest page.
           */
          let apiPage = page;
          if (sort === "lama") {
            const probe = await fetch(buildBrsListUrl({ page: 1, keyword: query, year, subject }), {
              signal: controller.signal,
              cache: "no-store",
            }).then((r) => r.json()).catch(() => null);
            const pages = Number(probe?.data?.[0]?.pages) || 1;
            apiPage = Math.max(1, pages - (page - 1));
          }
          const res = await fetch(buildBrsListUrl({ page: apiPage, keyword: query, year, subject }), {
            signal: controller.signal,
            cache: "no-store",
          });
          const raw = (await res.json()) as { data?: [BpsListMeta, BrsRaw[]] };
          if (controller.signal.aborted) return;
          const m = (raw?.data?.[0] || null) as BpsListMeta | null;
          let list = Array.isArray(raw?.data?.[1]) ? raw.data![1].map(brsToItem) : [];
          if (sort === "lama") list = list.slice().reverse();
          setMeta(m ? { ...m, page } : m);
          setItems(list);
          collectSubjects(list);
          setStatus("ready");
          return;
        }

        // kind === "publication"
        let pubApiPage = page;
        if (sort === "lama") {
          const probe = await fetch(buildPubListUrl({ page: 1, keyword: query, year }), {
            signal: controller.signal,
            cache: "no-store",
          }).then((r) => r.json()).catch(() => null);
          const pages = Number(probe?.meta?.pages) || 1;
          pubApiPage = Math.max(1, pages - (page - 1));
        }
        const res = await fetch(buildPubListUrl({ page: pubApiPage, keyword: query, year }), {
          signal: controller.signal,
          cache: "no-store",
        });
        const raw = (await res.json()) as { meta?: BpsListMeta | null; items?: PubRaw[] };
        if (controller.signal.aborted) return;
        const pubMeta = (raw?.meta || null) as BpsListMeta | null;
        let pubList = Array.isArray(raw?.items) ? raw.items.map(pubToItem) : [];
        if (sort === "lama") pubList = pubList.slice().reverse();
        setMeta(pubMeta ? { ...pubMeta, page } : pubMeta);
        setItems(pubList);
        setStatus("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        // The bare `catch {}` here hid a mapping bug behind a generic "Gagal"
        // even though the request had returned 200.
        console.error("ArchiveBrowser load failed:", err);
        setStatus("error");
      }
    };

    load();
    return () => controller.abort();
  }, [kind, query, year, subject, sort, page, collectSubjects]);

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

  const activeSubjectLabel = useMemo(
    () => subjectOptions.find((o) => o.id === subject)?.label ?? null,
    [subjectOptions, subject],
  );

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
          subject={subject}
          subjectOptions={subjectOptions}
          sort={sort}
          showSort={canPaginate}
          view={view}
          onKindChange={handleKindChange}
          onSearchChange={handleSearchChange}
          onYearChange={handleYearChange}
          onSubjectChange={handleSubjectChange}
          onSortChange={handleSortChange}
          onViewChange={setView}
        />

        <FilterChips
          query={query}
          year={year}
          subjectLabel={activeSubjectLabel}
          sort={canPaginate ? sort : "baru"}
          onClearQuery={() => handleSearchChange("")}
          onClearYear={() => handleYearChange("all")}
          onClearSubject={() => handleSubjectChange("all")}
          onClearSort={() => handleSortChange("baru")}
          onClearAll={handleClearFilters}
        />

        <div className="ar-section-head">
          <h2 className="ar-section-h">
            <span className="ar-section-h-pre">— </span>
            {sort === "lama" && canPaginate ? "Rilis terlama" : "Rilis terbaru"}
          </h2>
          <span className="ar-section-count">
            {status === "loading"
              ? "Memuat…"
              : status === "error"
                ? "Gagal"
                : `${items.length}${meta?.total ? ` dari ${meta.total}` : ""}`}
          </span>
        </div>

        {status === "error" ? (
          <ErrorState onRetry={() => setPage((p) => p)} />
        ) : isEmpty ? (
          <EmptyState
            query={query}
            earliestYear={EARLIEST_YEAR[kind]}
            onClear={handleClearFilters}
          />
        ) : status === "loading" ? (
          <div className="ar-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            {view === "daftar" ? (
              <ul className="ar-list">
                {items.map((it) => (
                  <ListRow key={it.id} item={it} onOpen={openItem} />
                ))}
              </ul>
            ) : (
              <>
                {featured && <FeaturedCard item={featured} onOpen={openItem} />}
                <div className="ar-grid">
                  {rest.map((it) => (
                    <ItemCard key={it.id} item={it} onOpen={openItem} />
                  ))}
                </div>
              </>
            )}
            {canPaginate && totalPages > 1 && (
              <div className="ar-pag">
                <button
                  type="button"
                  className="ar-pag-btn"
                  disabled={page <= 1 || status !== "ready"}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Sebelumnya
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
                  Berikutnya →
                </button>
              </div>
            )}
          </>
        )}
        <section className="ar-cta">
          <div className="ar-cta-text">
            <h3 className="ar-cta-h">Butuh angka spesifik?</h3>
            <p className="ar-cta-p">
              Rilis memuat ringkasan. Angka per kabupaten/kota dan deret antar tahun ada di data
              statistik dan peta tematik.
            </p>
          </div>
          <div className="ar-cta-links">
            <Link href="/kategori" className="ar-cta-btn ar-cta-btn--primary">
              Jelajahi data statistik
            </Link>
            <Link href="/peta-tematik" className="ar-cta-btn">
              Lihat peta tematik
            </Link>
          </div>
        </section>

        <p className="ar-source">
          Sumber: <a href="https://webapi.bps.go.id" target="_blank" rel="noopener noreferrer">webapi BPS</a>{" "}
          · domain {BPS_DOMAIN} (Maluku Utara)
        </p>
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
  subject,
  subjectOptions,
  sort,
  showSort,
  view,
  onKindChange,
  onSearchChange,
  onYearChange,
  onSubjectChange,
  onSortChange,
  onViewChange,
}: {
  kind: Kind;
  query: string;
  year: string;
  yearOptions: string[];
  subject: string;
  subjectOptions: SubjectOption[];
  sort: SortKey;
  /** Hidden on "Semua", which merges one page of each source and cannot order the archive. */
  showSort: boolean;
  view: "kartu" | "daftar";
  onKindChange: (k: Kind) => void;
  onSearchChange: (v: string) => void;
  onYearChange: (v: string) => void;
  onSubjectChange: (v: string) => void;
  onSortChange: (v: SortKey) => void;
  onViewChange: (v: "kartu" | "daftar") => void;
}) {
  const tabs: Array<[Kind, string]> = [
    ["all", "Semua"],
    ["report", "Berita Resmi Statistik"],
    ["publication", "Publikasi"],
  ];
  return (
    <header className="ar-bar">
      <div className="ar-bar-brand">
        <span className="ar-brand-name">Berita Resmi Statistik &amp; Publikasi</span>
        <span className="ar-brand-sub">Arsip rilis · BPS Provinsi Maluku Utara</span>
      </div>

      <div className="ar-bar-tools">
        <div className="ar-seg" role="tablist" aria-label="Jenis dokumen">
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
            placeholder="Cari judul atau topik…"
            aria-label="Cari rilis"
            value={query}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>

        {subjectOptions.length > 0 && (
          <select
            className="ar-select"
            value={subject || "all"}
            onChange={(e) => onSubjectChange(e.target.value)}
            aria-label="Subjek"
            /* webapi only honours subject on pressrelease, so the control is
               disabled rather than hidden on Publikasi: hiding it would make
               the toolbar reflow every time the reader switches tab. */
            disabled={kind === "publication"}
            title={
              kind === "publication"
                ? "webapi tidak menyaring publikasi menurut subjek"
                : undefined
            }
          >
            <option value="all">Semua subjek</option>
            {subjectOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        )}

        <select
          className="ar-select"
          value={year || "all"}
          onChange={(e) => onYearChange(e.target.value)}
          aria-label="Tahun"
        >
          <option value="all">Semua tahun</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {showSort && (
          <select
            className="ar-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value === "lama" ? "lama" : "baru")}
            aria-label="Urutkan"
          >
            <option value="baru">Terbaru</option>
            <option value="lama">Terlama</option>
          </select>
        )}

        <div className="ar-view" role="group" aria-label="Tampilan">
          <button
            type="button"
            className={`ar-view-btn ${view === "kartu" ? "is-on" : ""}`}
            aria-pressed={view === "kartu"}
            onClick={() => onViewChange("kartu")}
            title="Tampilan kartu"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <rect x="3" y="3" width="6" height="6" rx="1.5" />
              <rect x="11" y="3" width="6" height="6" rx="1.5" />
              <rect x="3" y="11" width="6" height="6" rx="1.5" />
              <rect x="11" y="11" width="6" height="6" rx="1.5" />
            </svg>
          </button>
          <button
            type="button"
            className={`ar-view-btn ${view === "daftar" ? "is-on" : ""}`}
            aria-pressed={view === "daftar"}
            onClick={() => onViewChange("daftar")}
            title="Tampilan daftar"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="M3 5.5h14M3 10h14M3 14.5h14" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

// ── Active filter chips ────────────────────────────────────────────────
function FilterChips({
  query,
  year,
  subjectLabel,
  sort,
  onClearQuery,
  onClearYear,
  onClearSubject,
  onClearSort,
  onClearAll,
}: {
  query: string;
  year: string;
  subjectLabel: string | null;
  sort: SortKey;
  onClearQuery: () => void;
  onClearYear: () => void;
  onClearSubject: () => void;
  onClearSort: () => void;
  onClearAll: () => void;
}) {
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (query.trim()) chips.push({ key: "q", label: `"${query.trim()}"`, clear: onClearQuery });
  if (subjectLabel) chips.push({ key: "s", label: subjectLabel, clear: onClearSubject });
  if (year) chips.push({ key: "y", label: year, clear: onClearYear });
  if (sort === "lama") chips.push({ key: "o", label: "Terlama", clear: onClearSort });
  if (chips.length === 0) return null;

  return (
    <div className="ar-chips">
      <span className="ar-chips-label">Filter aktif</span>
      {chips.map((c) => (
        <button key={c.key} type="button" className="ar-chip" onClick={c.clear}>
          {c.label}
          <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
          </svg>
          <span className="ar-sr">Hapus filter {c.label}</span>
        </button>
      ))}
      <button type="button" className="ar-chips-clear" onClick={onClearAll}>
        Bersihkan semua
      </button>
    </div>
  );
}

// ── List row ───────────────────────────────────────────────────────────
function ListRow({ item, onOpen }: { item: ArchiveItem; onOpen: (it: ArchiveItem) => void }) {
  return (
    <li>
      <button type="button" className="ar-row" onClick={() => onOpen(item)}>
        <span className="ar-row-date">{formatDate(item.rl_date)}</span>
        <span className="ar-row-main">
          <span className="ar-row-title">{item.title}</span>
          <span className="ar-row-meta">
            {item.eyebrow}
            {item.subject ? ` · ${item.subject}` : ""}
          </span>
        </span>
        <span className="ar-row-open">Buka rilis →</span>
      </button>
    </li>
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
function EmptyState({
  query,
  earliestYear,
  onClear,
}: {
  query: string;
  earliestYear: number;
  onClear: () => void;
}) {
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
        Tidak ada rilis yang cocok{query ? <> dengan &ldquo;<em>{query}</em>&rdquo;</> : null}.
      </h3>
      <p className="ar-empty-p">
        Coba longgarkan subjek atau tahun — arsip tersedia sejak {earliestYear}.
      </p>
      <button type="button" className="ar-pv-btn" onClick={onClear} style={{ marginTop: 18 }}>
        Bersihkan filter
      </button>
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
      <h3 className="ar-empty-h">Gagal memuat rilis</h3>
      <p className="ar-empty-p">Layanan katalog BPS tidak merespons. Periksa koneksi, lalu coba lagi.</p>
      <button type="button" className="ar-pv-btn ar-pv-btn--primary" onClick={onRetry} style={{ marginTop: 18 }}>
        Coba lagi
      </button>
    </div>
  );
}

// ── Preview overlay ────────────────────────────────────────────────────
function Preview({ item, onClose }: { item: ArchiveItem | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Which item's citation was copied, rather than a bare boolean: keyed this
  // way the flag resets itself when a different release is opened, with no
  // effect that would fire a second render just to clear it.
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
  const copied = copiedId === item.id;

  /*
   * Author–year form, Sofifi being the seat of BPS Maluku Utara.
   *
   * The catalogue number is appended only for releases, whose id is the short
   * quotable "BRS-875". Publication ids are 24-character hashes
   * ("PUB-8a23b4e3962d12edc08727d4") — meaningless to a reader and pure noise
   * once the citation is pasted into a document, so they are left out.
   */
  const pubYear = (item.rl_date || "").slice(0, 4) || "t.t.";
  const catalogueNo = isPub ? "" : ` ${item.id}.`;
  const citation = `BPS Provinsi Maluku Utara. ${pubYear}. ${item.title}. Sofifi: BPS Provinsi Maluku Utara.${catalogueNo}`;

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
            <span>{item.pages ? `Halaman 1 dari ${item.pages}` : "Berita Resmi Statistik"}</span>
          </div>
        </div>

        {/* Metadata side */}
        <div className="ar-pv-side">
          <div className="ar-pv-side-top">
            <div className="ar-pv-tag">{isPub ? "Publikasi" : "Berita Resmi Statistik"}</div>
            <button
              ref={closeRef}
              className="ar-pv-close"
              onClick={onClose}
              aria-label="Tutup"
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
                <div className="ar-pv-stat-l">Katalog</div>
              </div>
              <div>
                <div className="ar-pv-stat-n">PDF</div>
                <div className="ar-pv-stat-l">Format</div>
              </div>
              <div>
                <div className="ar-pv-stat-n">{isPub ? "PUB" : "BRS"}</div>
                <div className="ar-pv-stat-l">Jenis</div>
              </div>
            </div>

            {bullets.length > 0 && (
              <>
                <h3 className="ar-pv-h3">Poin utama</h3>
                <ul className="ar-pv-bullets">
                  {bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </>
            )}

            <h3 className="ar-pv-h3">Sitasi</h3>
            <p className="ar-pv-cite">{citation}</p>
            <button
              type="button"
              className="ar-pv-cite-copy"
              onClick={() => {
                if (typeof navigator === "undefined" || !navigator.clipboard) return;
                navigator.clipboard.writeText(citation).then(
                  () => setCopiedId(item.id),
                  () => setCopiedId(null),
                );
              }}
            >
              {copied ? "Tersalin" : "Salin"}
            </button>
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
                Buka PDF
              </a>
            ) : (
              <span className="ar-pv-btn" style={{ opacity: 0.5, cursor: "not-allowed" }}>
                PDF tidak tersedia
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
              Bagikan
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
