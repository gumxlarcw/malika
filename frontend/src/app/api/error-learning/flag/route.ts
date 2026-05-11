import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const malikaUid = req.headers.get('x-malika-uid') || '';

    const res = await fetch(`${BACKEND_URL}/error-learning/flag`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-malika-uid': malikaUid,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('[API] error-learning/flag POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
