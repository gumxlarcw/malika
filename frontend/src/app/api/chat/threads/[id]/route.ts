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

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = getMalikaUid(req);
  if (!uid) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const threadId = Number(id);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return Response.json({ ok: false, error: "invalid_thread_id" }, { status: 400 });
  }

  const url = `${backendBaseUrl()}/chat/threads/${encodeURIComponent(String(threadId))}`;

  const token = req.headers.get("x-malika-token") || "";
  const fwd: Record<string, string> = { "x-malika-uid": uid };
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: fwd,
      cache: "no-store",
    });
  } catch {
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: "backend_non_json" }, { status: 502 });
  }

  // Pass the backend status through verbatim so an owner check (404) or bad
  // input (400) reaches the client as-is rather than being masked as a 502.
  return Response.json(json, { status: res.status });
}
