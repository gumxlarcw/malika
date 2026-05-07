/**
 * Client Error Logger — receives error reports from global-error.tsx
 * Writes to server console so we can see mobile errors in PM2 logs.
 */
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.error("[CLIENT-ERROR]", JSON.stringify({
      message: body.message || "?",
      digest: body.digest || "",
      url: body.url || "",
      ua: body.ua || "",
      stack: (body.stack || "").slice(0, 500),
      ts: body.ts || new Date().toISOString(),
    }));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
