import { NextRequest, NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const indikator = req.nextUrl.searchParams.get("indikator");
    if (!indikator) return NextResponse.json({ error: "Missing indikator" }, { status: 400 });
    const res = await fetch(
      `${backendBaseUrl()}/peta-tematik/public/metrics?indikator=${encodeURIComponent(indikator)}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[api/peta-tematik/metrics]", e);
    return NextResponse.json({ error: "Failed to fetch metrics" }, { status: 500 });
  }
}
