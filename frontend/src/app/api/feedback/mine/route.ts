import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

export async function GET(req: NextRequest) {
  try {
    const malikaUid = req.headers.get('x-malika-uid') || '';

    const res = await fetch(`${BACKEND_URL}/chat-feedback/mine`, {
      headers: {
        'x-malika-uid': malikaUid,
      },
      cache: 'no-store',
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('[API] feedback/mine GET error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
