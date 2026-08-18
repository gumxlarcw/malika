import { NextRequest } from "next/server";

/*
 * Image proxy for BPS covers and release thumbnails.
 *
 * webapi.bps.go.id refuses requests from the production origin — the same
 * refusal that forced /api/brs to exist. For <img> it fails silently: on
 * malika.bpsmalut.com every one of the ten covers on /publikasi was broken,
 * while all ten loaded from a localhost origin. The old fixed aspect-ratio hid
 * it, because a broken image sat invisibly over the gradient tile behind it.
 *
 * Only webapi.bps.go.id is reachable through here. Without that allow-list this
 * route would be an open proxy that lends the site's origin to any URL a caller
 * cares to pass.
 */

const ALLOWED_HOST = "webapi.bps.go.id";
const MAX_BYTES = 8 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("u");
  if (!raw) return new Response("Missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || target.hostname !== ALLOWED_HOST) {
    return new Response("Forbidden host", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { next: { revalidate: 86400 } });
  } catch {
    return new Response("Upstream unreachable", { status: 502 });
  }
  if (!upstream.ok) return new Response("Upstream error", { status: upstream.status });

  const type = upstream.headers.get("content-type") || "";
  if (!type.startsWith("image/")) {
    return new Response("Not an image", { status: 415 });
  }
  const length = Number(upstream.headers.get("content-length") || 0);
  if (length > MAX_BYTES) return new Response("Too large", { status: 413 });

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("Too large", { status: 413 });

  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
