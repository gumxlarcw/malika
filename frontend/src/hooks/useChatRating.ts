"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseChatRatingOptions {
  /**
   * Called when rating modal should be closed
   */
  onClose?: () => void;
}

interface UseChatRatingReturn {
  /**
   * Whether the rating modal is open
   */
  isOpen: boolean;
  /**
   * Open the rating modal for a specific thread
   */
  openRating: (threadId: number, threadTitle?: string) => void;
  /**
   * Close the rating modal
   */
  closeRating: () => void;
  /**
   * Current star rating (1-5)
   */
  stars: number;
  /**
   * Set the star rating
   */
  setStars: (stars: number) => void;
  /**
   * Review text
   */
  review: string;
  /**
   * Set the review text
   */
  setReview: (review: string) => void;
  /**
   * Whether rating is being submitted
   */
  isSubmitting: boolean;
  /**
   * Whether rating was successfully submitted
   */
  isSubmitted: boolean;
  /**
   * Submit the rating
   */
  submitRating: () => Promise<void>;
  /**
   * Check if message is a "thank you" pattern
   */
  isThankYouMessage: (text: string) => boolean;
  /**
   * Whether user already has feedback
   */
  hasExistingFeedback: boolean;
  /**
   * Check if user already has feedback (call on mount)
   */
  checkExistingFeedback: () => Promise<void>;
  /**
   * Reference for pending thank you message
   */
  pendingThankYouRef: React.MutableRefObject<boolean>;
}

/**
 * Hook for managing chat rating/feedback flow
 * Triggered when user says "terima kasih" / "thank you"
 */
export function useChatRating(options: UseChatRatingOptions = {}): UseChatRatingReturn {
  const { onClose } = options;
  
  const [isOpen, setIsOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [threadTitle, setThreadTitle] = useState("");
  const [threadId, setThreadId] = useState<number | null>(null);
  const [hasExistingFeedback, setHasExistingFeedback] = useState(false);
  
  const pendingThankYouRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if user already has feedback
  const checkExistingFeedback = useCallback(async () => {
    const uid = localStorage.getItem("malika_uid");
    if (!uid) return;
    try {
      const res = await fetch("/api/feedback/mine", {
        headers: { "x-malika-uid": uid },
      });
      const data = await res.json();
      if (data?.ok && data.feedback) {
        setHasExistingFeedback(true);
      }
    } catch {
      // If check fails, assume feedback exists to prevent duplicate auto-prompts
      setHasExistingFeedback(true);
    }
  }, []);

  // Helper: detect "terima kasih" / thank you pattern
  const isThankYouMessage = useCallback((text: string) => {
    const lower = String(text || "").toLowerCase().trim();
    // Patterns: terima kasih, makasih, thanks, thank you, thx, ty
    return /terima\s*kasih|makasih|matur\s*nuwun|thanks|thank\s*you|thx|ty/i.test(lower);
  }, []);

  const openRating = useCallback((id: number, title?: string) => {
    setThreadId(id);
    setThreadTitle(title || "Chat");
    setIsOpen(true);
  }, []);

  const closeRating = useCallback(() => {
    setIsOpen(false);
    // Reset for next time
    setStars(0);
    setReview("");
    setIsSubmitted(false);
    setThreadTitle("");
    setThreadId(null);
    onClose?.();
  }, [onClose]);

  // Submit rating to backend
  const submitRating = useCallback(async () => {
    if (!threadId || stars < 1) return;
    
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/chat-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          stars,
          review: review.trim() || null,
          thread_title: threadTitle || "Chat",
        }),
      });
      if (res.ok) {
        setIsSubmitted(true);
        // Close modal after a brief success message
        closeTimerRef.current = setTimeout(() => {
          closeTimerRef.current = null;
          closeRating();
        }, 1500);
      }
    } catch (e) {
      console.error("Failed to submit rating:", e);
    } finally {
      setIsSubmitting(false);
    }
  }, [threadId, stars, review, threadTitle, closeRating]);

  // Cleanup close timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    };
  }, []);

  return {
    isOpen,
    openRating,
    closeRating,
    stars,
    setStars,
    review,
    setReview,
    isSubmitting,
    isSubmitted,
    submitRating,
    isThankYouMessage,
    hasExistingFeedback,
    checkExistingFeedback,
    pendingThankYouRef,
  };
}
