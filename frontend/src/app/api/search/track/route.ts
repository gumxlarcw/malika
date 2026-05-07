import { NextRequest } from "next/server";

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

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, reason: "INVALID_JSON" }, { status: 400 });
  }

  const sourceId = Number(body?.source_id);
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return Response.json({ ok: false, reason: "INVALID_SOURCE_ID" }, { status: 400 });
  }

  try {
    const url = `${backendBaseUrl()}/search/track/datasource`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId }),
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return Response.json({ ok: false, upstream: json }, { status: 502 });
    }

    return Response.json(json ?? { ok: true });
  } catch {
    return Response.json({ ok: false, reason: "UPSTREAM_UNREACHABLE" }, { status: 502 });
  }
}
