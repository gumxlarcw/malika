import axios from "axios";

function sanitizeBaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "/";

  // In this deployment, /backend/* is reserved for the Admin Next.js app.
  // Backend API is served from root (/auth, /datasource, etc). If baseURL
  // accidentally includes /backend, requests will hit Next and 404.
  if (raw === "/backend" || raw.startsWith("/backend/")) return "/";

  // Handle absolute URLs that might accidentally include a /backend basePath.
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.pathname === "/backend" || u.pathname.startsWith("/backend/")) {
        u.pathname = "/";
      }
      return u.toString().replace(/\/$/, "");
    } catch {
      return "/";
    }
  }

  return raw;
}

export const api = axios.create({
  // Use same-origin relative base so Cloudflared ingress routes correctly:
  // - /backend/* -> Next.js (admin)
  // - other paths -> Backend API
  baseURL: sanitizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) || "/",
  withCredentials: true,
});

// Attach interceptors for auth and error UX
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const errorCode = error?.response?.data?.code;
    
    if (status === 401) {
      // Redirect to login when unauthorized
      if (typeof window !== "undefined") {
        // Avoid infinite loops: don't redirect if we're already on login
        const path = window.location.pathname || "";
        if (path === "/backend/login" || path === "/login") {
          return Promise.reject(error);
        }

        // Force basePath to avoid being routed to backend (Cloudflared only forwards /backend/* to Next)
        window.location.href = "/backend/login";
      }
    }
    
    // Handle CSRF errors - refresh token and retry once
    if (status === 403 && (errorCode === "CSRF_MISSING" || errorCode === "CSRF_INVALID")) {
      // Clear stale CSRF token and let user retry
      if (typeof document !== "undefined") {
        document.cookie = "csrf_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      }
      // Don't auto-retry, just reject - user action will trigger new request with fresh token
    }
    
    // Optionally surface a generic message; let pages handle specifics
    return Promise.reject(error);
  }
);

/**
 * Get CSRF token from cookie
 */
function getCsrfToken() {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

api.interceptors.request.use((config) => {
  // Attach CSRF token for state-changing requests
  const method = (config.method || "get").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers = config.headers || {};
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return config;
});
