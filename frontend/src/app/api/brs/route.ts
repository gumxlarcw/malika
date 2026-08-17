import { NextRequest } from "next/server";

/*
 * Server-side proxy for the BPS press-release (BRS) catalogue.
 *
 * The browser used to call webapi.bps.go.id directly for releases, the way it
 * still does for nothing else: publications have gone through /api/publikasi
 * from the start. That worked from a localhost origin but failed from
 * https://malika.bpsmalut.com with a bare "Failed to fetch" — the upstream
 * answers `Access-Control-Allow-Origin: *` to curl, yet the browser request
 * from the production origin never completes, while an unrelated cross-origin
 * request from the same page succeeds. Rather than keep guessing at BPS's edge,
 * the call moves server-side, which also lets the response be cached and keeps
 * the API key off the client.
 */

type BrsItem = {
  brs_id: number;
  title: string;
  abstract?: string;
  rl_date?: string;
  pdf?: string;
  thumbnail?: string;
  subcsa?: string;
  subcsa_id?: number | string;
};

type BpsMeta = { page: number; pages: number; per_page: number; count: number; total: number };
type ApiResponse = { data?: [BpsMeta, BrsItem[]] };

function getApiKey() {
  return (
    process.env.BPS_API_KEY ||
    process.env.NEXT_PUBLIC_BPS_API_KEY ||
    "e5d1be11320576d466bdeb2f7f210387"
  );
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(sp.get("page") || "1", 10) || 1);
  const keyword = (sp.get("keyword") || "").trim();
  const year = sp.get("year") || "";
  const subject = sp.get("subject") || "";

  let url = `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/8200/page/${page}`;
  if (keyword) url += `/keyword/${encodeURIComponent(keyword)}`;
  if (year) url += `/year/${encodeURIComponent(year)}`;
  // Measured against the live API: `subject/{subcsa_id}` narrows pressrelease
  // (774 releases down to 25 for Tenaga Kerja). `subcat` — the name the docs
  // suggest — is accepted and silently ignored, so it is not used.
  if (subject) url += `/subject/${encodeURIComponent(subject)}`;
  url += `/key/${getApiKey()}/`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { next: { revalidate: 3600 } });
  } catch {
    return new Response("Failed to fetch upstream", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("Upstream error", { status: upstream.status });
  }

  let raw: ApiResponse;
  try {
    raw = (await upstream.json()) as ApiResponse;
  } catch {
    return new Response("Invalid upstream JSON", { status: 502 });
  }

  const meta = (raw?.data?.[0] || null) as BpsMeta | null;
  const items = Array.isArray(raw?.data?.[1]) ? raw.data![1] : [];

  return Response.json(
    { meta, items },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}
