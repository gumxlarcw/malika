import { NextRequest } from "next/server";

function backendBaseUrl() {
  return (
    process.env.BACKEND_BASE_URL ||
    process.env.BACKEND_INTERNAL_API_URL ||
    process.env.INTERNAL_BACKEND_API_URL ||
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_URL ||
    "http://127.0.0.1:5000"
  ).replace(/\/$/, "");
}

function getMalikaUid(req: NextRequest) {
  const uid = req.headers.get("x-malika-uid") || "";
  return String(uid).trim();
}

export async function GET(req: NextRequest) {
  const uid = getMalikaUid(req);
  if (!uid) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const url = `${backendBaseUrl()}/chat/threads`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "x-malika-uid": uid,
      },
      cache: "no-store",
    });
  } catch {
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `backend_http_${res.status}`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json, { status: 200 });
  } catch {
    return Response.json({ ok: false, error: "backend_non_json" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const uid = getMalikaUid(req);
  if (!uid) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);

  const url = `${backendBaseUrl()}/chat/threads`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-malika-uid": uid,
      },
      body: JSON.stringify({ title: body?.title }),
      cache: "no-store",
    });
  } catch {
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `backend_http_${res.status}`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json, { status: 201 });
  } catch {
    return Response.json({ ok: false, error: "backend_non_json" }, { status: 502 });
  }
}
