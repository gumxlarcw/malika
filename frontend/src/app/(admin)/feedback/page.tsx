"use client";
import React, { useEffect, useState, useCallback } from "react";
import LoadingProgressBar from "@/components/LoadingProgressBar";

interface FeedbackItem {
  id: number;
  thread_id: number;
  owner_id: string | null;
  stars: number;
  review: string | null;
  thread_title: string | null;
  created_at: string;
}

interface FeedbackStats {
  avg_stars: string;
  total_count: number;
  distribution: Record<number, number>;
}

// Get or create unique device ID
function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("malika_uid");
  if (!id) {
    id = `device_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem("malika_uid", id);
  }
  return id;
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <StarIcon
          key={star}
          className={`h-4 w-4 ${
            star <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "fill-gray-200 text-gray-200 dark:fill-gray-700 dark:text-gray-700"
          }`}
        />
      ))}
    </div>
  );
}

function InteractiveStarRating({
  rating,
  onRate,
  size = "md",
}: {
  rating: number;
  onRate: (stars: number) => void;
  size?: "sm" | "md" | "lg";
}) {
  const [hoverRating, setHoverRating] = useState(0);
  const sizeClasses = {
    sm: "h-5 w-5",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onRate(star)}
          onMouseEnter={() => setHoverRating(star)}
          onMouseLeave={() => setHoverRating(0)}
          className="focus:outline-none transition-transform hover:scale-110"
        >
          <StarIcon
            className={`${sizeClasses[size]} transition-colors ${
              star <= (hoverRating || rating)
                ? "fill-yellow-400 text-yellow-400"
                : "fill-gray-300 text-gray-300 dark:fill-gray-600 dark:text-gray-600"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
  onClick,
  active,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-4 transition-all ${
        onClick ? "cursor-pointer hover:shadow-md" : ""
      } ${
        active
          ? "border-blue-500 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/30"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      }`}
    >
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{value}</div>
      {subtext && <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{subtext}</div>}
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FeedbackPage() {
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starFilter, setStarFilter] = useState<number | null>(null);

  // User's own feedback
  const [myFeedback, setMyFeedback] = useState<FeedbackItem | null>(null);
  const [myStars, setMyStars] = useState(0);
  const [myReview, setMyReview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [deviceId, setDeviceId] = useState("");

  // Initialize device ID
  useEffect(() => {
    setDeviceId(getDeviceId());
  }, []);

  // Fetch user's feedback
  useEffect(() => {
    if (!deviceId) return;

    const fetchMyFeedback = async () => {
      try {
        const res = await fetch("/api/feedback/mine", {
          headers: { "x-malika-uid": deviceId },
        });
        const data = await res.json();
        if (data?.ok && data.feedback) {
          setMyFeedback(data.feedback);
          setMyStars(data.feedback.stars);
          setMyReview(data.feedback.review || "");
        }
      } catch {
        // Ignore - user just hasn't submitted yet
      }
    };

    fetchMyFeedback();
  }, [deviceId]);

  // Fetch all feedbacks
  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = "/api/feedback";
      if (starFilter) {
        url += `?stars=${starFilter}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data?.ok) {
        setFeedbacks(data.feedbacks || []);
        setStats(data.stats || null);
      } else {
        setError(data?.error || "Gagal memuat feedback");
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Gagal memuat feedback";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [starFilter]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  // Submit feedback
  const handleSubmit = async () => {
    if (myStars === 0) return;

    setSubmitting(true);
    setSubmitSuccess(false);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-malika-uid": deviceId,
        },
        body: JSON.stringify({ stars: myStars, review: myReview }),
      });

      const data = await res.json();
      if (data?.ok) {
        setMyFeedback(data.feedback);
        setSubmitSuccess(true);
        setIsEditing(false);
        // Refresh list
        fetchFeedback();
      } else {
        setError(data?.error || "Gagal mengirim feedback");
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Gagal mengirim feedback";
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Star filter click
  const handleFilterClick = (stars: number) => {
    if (starFilter === stars) {
      setStarFilter(null); // Clear filter
    } else {
      setStarFilter(stars);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Feedback Pengguna
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Ulasan dan rating dari pengguna Chat MALIKA
          </p>
        </div>

        {/* User Feedback Section */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-indigo-950/30">
          <h2 className="mb-3 text-lg font-semibold text-gray-800 dark:text-white">
            {myFeedback && !isEditing ? "Feedback Anda" : "Berikan Feedback Anda"}
          </h2>

          {myFeedback && !isEditing ? (
            // Show existing feedback
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <StarRating rating={myFeedback.stars} />
                <span className="text-lg font-medium text-gray-800 dark:text-white">
                  {myFeedback.stars}/5
                </span>
              </div>
              {myFeedback.review && (
                <p className="text-sm text-gray-700 dark:text-gray-300 italic">
                  &quot;{myFeedback.review}&quot;
                </p>
              )}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setIsEditing(true)}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Edit Feedback
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Dikirim {formatDate(myFeedback.created_at)}
                </span>
              </div>
            </div>
          ) : (
            // Show form
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Rating *
                </label>
                <InteractiveStarRating rating={myStars} onRate={setMyStars} size="lg" />
                {myStars > 0 && (
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {myStars === 5
                      ? "Sangat Puas! 🎉"
                      : myStars === 4
                        ? "Puas 😊"
                        : myStars === 3
                          ? "Cukup 🙂"
                          : myStars === 2
                            ? "Kurang Puas 😕"
                            : "Tidak Puas 😔"}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Ulasan (opsional)
                </label>
                <textarea
                  value={myReview}
                  onChange={(e) => setMyReview(e.target.value)}
                  placeholder="Ceritakan pengalaman Anda menggunakan MALIKA..."
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={myStars === 0 || submitting}
                  className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting
                    ? "Mengirim..."
                    : myFeedback
                      ? "Simpan Perubahan"
                      : "Kirim Feedback"}
                </button>
                {isEditing && (
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setMyStars(myFeedback?.stars || 0);
                      setMyReview(myFeedback?.review || "");
                    }}
                    className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    Batal
                  </button>
                )}
              </div>

              {submitSuccess && (
                <div className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400">
                  ✓ Feedback berhasil disimpan. Terima kasih!
                </div>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <LoadingProgressBar label="Memuat feedback..." />
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : (
          <>
            {/* Stats */}
            {stats && (
              <div className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Statistik & Filter
                  </h2>
                  {starFilter && (
                    <button
                      onClick={() => setStarFilter(null)}
                      className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Hapus Filter
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  <StatCard
                    label="Rating Rata-rata"
                    value={`${stats.avg_stars} ⭐`}
                    subtext="dari 5 bintang"
                  />
                  <StatCard
                    label="Total Feedback"
                    value={stats.total_count}
                    subtext="ulasan diterima"
                    onClick={() => setStarFilter(null)}
                    active={starFilter === null}
                  />
                  {[5, 4, 3, 2, 1].map((star) => (
                    <StatCard
                      key={star}
                      label={`${star} Bintang`}
                      value={stats.distribution?.[star] || 0}
                      subtext={star >= 4 ? "puas" : star === 3 ? "cukup" : "perlu evaluasi"}
                      onClick={() => handleFilterClick(star)}
                      active={starFilter === star}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Distribution Chart */}
            {stats && stats.total_count > 0 && (
              <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="mb-4 text-sm font-semibold text-gray-800 dark:text-white">
                  Distribusi Rating
                </h2>
                <div className="space-y-2">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = stats.distribution?.[star] || 0;
                    const pct = stats.total_count > 0 ? (count / stats.total_count) * 100 : 0;
                    const isActive = starFilter === star;
                    return (
                      <div
                        key={star}
                        onClick={() => handleFilterClick(star)}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg p-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                          isActive ? "bg-blue-50 dark:bg-blue-950/30" : ""
                        }`}
                      >
                        <span className="w-8 text-sm font-medium text-gray-700 dark:text-gray-300">
                          {star}⭐
                        </span>
                        <div className="h-6 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className={`h-full transition-all duration-500 ${
                              isActive ? "bg-blue-500" : "bg-yellow-400"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-20 text-right text-sm text-gray-500 dark:text-gray-400">
                          {count} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Feedback List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
                  Ulasan {starFilter ? `(${starFilter} Bintang)` : "Terbaru"}
                </h2>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {feedbacks.length} ulasan
                </span>
              </div>
              {feedbacks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {starFilter
                    ? `Belum ada feedback dengan rating ${starFilter} bintang.`
                    : "Belum ada feedback dari pengguna."}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {feedbacks.map((f) => (
                    <div
                      key={f.id}
                      className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <StarRating rating={f.stars} />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                              {f.stars}/5
                            </span>
                          </div>
                          {f.review && (
                            <p className="mt-2 line-clamp-3 text-sm text-gray-700 dark:text-gray-300">
                              {f.review}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            {f.thread_title && (
                              <span className="rounded bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
                                {f.thread_title}
                              </span>
                            )}
                            <span>{formatDate(f.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
