/**
 * MessageFeedback - Thumbs up/down feedback component
 * Extracted from ChatPageClient.tsx
 * 
 * Persists per-message ratings to localStorage so they survive refresh.
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { CHAT_TEXT } from "@/lib/chatConstants";

const STORAGE_KEY = "malika_msg_feedback";

/** Read persisted ratings map from localStorage */
function loadRatings(): Record<string, "up" | "down"> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Save a single rating into the persisted map */
function saveRating(messageId: string, rating: "up" | "down") {
  try {
    const map = loadRatings();
    map[messageId] = rating;
    // Keep map bounded — drop oldest entries beyond 500
    const keys = Object.keys(map);
    if (keys.length > 500) {
      for (const k of keys.slice(0, keys.length - 500)) delete map[k];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage full / private browsing — degrade silently
  }
}

export interface MessageFeedbackProps {
  messageId: string;
  onFeedback?: (id: string, rating: "up" | "down") => void;
}

export function MessageFeedback({ messageId, onFeedback }: MessageFeedbackProps) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);

  // Restore persisted rating on mount / messageId change
  useEffect(() => {
    const saved = loadRatings()[messageId];
    if (saved) setRating(saved);
  }, [messageId]);

  const handleRating = useCallback((r: "up" | "down") => {
    setRating(r);
    saveRating(messageId, r);
    onFeedback?.(messageId, r);
  }, [messageId, onFeedback]);

  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-0.5">
        {CHAT_TEXT.feedbackLabel}
      </span>
      <button
        type="button"
        onClick={() => handleRating("up")}
        disabled={rating !== null}
        aria-label={CHAT_TEXT.feedbackHelpful}
        className={`p-2 rounded-lg transition-all min-h-[44px] min-w-[44px] flex items-center justify-center ${
          rating === "up"
            ? "text-green-500 bg-green-50 dark:bg-green-950/50"
            : rating === null
              ? "text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/50"
              : "text-gray-300 dark:text-gray-600"
        }`}
        title={CHAT_TEXT.feedbackHelpful}
      >
        <svg
          className="h-5 w-5"
          fill={rating === "up" ? "currentColor" : "none"}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => handleRating("down")}
        disabled={rating !== null}
        aria-label={CHAT_TEXT.feedbackNotHelpful}
        className={`p-2 rounded-lg transition-all min-h-[44px] min-w-[44px] flex items-center justify-center ${
          rating === "down"
            ? "text-red-500 bg-red-50 dark:bg-red-950/50"
            : rating === null
              ? "text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50"
              : "text-gray-300 dark:text-gray-600"
        }`}
        title={CHAT_TEXT.feedbackNotHelpful}
      >
        <svg
          className="h-5 w-5"
          fill={rating === "down" ? "currentColor" : "none"}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"
          />
        </svg>
      </button>
      {rating && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">
          {CHAT_TEXT.feedbackThanks}
        </span>
      )}
    </div>
  );
}

export default MessageFeedback;
