/* eslint-disable no-restricted-globals */

const CACHE_VERSION = "v1";
const STATIC_CACHE = `malika-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `malika-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PREFS_CACHE = "malika-prefs-v1";
const PREFS_URL = "/__pwa_prefs__/notifications";
const DEFAULT_PREFS = {
  enabled: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
};

async function readNotificationPrefs() {
  try {
    const cache = await caches.open(PREFS_CACHE);
    const res = await cache.match(PREFS_URL);
    if (!res) return DEFAULT_PREFS;
    const json = await res.json();
    return { ...DEFAULT_PREFS, ...(json || {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function parseTimeToMinutes(value) {
  if (!value || typeof value !== "string") return null;
  const [h, m] = value.split(":").map((part) => parseInt(part, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function isWithinQuietHours(prefs) {
  if (!prefs || !prefs.quietHoursEnabled) return false;
  const start = parseTimeToMinutes(prefs.quietHoursStart);
  const end = parseTimeToMinutes(prefs.quietHoursEnd);
  if (start === null || end === null) return false;

  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();

  if (start === end) return true;
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .finally(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (![STATIC_CACHE, RUNTIME_CACHE].includes(key)) {
              return caches.delete(key);
            }
            return undefined;
          })
        )
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Some browsers/devices may fail event.data.json() even when the payload is JSON.
    // Try parsing text as JSON before falling back.
    try {
      const text = event.data ? event.data.text() : "";
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { title: "Notifikasi", body: event.data ? event.data.text() : "" };
    }
  }

  const title = payload.title || "Notifikasi";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/images/pwa/icon-192.png",
    badge: payload.badge || "/images/pwa/icon-96.png",
    image: payload.image || undefined,
    data: {
      url: payload.url || "/notifications",
      receivedAt: Date.now(),
    },
    tag: payload.tag || undefined,
    renotify: false,
  };

  event.waitUntil(
    Promise.resolve()
      .then(async () => {
        const prefs = await readNotificationPrefs();
        if (prefs && prefs.enabled === false) return;
        if (isWithinQuietHours(prefs)) return;
        await self.registration.showNotification(title, options);
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification && event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === url && "focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
        return undefined;
      })
      .then(() => {
        if (self.registration && typeof self.registration.clearAppBadge === "function") {
          return self.registration.clearAppBadge();
        }
        return undefined;
      })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  if (!isSameOrigin) return;

  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/images/") || url.pathname.startsWith("/public/")) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
            return res;
          })
          .catch(() => cached)
      )
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
        return res;
      })
      .catch(() => caches.match(req))
  );
});
