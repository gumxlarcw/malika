/**
 * Centralized error message extraction utility
 * Used across all admin pages for consistent error handling
 */

type AxiosErrorLike = {
  response?: {
    status?: number;
    data?: {
      message?: unknown;
      error?: unknown;
    };
  };
};

/**
 * Extract a human-readable error message from various error types
 * Supports Axios errors, standard Error objects, and unknown error types
 * 
 * @param e - The error to extract message from
 * @param fallback - Fallback message if no specific message can be extracted
 * @returns A user-friendly error message string
 */
export function getErrorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null) {
    const maybeAxios = e as AxiosErrorLike;
    const status = maybeAxios.response?.status;
    const data = maybeAxios.response?.data;
    const msg = data?.message;
    const err = data?.error;

    // Extract message string from response data
    const text =
      typeof msg === "string" && msg
        ? msg
        : typeof err === "string" && err
        ? err
        : "";

    // Include HTTP status if available
    if (status && text) return `HTTP ${status}: ${text}`;
    if (status) return `HTTP ${status}`;
    if (text) return text;
  }

  // Handle standard Error objects
  if (e instanceof Error && e.message) {
    return e.message;
  }

  return fallback;
}

/**
 * Check if an error is an Axios error with a specific status code
 * 
 * @param e - The error to check
 * @param status - Expected HTTP status code
 * @returns true if error matches the status
 */
export function isHttpError(e: unknown, status: number): boolean {
  if (typeof e === "object" && e !== null) {
    const maybeAxios = e as AxiosErrorLike;
    return maybeAxios.response?.status === status;
  }
  return false;
}

/**
 * Extract error code from Axios response (e.g., for duplicate detection)
 * 
 * @param e - The error to extract code from
 * @returns The error code string or null
 */
export function getErrorCode(e: unknown): string | null {
  if (typeof e === "object" && e !== null) {
    const maybeAxios = e as AxiosErrorLike & {
      response?: { data?: { code?: unknown } };
    };
    const code = maybeAxios.response?.data?.code;
    if (typeof code === "string" && code) return code;
  }
  return null;
}
