import { NextRequest, NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const indikator = sp.get("indikator");
    const year = sp.get("year");
    if (!indikator || !year) {
      return NextResponse.json({ error: "Missing indikator or year" }, { status: 400 });
    }
    const qs = new URLSearchParams({ indikator, year });
    const month = sp.get("month");
    const metric = sp.get("metric");
    if (month) qs.set("month", month);
    if (metric) qs.set("metric", metric);
    const res = await fetch(`${backendBaseUrl()}/peta-tematik/public/summary?${qs.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[api/peta-tematik/summary]", e);
    return NextResponse.json({ error: "Failed to fetch summary" }, { status: 500 });
  }
}
