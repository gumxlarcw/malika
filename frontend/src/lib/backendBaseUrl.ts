// Resolves the internal backend base URL using the same env-var priority chain
// the rest of the server-side code expects. Centralised here so route segments
// don't drift to single-key lookups (audit-finding I2 from the /data redesign).
//
// Order matters — first non-empty value wins. The fallback is the same in-VM
// loopback PM2 binds the backend to.
export function backendBaseUrl(): string {
  return (
    process.env.BACKEND_BASE_URL ||
    process.env.BACKEND_INTERNAL_API_URL ||
    process.env.INTERNAL_BACKEND_API_URL ||
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_URL ||
    process.env.BACKEND_URL ||
    "http://127.0.0.1:5000"
  );
}
