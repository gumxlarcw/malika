import { NextRequest, NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Proxy for GET /dashboard/public/series — deeper trends than the summary carries. */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const ids = sp.get("ids");
    if (!ids) {
      return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });
    }
    const qs = new URLSearchParams({ ids });
    const limit = sp.get("limit");
    if (limit) qs.set("limit", limit);

    const res = await fetch(`${backendBaseUrl()}/dashboard/public/series?${qs.toString()}`, {
      cache: "no-store",
    });
    // The backend already returns a safe, generic body for 4xx/5xx; pass its
    // status through so a bad id reads as 400 here too rather than a blanket 500.
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[api/dashboard/series]", e);
    return NextResponse.json({ ok: false, error: "Failed to fetch series" }, { status: 500 });
  }
}
