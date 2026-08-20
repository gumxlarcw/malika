import { NextRequest } from "next/server";
import { backendBaseUrl, getMalikaUid } from "@/lib/apiHelpers";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = getMalikaUid(req);
  if (!uid) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const threadId = Number(id);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return Response.json({ ok: false, error: "invalid_thread_id" }, { status: 400 });
  }

  const url = `${backendBaseUrl()}/chat/threads/${encodeURIComponent(String(threadId))}/suggestions`;

  const token = req.headers.get("x-malika-token") || "";
  const fwd: Record<string, string> = { "x-malika-uid": uid };
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: fwd,
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
