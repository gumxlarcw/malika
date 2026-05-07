"use client";

/**
 * Next.js Global Error Boundary
 *
 * Catches unhandled client-side exceptions that would otherwise show
 * the generic "Application error" page. Provides a recovery button
 * and attempts to log the error to the backend for remote debugging.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Best-effort remote error logging (fire-and-forget)
  if (typeof window !== "undefined") {
    try {
      const payload = {
        message: error?.message || "Unknown error",
        stack: error?.stack?.slice(0, 2000) || "",
        digest: error?.digest || "",
        url: window.location.href,
        ua: navigator.userAgent,
        ts: new Date().toISOString(),
      };
      // Log to console for developers with DevTools access
      console.error("[GlobalError]", payload);
      // Attempt to send to backend (best-effort, no await)
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {
      // Silent — this is the error boundary itself
    }
  }

  return (
    <html lang="id">
      <body className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-md text-center">
          <div className="mb-6 text-6xl">⚠️</div>
          <h1 className="mb-2 text-xl font-bold text-gray-800 dark:text-white">
            Terjadi Kesalahan
          </h1>
          <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
            MALIKA mengalami gangguan sementara. Silakan coba lagi.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => reset()}
              className="rounded-lg bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-600 transition"
            >
              Coba Lagi
            </button>
            <button
              onClick={() => {
                // Clear all caches and force reload
                if (typeof caches !== "undefined") {
                  caches.keys().then((keys) =>
                    Promise.all(keys.map((k) => caches.delete(k)))
                  ).finally(() => location.reload());
                } else {
                  location.reload();
                }
              }}
              className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition"
            >
              Bersihkan Cache &amp; Muat Ulang
            </button>
          </div>
          {error?.message && (
            <details className="mt-6 text-left">
              <summary className="cursor-pointer text-xs text-gray-400">
                Detail teknis
              </summary>
              <pre className="mt-2 max-h-32 overflow-auto rounded bg-gray-100 p-2 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                {error.message}
              </pre>
            </details>
          )}
        </div>
      </body>
    </html>
  );
}
