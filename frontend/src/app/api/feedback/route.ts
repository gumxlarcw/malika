import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit') || '100';
    const offset = searchParams.get('offset') || '0';
    const stars = searchParams.get('stars') || '';

    let url = `${BACKEND_URL}/chat-feedback/all?limit=${limit}&offset=${offset}`;
    if (stars) {
      url += `&stars=${stars}`;
    }

    const res = await fetch(url, {
      cache: 'no-store',
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('[API] feedback GET error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const malikaUid = req.headers.get('x-malika-uid') || '';

    const res = await fetch(`${BACKEND_URL}/chat-feedback/general`, {
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
    console.error('[API] feedback POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
