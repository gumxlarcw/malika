import { NextResponse } from "next/server";

function pickBackendBaseUrl() {
  const internal =
    process.env.BACKEND_INTERNAL_API_URL ||
    process.env.INTERNAL_BACKEND_API_URL ||
    process.env.BACKEND_API_URL;
  if (internal && /^https?:\/\//i.test(internal)) return internal.replace(/\/$/, "");

  const fromEnv = process.env.NEXT_PUBLIC_BACKEND_API_URL;
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) return fromEnv.replace(/\/$/, "");

  // Default to local backend (co-located deployment).
  return "http://127.0.0.1:5000";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });

  const userAgent = req.headers.get("user-agent") || "";

  const backendBase = pickBackendBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${backendBase}/push/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-forwarded-user-agent": userAgent,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json(
      { ok: false, error: `Upstream fetch failed: ${msg}` },
      { status: 502 },
    );
  }

  const text = await res.text();
  try {
    return NextResponse.json(JSON.parse(text), { status: res.status });
  } catch {
    return NextResponse.json({ ok: res.ok, raw: text }, { status: res.status });
  }
}
