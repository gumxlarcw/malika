import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numId = parseInt(id, 10);
    
    if (!numId || !Number.isFinite(numId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const res = await fetch(`${BACKEND_URL}/search/knowledge/${numId}`, {
      cache: "no-store",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      throw new Error(`Backend error: ${res.status}`);
    }

    const data = await res.json();
    
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] knowledge/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch document" },
      { status: 500 }
    );
  }
}
