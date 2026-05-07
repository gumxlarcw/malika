type QueuedRequest = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  ts: number;
};

type QueueState = {
  size: number;
  syncing: boolean;
  lastSyncAt: string | null;
};

const STORAGE_KEY = "malika-offline-queue-v1";
let syncing = false;
let lastSyncAt: string | null = null;
const listeners = new Set<(state: QueueState) => void>();

function isBrowser() {
  return typeof window !== "undefined";
}

function readQueue(): QueuedRequest[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedRequest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(next: QueuedRequest[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function notify() {
  const state: QueueState = {
    size: readQueue().length,
    syncing,
    lastSyncAt,
  };
  listeners.forEach((cb) => cb(state));
  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent("malika:offline-queue", { detail: state }));
  }
}

export function getQueueState(): QueueState {
  return {
    size: readQueue().length,
    syncing,
    lastSyncAt,
  };
}

export function subscribeQueueState(cb: (state: QueueState) => void) {
  listeners.add(cb);
  cb(getQueueState());
  return () => {
    listeners.delete(cb);
  };
}

export function enqueueRequest(item: Omit<QueuedRequest, "id" | "ts">) {
  const next = readQueue();
  next.push({
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ts: Date.now(),
  });
  writeQueue(next);
  notify();
}

export async function flushQueue(fetchImpl: typeof fetch) {
  if (!isBrowser()) return;
  const pending = readQueue();
  if (pending.length === 0) return;

  syncing = true;
  notify();

  const remaining: QueuedRequest[] = [];

  for (const item of pending) {
    try {
      const res = await fetchImpl(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      });
      if (!res.ok) {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  syncing = false;
  lastSyncAt = new Date().toISOString();
  writeQueue(remaining);
  notify();
}
