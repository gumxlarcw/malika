export type DataLinkType = "dynamic" | "interop" | "static" | "exim";

function isDataLink(href: string) {
  return typeof href === "string" && href.startsWith("/data?");
}

export function upsertParam(href: string, key: string, value: string) {
  if (!isDataLink(href)) return href;
  try {
    const sp = new URLSearchParams(href.slice("/data?".length));
    sp.set(key, value);
    return `/data?${sp.toString()}`;
  } catch {
    return href;
  }
}

export function ensureDataLinkType(href: string, type: DataLinkType) {
  if (!isDataLink(href)) return href;
  try {
    const sp = new URLSearchParams(href.slice("/data?".length));
    // Always set type explicitly so /data and /api/data-preview hit the correct backend endpoint.
    sp.set("type", type);
    return `/data?${sp.toString()}`;
  } catch {
    return href;
  }
}

export function ensureDataLinkQuery(href: string, q: string) {
  if (!isDataLink(href)) return href;
  const qq = String(q || "").trim();
  if (!qq) return href;
  try {
    const sp = new URLSearchParams(href.slice("/data?".length));
    if (!sp.get("q")) sp.set("q", qq);
    return `/data?${sp.toString()}`;
  } catch {
    return href;
  }
}
