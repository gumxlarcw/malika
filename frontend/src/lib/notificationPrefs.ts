export type NotificationPrefs = {
  enabled: boolean;
  updates: boolean;
  alerts: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: false,
  updates: true,
  alerts: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
};

const STORAGE_KEY = "pwa_notification_prefs_v1";
const PREFS_CACHE = "malika-prefs-v1";
const PREFS_URL = "/__pwa_prefs__/notifications";

function sanitizePrefs(next: Partial<NotificationPrefs>): NotificationPrefs {
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...next,
    quietHoursStart: next.quietHoursStart || DEFAULT_NOTIFICATION_PREFS.quietHoursStart,
    quietHoursEnd: next.quietHoursEnd || DEFAULT_NOTIFICATION_PREFS.quietHoursEnd,
  };
}

export function readNotificationPrefs(): NotificationPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIFICATION_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return sanitizePrefs(parsed);
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function persistNotificationPrefs(prefs: NotificationPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export async function syncNotificationPrefsToCache(prefs: NotificationPrefs) {
  if (typeof window === "undefined") return;
  try {
    if (!("caches" in window)) return;
    const cache = await caches.open(PREFS_CACHE);
    await cache.put(
      PREFS_URL,
      new Response(JSON.stringify(prefs), {
        headers: { "content-type": "application/json" },
      })
    );
  } catch {
    // ignore
  }
}

export async function writeNotificationPrefs(next: Partial<NotificationPrefs>) {
  const merged = sanitizePrefs({ ...readNotificationPrefs(), ...next });
  persistNotificationPrefs(merged);
  await syncNotificationPrefsToCache(merged);
  return merged;
}
