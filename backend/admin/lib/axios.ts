import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from "axios";

/**
 * Sanitize a baseURL string for the admin axios client.
 *
 * In this deployment, /backend/* is reserved for the admin Next.js app
 * (Cloudflare ingress rule). Backend API lives at root (/auth, /datasource, ...).
 * If baseURL accidentally includes /backend, requests will hit Next.js and 404.
 *
 * Exported solely so the rule can be unit-tested. Internal callers still use
 * the singleton `api` below.
 */
export function sanitizeBaseUrl(input: string | null | undefined): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "/";

  if (raw === "/backend" || raw.startsWith("/backend/")) return "/";

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

export const api: AxiosInstance = axios.create({
  baseURL: sanitizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) || "/",
  withCredentials: true,
});

type ServerErrorBody = { code?: string; message?: string; error?: string };

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ServerErrorBody>) => {
    const status = error?.response?.status;
    const errorCode = error?.response?.data?.code;

    if (status === 401) {
      if (typeof window !== "undefined") {
        const path = window.location.pathname || "";
        if (path !== "/backend/login" && path !== "/login") {
          window.location.href = "/backend/login";
        }
      }
    }

    if (status === 403 && (errorCode === "CSRF_MISSING" || errorCode === "CSRF_INVALID")) {
      if (typeof document !== "undefined") {
        document.cookie = "csrf_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      }
    }

    return Promise.reject(error);
  }
);

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const method = (config.method || "get").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers = config.headers ?? {};
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return config;
});

export default api;
