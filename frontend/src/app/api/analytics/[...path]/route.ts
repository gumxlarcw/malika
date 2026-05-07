import { NextRequest, NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/apiHelpers";

/**
 * Proxy analytics requests to the backend.
 * Catches /api/analytics/track, /api/analytics/heartbeat, etc.
 * This avoids direct browser→backend CORS issues.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const subPath = path.join("/");
    const body = await req.text();
    const base = backendBaseUrl();

    const res = await fetch(`${base}/analytics/${subPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
