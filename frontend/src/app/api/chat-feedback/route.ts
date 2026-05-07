import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const malikaUid = req.headers.get('x-malika-uid') || '';

    const res = await fetch(`${BACKEND_URL}/chat-feedback`, {
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
    console.error('[API] chat-feedback POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get('thread_id');
    const malikaUid = req.headers.get('x-malika-uid') || '';

    if (!threadId) {
      return NextResponse.json({ ok: false, error: 'thread_id required' }, { status: 400 });
    }

    const res = await fetch(`${BACKEND_URL}/chat-feedback/thread/${threadId}`, {
      headers: {
        'x-malika-uid': malikaUid,
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('[API] chat-feedback GET error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
