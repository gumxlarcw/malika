import { NextRequest } from "next/server";

const ALLOWED_HOSTS = new Set([
  "webapi.bps.go.id",
  "bps.go.id",
  "www.bps.go.id",
  "static.bps.go.id",
]);

export async function GET(req: NextRequest) {
  const urlStr = req.nextUrl.searchParams.get("url");
  if (!urlStr) {
    return new Response("Missing 'url' query param", { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (url.protocol !== "https:") {
    return new Response("Only https is allowed", { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    return new Response("Host not allowed", { status: 403 });
  }

  const range = req.headers.get("range");

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      headers: range ? { range } : undefined,
    });
  } catch {
    return new Response("Failed to fetch upstream", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("Upstream error", { status: upstream.status });
  }

  const headers = new Headers();
  // Force PDF mime-type for reliable in-browser preview.
  // Some upstream hosts return application/octet-stream which makes browsers download.
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", "inline");
  // Allow browser to reuse PDFs; Range support enables faster progressive rendering.
  headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  headers.set("X-Content-Type-Options", "nosniff");

  const acceptRanges = upstream.headers.get("accept-ranges");
  const contentRange = upstream.headers.get("content-range");
  const contentLength = upstream.headers.get("content-length");
  if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
  if (contentRange) headers.set("Content-Range", contentRange);
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
