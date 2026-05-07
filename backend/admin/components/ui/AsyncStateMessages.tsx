"use client";

import React from "react";
import Alert from "../Alert";
import LoadingSpinner from "../LoadingSpinner";

export type AsyncStateMessagesProps = {
  loading?: boolean;
  loadingLabel?: string;
  error?: string;
  success?: string;
  onClearError?: () => void;
  onClearSuccess?: () => void;
};

/**
 * Displays loading spinner, error alert, and success alert based on async state.
 * Can be used with useAsyncState hook.
 */
export default function AsyncStateMessages({
  loading,
  loadingLabel,
  error,
  success,
}: AsyncStateMessagesProps) {
  return (
    <>
      {loading && <LoadingSpinner label={loadingLabel} />}
      {error && (
        <Alert variant="error">
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success">
          {success}
        </Alert>
      )}
    </>
  );
}
