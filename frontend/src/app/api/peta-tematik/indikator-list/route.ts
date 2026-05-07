import { NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const res = await fetch(`${backendBaseUrl()}/peta-tematik/public/indikator-list`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[api/peta-tematik/indikator-list]", e);
    return NextResponse.json({ error: "Failed to fetch indikator list" }, { status: 500 });
  }
}
