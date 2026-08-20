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

/**
 * Mint/renew the signed anonymous identity token.
 * POST /api/chat/identity → backend POST /chat/identity.
 * Forwards an existing x-malika-token (renewal) and the { uid } body
 * (legacy adoption). Public — this is the bootstrap that issues tokens.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-malika-token") || "";
  const body = await req.json().catch(() => null);

  const fwd: Record<string, string> = { "Content-Type": "application/json" };
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(`${backendBaseUrl()}/chat/identity`, {
      method: "POST",
      headers: fwd,
      body: JSON.stringify({ uid: body?.uid }),
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
  return Response.json(json, { status: res.status });
}
