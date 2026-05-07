import type { NotificationItem } from "@/lib/notifications.data";

const STORAGE_KEY = "malika_notifications_last_seen_id_v1";
const STORAGE_KEY_AT = "malika_notifications_last_seen_at_v1";

function toNumberId(id: string | number | null | undefined) {
  const n = typeof id === "number" ? id : Number(id);
  return Number.isFinite(n) ? n : 0;
}

export function getLastSeenNotificationId() {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function setLastSeenNotificationId(id: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // ignore
  }
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getLastSeenNotificationAt() {
  if (typeof window === "undefined") return null as Date | null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_AT);
    return parseIsoDate(raw);
  } catch {
    return null;
  }
}

export function ensureLastSeenNotificationAtInitialized(fallback?: Date) {
  const existing = getLastSeenNotificationAt();
  if (existing) return existing;
  const dt = fallback && !Number.isNaN(fallback.getTime()) ? fallback : new Date();
  setLastSeenNotificationAt(dt);
  return dt;
}

export function setLastSeenNotificationAt(dt: Date) {
  if (typeof window === "undefined") return;
  try {
    const safe = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
    if (!safe) return;
    window.localStorage.setItem(STORAGE_KEY_AT, safe);
  } catch {
    // ignore
  }
}

export function maxNotificationId(items: NotificationItem[]) {
  return items.reduce((max, it) => Math.max(max, toNumberId(it.id)), 0);
}

export function maxNotificationCreatedAt(items: NotificationItem[]) {
  let maxMs = 0;
  for (const it of items) {
    const d = parseIsoDate(it.createdAt || null);
    if (!d) continue;
    const ms = d.getTime();
    if (ms > maxMs) maxMs = ms;
  }
  return maxMs > 0 ? new Date(maxMs) : null;
}

export function unreadCount(items: NotificationItem[], lastSeenId: number) {
  const seen = Number.isFinite(lastSeenId) ? lastSeenId : 0;
  return items.reduce((count, it) => count + (toNumberId(it.id) > seen ? 1 : 0), 0);
}

export function unreadCountByTime(items: NotificationItem[], lastSeenAt: Date | null) {
  // If user has never opened notifications UI (no baseline), don't show badge for historical backfill.
  if (!lastSeenAt) return 0;
  const seenMs = lastSeenAt.getTime();
  return items.reduce((count, it) => {
    const d = parseIsoDate(it.createdAt || null);
    if (!d) return count;
    return count + (d.getTime() > seenMs ? 1 : 0);
  }, 0);
}

export async function setAppBadgeSafe(count: number) {
  if (typeof navigator === "undefined") return;
  const n = Math.max(0, Number(count) || 0);
  try {
    const anyNav = navigator as any;
    if (typeof anyNav.setAppBadge === "function") {
      await anyNav.setAppBadge(n);
    }
  } catch {
    // ignore
  }
}

export async function clearAppBadgeSafe() {
  if (typeof navigator === "undefined") return;
  try {
    const anyNav = navigator as any;
    if (typeof anyNav.clearAppBadge === "function") {
      await anyNav.clearAppBadge();
    }
  } catch {
    // ignore
  }
}
