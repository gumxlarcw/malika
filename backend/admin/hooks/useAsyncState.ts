"use client";

import { useState, useCallback } from "react";

export type AsyncState = {
  loading: boolean;
  error: string;
  success: string;
};

export type UseAsyncStateReturn = AsyncState & {
  setLoading: (value: boolean) => void;
  setError: (message: string) => void;
  setSuccess: (message: string) => void;
  clearMessages: () => void;
  reset: () => void;
  startLoading: () => void;
  finishWithError: (message: string) => void;
  finishWithSuccess: (message: string) => void;
};

/**
 * Hook for managing loading/error/success states commonly used in async operations.
 * Reduces boilerplate across pages that handle API calls.
 */
export function useAsyncState(initialLoading = false): UseAsyncStateReturn {
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const clearMessages = useCallback(() => {
    setError("");
    setSuccess("");
  }, []);

  const reset = useCallback(() => {
    setLoading(false);
    setError("");
    setSuccess("");
  }, []);

  const startLoading = useCallback(() => {
    setLoading(true);
    setError("");
    setSuccess("");
  }, []);

  const finishWithError = useCallback((message: string) => {
    setLoading(false);
    setError(message);
    setSuccess("");
  }, []);

  const finishWithSuccess = useCallback((message: string) => {
    setLoading(false);
    setError("");
    setSuccess(message);
  }, []);

  return {
    loading,
    error,
    success,
    setLoading,
    setError,
    setSuccess,
    clearMessages,
    reset,
    startLoading,
    finishWithError,
    finishWithSuccess,
  };
}

/**
 * Wrapper hook for executing async functions with automatic loading state management.
 */
export function useAsyncAction<T extends unknown[], R>(
  action: (...args: T) => Promise<R>,
  options?: {
    onSuccess?: (result: R) => void;
    onError?: (error: unknown) => void;
    successMessage?: string | ((result: R) => string);
    errorMessage?: string;
  }
): {
  execute: (...args: T) => Promise<R | undefined>;
  state: UseAsyncStateReturn;
} {
  const state = useAsyncState();

  const execute = useCallback(
    async (...args: T): Promise<R | undefined> => {
      state.startLoading();
      try {
        const result = await action(...args);
        const msg =
          typeof options?.successMessage === "function"
            ? options.successMessage(result)
            : options?.successMessage || "";
        if (msg) {
          state.finishWithSuccess(msg);
        } else {
          state.setLoading(false);
        }
        options?.onSuccess?.(result);
        return result;
      } catch (e) {
        const msg = options?.errorMessage || getErrorMessageFromUnknown(e);
        state.finishWithError(msg);
        options?.onError?.(e);
        return undefined;
      }
    },
    [action, options, state]
  );

  return { execute, state };
}

// Helper to extract error message from unknown error
function getErrorMessageFromUnknown(e: unknown): string {
  if (typeof e === "object" && e) {
    const maybeAxios = e as {
      response?: { data?: { message?: unknown; error?: unknown } };
      message?: string;
    };
    if (maybeAxios.response?.data?.message) {
      return String(maybeAxios.response.data.message);
    }
    if (maybeAxios.response?.data?.error) {
      return String(maybeAxios.response.data.error);
    }
    if (maybeAxios.message) {
      return maybeAxios.message;
    }
  }
  if (e instanceof Error) {
    return e.message;
  }
  return "Terjadi kesalahan";
}
