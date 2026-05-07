'use client';

import { useAnalytics } from '@/hooks/useAnalytics';

/**
 * Analytics tracker component
 * Renders nothing, just tracks page views and sends heartbeats
 */
export default function AnalyticsTracker() {
  useAnalytics();
  return null;
}
