import { NextRequest } from "next/server";

function backendBaseUrl() {
  return (
    process.env.BACKEND_BASE_URL ||
    process.env.BACKEND_INTERNAL_API_URL ||
    process.env.INTERNAL_BACKEND_API_URL ||
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_URL ||
    "http://127.0.0.1:5000"
  );
}

function normalizeEximGroup(groupRaw: string) {
  const g = String(groupRaw || '').trim().toLowerCase();
  if (!g) return '';
  if (g === 'hs2') return 'hs2';
  if (g === 'pod' || g === 'pelabuhan' || g === 'port') return 'pod';
  if (g === 'ctr' || g === 'negara' || g === 'country') return 'ctr';
  if (g === 'detail') return 'detail';
  if (g === 'hs2ctr') return 'hs2ctr';
  if (g === 'hs2pod') return 'hs2pod';
  return '';
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const sourceId = Number(sp.get("source_id") || "");
  const period = String(sp.get("period") || "").trim();
  const type = String(sp.get("type") || "dynamic").trim().toLowerCase();

  const codeHs = String(sp.get("code_hs") || "").trim();
  const groupRaw = String(sp.get("group") || "").trim().toLowerCase();
  const group = normalizeEximGroup(groupRaw);
  const month = String(sp.get("month") || "").trim();
  const pod = String(sp.get("pod") || "").trim();
  const ctr = String(sp.get("ctr") || "").trim();
  const metric = String(sp.get("metric") || "").trim().toLowerCase();
  const metricWanted = metric === "value" || metric === "netweight" ? metric : "";

  if (!Number.isFinite(sourceId) || sourceId <= 0) {
    return Response.json({ message: "Invalid source_id" }, { status: 400 });
  }

  const endpoint = type === "exim" ? "exim" : type === "interop" ? "interop" : type === "static" ? "static" : "dynamic";
  if (endpoint !== "static" && (!period || period.length < 1)) {
    return Response.json({ message: "Missing period" }, { status: 400 });
  }

  const base = `${backendBaseUrl()}/${endpoint}/${encodeURIComponent(String(sourceId))}`;
  const buildUrl = (args: { pod: string; ctr: string }) =>
    endpoint === "static"
      ? base
      : `${base}?period=${encodeURIComponent(period)}${endpoint === "exim" && group ? `&group=${encodeURIComponent(group)}` : ""}${endpoint === "exim" && codeHs ? `&code_hs=${encodeURIComponent(codeHs)}` : ""}${endpoint === "exim" && month ? `&month=${encodeURIComponent(month)}` : ""}${endpoint === "exim" && args.pod ? `&pod=${encodeURIComponent(args.pod)}` : ""}${endpoint === "exim" && args.ctr ? `&ctr=${encodeURIComponent(args.ctr)}` : ""}${endpoint === "exim" && metricWanted ? `&metric=${encodeURIComponent(metricWanted)}` : ""}`;

  const url = buildUrl({ pod, ctr });

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    return Response.json({ message: "Failed to reach backend" }, { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) {
    // EXIM robustness: if the caller sent `pod=<token>` but backend has no matches,
    // retry once by treating that token as `ctr` (common when users type "china" without "negara").
    if (endpoint === 'exim' && res.status === 404 && pod && !ctr) {
      try {
        const url2 = buildUrl({ pod: '', ctr: pod });
        const res2 = await fetch(url2, { cache: 'no-store' });
        const text2 = await res2.text();
        if (res2.ok) {
          try {
            const json2 = JSON.parse(text2);
            return Response.json(json2, { headers: { 'Cache-Control': 'no-store' } });
          } catch {
            return Response.json({ message: 'Invalid backend JSON' }, { status: 502 });
          }
        }
      } catch {
        // fall through
      }
    }

    // Pass through backend status so UI can show a meaningful message.
    // Prefer backend JSON (message/code) when available.
    try {
      const parsed = JSON.parse(text) as any;
      const backendMessage = typeof parsed?.message === 'string' ? parsed.message : '';
      const backendCode = typeof parsed?.code === 'string' ? parsed.code : '';
      const detail = typeof parsed?.detail === 'string' ? parsed.detail : text.slice(0, 500);
      return Response.json(
        {
          message: backendMessage || `Backend error (HTTP ${res.status})`,
          code: backendCode || undefined,
          detail,
        },
        { status: res.status }
      );
    } catch {
      return Response.json(
        { message: `Backend error (HTTP ${res.status})`, detail: text.slice(0, 500) },
        { status: res.status }
      );
    }
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ message: "Invalid backend JSON" }, { status: 502 });
  }
}
