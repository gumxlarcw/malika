import { NextRequest } from "next/server";

/*
 * Single-item view for a BPS release or publication, proxied server-side.
 *
 * Same reason as /api/brs: a browser call to webapi.bps.go.id completes from a
 * localhost origin but fails from https://malika.bpsmalut.com. These two calls
 * back the ?brs_id= / ?pub_id= deep links, so leaving them client-side meant a
 * shared link silently opened the archive without the item it named.
 */

const MODELS = new Set(["pressrelease", "publication"]);

function getApiKey() {
  return (
    process.env.BPS_API_KEY ||
    process.env.NEXT_PUBLIC_BPS_API_KEY ||
    "e5d1be11320576d466bdeb2f7f210387"
  );
}

export async function GET(req: NextRequest) {
  const model = req.nextUrl.searchParams.get("model") || "";
  const id = req.nextUrl.searchParams.get("id") || "";

  // Allow-list the model rather than interpolating it: this segment lands in an
  // outbound URL, and the id is escaped for the same reason.
  if (!MODELS.has(model) || !id.trim()) {
    return new Response("Bad request", { status: 400 });
  }

  const url =
    `https://webapi.bps.go.id/v1/api/view/domain/8200/model/${model}` +
    `/lang/ind/id/${encodeURIComponent(id.trim())}/key/${getApiKey()}/`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { next: { revalidate: 3600 } });
  } catch {
    return new Response("Failed to fetch upstream", { status: 502 });
  }
  if (!upstream.ok) return new Response("Upstream error", { status: upstream.status });

  let raw: { data?: unknown };
  try {
    raw = (await upstream.json()) as { data?: unknown };
  } catch {
    return new Response("Invalid upstream JSON", { status: 502 });
  }

  return Response.json(
    { data: raw?.data ?? null },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
