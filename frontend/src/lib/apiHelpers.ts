/**
 * Shared helpers for Next.js API routes (server-side only).
 * Canonical location for backendBaseUrl and getMalikaUid.
 */
import { NextRequest } from "next/server";

/**
 * Resolve the backend base URL from environment variables.
 * Falls back through multiple env var names for deployment flexibility.
 */
export function backendBaseUrl(): string {
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
 * Extract and sanitise the x-malika-uid header from a request.
 */
export function getMalikaUid(req: NextRequest): string {
  const uid = req.headers.get("x-malika-uid") || "";
  return String(uid).trim();
}

/**
 * Extract and sanitise the x-malika-token header from a request.
 */
export function getMalikaToken(req: NextRequest): string {
  const token = req.headers.get("x-malika-token") || "";
  return String(token).trim();
}

/**
 * Map a non-OK backend response into a client Response.
 * 4xx are client-actionable (e.g. 401 identity_required → re-mint token), so the
 * upstream status is forwarded and the machine-readable body preserved. 5xx and
 * unknown statuses are masked as 502 with capped detail so backend internals
 * (e.g. a non-production stack trace) never reach the client.
 */
export function proxyBackendError(status: number, bodyText: string): Response {
  if (status >= 400 && status < 500) {
    try {
      return Response.json(JSON.parse(bodyText), { status });
    } catch {
      return Response.json({ ok: false, error: `backend_http_${status}` }, { status });
    }
  }
  return Response.json(
    { ok: false, error: `backend_http_${status}`, detail: bodyText.slice(0, 500) },
    { status: 502 }
  );
}
