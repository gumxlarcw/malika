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
