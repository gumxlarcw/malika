'use client';

import React from 'react';
import { Modal } from '@/components/ui/modal';
import { CheckIcon } from '@/components/chat/icons';

interface ChatRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  stars: number;
  setStars: (v: number) => void;
  review: string;
  setReview: (v: string) => void;
  isSubmitting: boolean;
  isSubmitted: boolean;
  onSubmit: () => void;
}

/**
 * Rating modal shown when user says "terima kasih".
 * Extracted from ChatPageClient for readability.
 */
export default function ChatRatingModal({
  isOpen,
  onClose,
  stars,
  setStars,
  review,
  setReview,
  isSubmitting,
  isSubmitted,
  onSubmit,
}: ChatRatingModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md">
      <div className="p-5">
        {isSubmitted ? (
          <div className="text-center py-6">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50">
              <CheckIcon className="h-8 w-8 text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Terima Kasih!</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Rating Anda telah disimpan.</p>
          </div>
        ) : (
          <>
            <div className="mb-4 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-950/50">
                <svg className="h-7 w-7 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bagaimana pengalaman Anda?</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Beri rating untuk membantu kami meningkatkan layanan
              </p>
            </div>

            {/* Star Rating */}
            <div className="mb-4 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setStars(star)}
                  className="p-1 transition-transform hover:scale-110 focus:outline-none"
                  title={`${star} bintang`}
                >
                  <svg
                    className={`h-10 w-10 ${
                      star <= stars
                        ? "text-yellow-400 drop-shadow-sm"
                        : "text-gray-300 dark:text-gray-600"
                    }`}
                    fill={star <= stars ? "currentColor" : "none"}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                    />
                  </svg>
                </button>
              ))}
            </div>

            {/* Rating Labels */}
            <div className="mb-4 flex justify-between px-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Buruk</span>
              <span>Baik sekali</span>
            </div>

            {/* Optional Review */}
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Ulasan (opsional)
              </label>
              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                placeholder="Ceritakan pengalaman Anda..."
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
                rows={3}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Nanti saja
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={stars < 1 || isSubmitting}
                className="flex-1 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
              >
                {isSubmitting ? "Mengirim..." : "Kirim Rating"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
