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

/**
 * Proxy SSE stream from backend to client
 * POST /api/chat/threads/[id]/stream
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = getMalikaUid(req);
  if (!uid) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const threadId = Number(id);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return Response.json({ ok: false, error: "invalid_thread_id" }, { status: 400 });
  }

  // Parse request body for text + model
  let text = "";
  let model = "";
  try {
    const body = await req.json();
    text = String(body?.text || "").trim();
    model = String(body?.model || "").trim();
  } catch {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (!text) {
    return Response.json({ ok: false, error: "missing_text" }, { status: 400 });
  }

  const url = `${backendBaseUrl()}/chat/threads/${encodeURIComponent(String(threadId))}/stream`;

  const token = req.headers.get("x-malika-token") || "";
  const fwd: Record<string, string> = { "Content-Type": "application/json", "x-malika-uid": uid };
  if (token) fwd["x-malika-token"] = token;

  let backendRes: Response;
  try {
    backendRes = await fetch(url, {
      method: "POST",
      headers: fwd,
      body: JSON.stringify({ text, ...(model ? { model } : {}) }),
      // @ts-expect-error - Node.js fetch supports this
      duplex: "half",
    });
  } catch (error) {
    console.error("[Stream Proxy] Backend fetch error:", error);
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  if (!backendRes.ok) {
    const errorText = await backendRes.text().catch(() => "");
    return Response.json(
      { ok: false, error: `backend_http_${backendRes.status}`, detail: errorText.slice(0, 500) },
      { status: 502 }
    );
  }

  // Check if response is SSE
  const contentType = backendRes.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream") && !backendRes.body) {
    return Response.json({ ok: false, error: "backend_not_sse" }, { status: 502 });
  }

  // Stream the SSE response to the client
  const stream = backendRes.body;
  if (!stream) {
    return Response.json({ ok: false, error: "no_stream_body" }, { status: 502 });
  }

  // Return streaming response with SSE headers
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}

// NOTE: the GET `?text=...` variant was removed (leak vector — it placed user
// questions + the uid in URLs and access logs). The client streams over POST.
