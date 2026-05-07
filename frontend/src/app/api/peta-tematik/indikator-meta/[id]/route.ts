import { NextRequest, NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const res = await fetch(
      `${backendBaseUrl()}/peta-tematik/public/indikator-meta/${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[api/peta-tematik/indikator-meta]", e);
    return NextResponse.json({ error: "Failed to fetch indikator meta" }, { status: 500 });
  }
}
