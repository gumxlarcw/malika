/**
 * Resolves the internal backend base URL for **server-side** fetches.
 *
 * ⚠️ SERVER-ONLY. Do not import this from a Client Component.
 *
 * The priority chain reads only env-vars that Next.js does NOT inline into the
 * client bundle — `NEXT_PUBLIC_*` was deliberately removed (audit C6) because
 *   1) it would be inlined at build time and exposed in the browser,
 *   2) it typically points to the public/external URL, so server-side fetches
 *      using it would needlessly hairpin out via Cloudflare and back in instead
 *      of using the in-VM loopback.
 *
 * As a runtime safety net we throw if the helper is ever invoked client-side
 * (i.e. if `window` is defined). This catches accidental bundling without
 * adding a `server-only` package dependency.
 *
 * Centralised here so route segments don't drift to single-key lookups.
 */
export function backendBaseUrl(): string {
  if (typeof window !== "undefined") {
    throw new Error(
      "backendBaseUrl() called in a client bundle — this helper is server-only.",
    );
  }
  return (
    process.env.BACKEND_BASE_URL ||
    process.env.BACKEND_INTERNAL_API_URL ||
    process.env.INTERNAL_BACKEND_API_URL ||
    process.env.BACKEND_API_URL ||
    process.env.BACKEND_URL ||
    "http://127.0.0.1:5000"
  );
}
