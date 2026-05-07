import { NextRequest, NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q") || "";
    if (!q.trim()) {
      return NextResponse.json({ error: "Missing query (q)" }, { status: 400 });
    }
    const qs = new URLSearchParams({ q });
    const limit = sp.get("limit");
    const type = sp.get("type");
    const minScore = sp.get("min_score");
    if (limit) qs.set("limit", limit);
    if (type) qs.set("type", type);
    if (minScore) qs.set("min_score", minScore);

    const res = await fetch(
      `${backendBaseUrl()}/peta-tematik/public/indikator-search?${qs.toString()}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[api/peta-tematik/indikator-search]", e);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
