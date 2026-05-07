"use client";
import React, { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import LoadingSpinner from "@/components/LoadingSpinner";
import { StatCard } from "@/components/StatCard";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/formatters";

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

function FeedbackPageContent() {
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFeedback = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get("/chat-feedback/all");
        if (res.data?.ok) {
          setFeedbacks(res.data.feedbacks || []);
          setStats(res.data.stats || null);
        } else {
          setError(res.data?.error || "Gagal memuat feedback");
        }
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Gagal memuat feedback"));
      } finally {
        setLoading(false);
      }
    };

    fetchFeedback();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Feedback Pengguna
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ulasan dan rating dari pengguna Chat MALIKA
        </p>
      </div>

      {loading ? (
        <LoadingSpinner label="Memuat feedback..." />
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      ) : (
        <>
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                title="Rating Rata-rata"
                value={`${stats.avg_stars} ⭐`}
                subtitle="dari 5 bintang"
              />
              <StatCard
                title="Total Feedback"
                value={stats.total_count}
                subtitle="ulasan diterima"
              />
              <StatCard
                title="Rating 5 Bintang"
                value={stats.distribution?.[5] || 0}
                subtitle="pengguna puas"
                variant="primary"
              />
              <StatCard
                title="Rating Rendah"
                value={(stats.distribution?.[1] || 0) + (stats.distribution?.[2] || 0)}
                subtitle="perlu evaluasi"
                variant={(stats.distribution?.[1] || 0) + (stats.distribution?.[2] || 0) > 0 ? "destructive" : "default"}
              />
            </div>
          )}

          {/* Distribution Chart */}
          {stats && stats.total_count > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-4 text-sm font-semibold text-foreground">Distribusi Rating</h2>
              <div className="space-y-2">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = stats.distribution?.[star] || 0;
                  const pct = stats.total_count > 0 ? (count / stats.total_count) * 100 : 0;
                  return (
                    <div key={star} className="flex items-center gap-2">
                      <span className="w-8 text-sm font-medium text-foreground">{star}⭐</span>
                      <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-yellow-400 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-sm text-muted-foreground">
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
            <h2 className="text-lg font-semibold text-foreground">Ulasan Terbaru</h2>
            {feedbacks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
                Belum ada feedback dari pengguna.
              </div>
            ) : (
              <div className="space-y-3">
                {feedbacks.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <StarRating rating={f.stars} />
                          <span className="text-sm font-medium text-foreground">
                            {f.stars}/5
                          </span>
                        </div>
                        {f.review && (
                          <p className="mt-2 text-sm text-foreground">
                            {f.review}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {f.thread_title && (
                            <span className="rounded bg-muted px-2 py-0.5">
                              {f.thread_title}
                            </span>
                          )}
                          <span>{formatDateTime(f.created_at)}</span>
                          {f.owner_id && (
                            <span className="font-mono text-[10px]">
                              ID: {f.owner_id.slice(0, 8)}...
                            </span>
                          )}
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
  );
}

export default function FeedbackPage() {
  return (
    <RequireAuth>
      <FeedbackPageContent />
    </RequireAuth>
  );
}
