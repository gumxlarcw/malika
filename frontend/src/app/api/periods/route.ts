import { NextRequest } from "next/server";

const PERIODS_REVALIDATE_SECONDS = 300;

function backendBaseUrl() {
  return (
    process.env.BACKEND_BASE_URL ||
    process.env.BACKEND_INTERNAL_API_URL ||
    process.env.INTERNAL_BACKEND_API_URL ||
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_URL ||
    "http://127.0.0.1:5000"
  );
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sourceId = Number(sp.get("source_id") || "");

  if (!Number.isFinite(sourceId) || sourceId <= 0) {
    return Response.json({ message: "Invalid source_id" }, { status: 400 });
  }

  const url = `${backendBaseUrl()}/period/public/${encodeURIComponent(String(sourceId))}`;

  let res: Response;
  try {
    // Cache on the Next.js server to keep search previews snappy.
    res = await fetch(url, { next: { revalidate: PERIODS_REVALIDATE_SECONDS } });
  } catch {
    return Response.json({ message: "Failed to reach backend" }, { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) {
    return Response.json(
      { message: `Backend error (HTTP ${res.status})`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json, {
      headers: {
        // Allow CDN/proxy caching (if present) and keep UI fast.
        "Cache-Control": `public, max-age=0, s-maxage=${PERIODS_REVALIDATE_SECONDS}, stale-while-revalidate=${PERIODS_REVALIDATE_SECONDS * 2}`,
      },
    });
  } catch {
    return Response.json({ message: "Invalid backend JSON" }, { status: 502 });
  }
}
