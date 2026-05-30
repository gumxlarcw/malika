import { NextRequest } from "next/server";
import { backendBaseUrl, getMalikaUid, getMalikaToken } from "@/lib/apiHelpers";

export async function GET(req: NextRequest) {
  const uid = getMalikaUid(req);
  const token = getMalikaToken(req);
  if (!uid && !token) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const url = `${backendBaseUrl()}/chat/threads`;

  const fwd: Record<string, string> = {};
  if (uid) fwd["x-malika-uid"] = uid;
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, { headers: fwd, cache: "no-store" });
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
  const token = getMalikaToken(req);
  if (!uid && !token) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);

  const url = `${backendBaseUrl()}/chat/threads`;

  const fwd: Record<string, string> = { "Content-Type": "application/json" };
  if (uid) fwd["x-malika-uid"] = uid;
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: fwd,
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
