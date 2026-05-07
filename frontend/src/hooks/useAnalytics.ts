'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';

// Session ID persisted in localStorage
const SESSION_KEY = 'malika_session_id';
const HEARTBEAT_INTERVAL = 60000; // 1 minute
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';

function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  
  let sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = generateSessionId();
    localStorage.setItem(SESSION_KEY, sessionId);
  }
  return sessionId;
}

async function trackPageView(pagePath: string, referrer?: string) {
  const sessionId = getSessionId();
  if (!sessionId) return;

  try {
    await fetch(`${BACKEND_URL}/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        pagePath,
        referrer: referrer || document.referrer || null,
      }),
      keepalive: true,
    });
  } catch (e) {
    // Silent fail - analytics should not break the app
    console.debug('[Analytics] Track failed:', e);
  }
}

export async function trackAnalyticsEvent(
  eventName: string,
  details?: Record<string, unknown>
) {
  const sessionId = getSessionId();
  if (!sessionId) return;

  const pagePath = `/event/${encodeURIComponent(eventName)}`;
  let referrer: string | null = null;
  if (typeof window !== 'undefined') {
    referrer = window.location.pathname || null;
  }

  const detailPayload = details ? JSON.stringify(details).slice(0, 1000) : null;

  try {
    await fetch(`${BACKEND_URL}/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        pagePath,
        referrer,
        details: detailPayload,
      }),
      keepalive: true,
    });
  } catch (e) {
    console.debug('[Analytics] Event track failed:', e);
  }
}

async function sendHeartbeat(pagePath: string) {
  const sessionId = getSessionId();
  if (!sessionId) return;

  try {
    await fetch(`${BACKEND_URL}/analytics/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        pagePath,
      }),
      keepalive: true,
    });
  } catch (e) {
    // Silent fail
    console.debug('[Analytics] Heartbeat failed:', e);
  }
}

/**
 * Hook to track page views and send heartbeats
 * Add to your root layout or app component
 */
export function useAnalytics() {
  const pathname = usePathname();
  const lastPathRef = useRef<string | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  const startHeartbeat = useCallback((path: string) => {
    // Clear existing heartbeat
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
    }

    // Start new heartbeat
    heartbeatRef.current = setInterval(() => {
      sendHeartbeat(path);
    }, HEARTBEAT_INTERVAL);
  }, []);

  useEffect(() => {
    // Track page view when pathname changes
    if (pathname && pathname !== lastPathRef.current) {
      trackPageView(pathname, lastPathRef.current || undefined);
      lastPathRef.current = pathname;
      startHeartbeat(pathname);
    }

    // Cleanup heartbeat on unmount
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, [pathname, startHeartbeat]);

  // Handle visibility change (pause/resume heartbeat)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && pathname) {
        // Resume tracking when tab becomes visible
        sendHeartbeat(pathname);
        startHeartbeat(pathname);
      } else if (document.visibilityState === 'hidden') {
        // Pause heartbeat when tab is hidden
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pathname, startHeartbeat]);

  return { sessionId: getSessionId() };
}

export default useAnalytics;
