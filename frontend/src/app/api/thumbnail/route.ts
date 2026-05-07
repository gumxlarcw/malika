import { NextRequest } from "next/server";

function isAllowedUrl(input: string) {
  try {
    const u = new URL(input);
    if (u.protocol !== "https:") return null;
    // Only allow BPS cover/thumbnail host(s) to avoid creating an open proxy.
    const host = u.hostname.toLowerCase();
    if (host !== "webapi.bps.go.id") return null;
    return u;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const raw = String(req.nextUrl.searchParams.get("url") || "").trim();
  const url = isAllowedUrl(raw);
  if (!url) {
    return new Response("Invalid url", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      // This is a pure proxy; let the client cache if desired.
      cache: "force-cache",
    });
  } catch {
    return new Response("Failed to fetch", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("Upstream error", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const body = await upstream.arrayBuffer();

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Safe-ish caching: URLs are content-addressed-ish by the BPS API token.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
