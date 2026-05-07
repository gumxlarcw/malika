import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// NOTE: Cloudflared routing decides whether a request hits Next.js at all.
// Redirecting here cannot fix requests that never reach Next (e.g. /login on the host).
// Keep this proxy as a no-op to avoid basePath double-prefix redirect loops.
export function proxy(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next).*)'],
};
