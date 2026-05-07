import { NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const res = await fetch(`${backendBaseUrl()}/geojson/peta_kabko_malut.geojson`, {
      cache: "force-cache",
      next: { revalidate: 86400 }, // 1 day — geo polygons are static
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const text = await res.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "application/geo+json",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (e) {
    console.error("[api/peta-tematik/geojson]", e);
    return NextResponse.json({ error: "Failed to fetch geojson" }, { status: 500 });
  }
}
