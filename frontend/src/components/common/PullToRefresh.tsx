"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  threshold?: number; // pixels to pull before triggering refresh
  maxPull?: number; // maximum pull distance
  disabled?: boolean;
}

export default function PullToRefresh({
  onRefresh,
  children,
  threshold = 80,
  maxPull = 120,
  disabled = false,
}: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);

  // Check if we're at the top of the page
  const isAtTop = useCallback(() => {
    if (!containerRef.current) return false;
    // Check both the container and window scroll position
    const containerScrollTop = containerRef.current.scrollTop;
    const windowScrollTop = window.scrollY || document.documentElement.scrollTop;
    return containerScrollTop <= 0 && windowScrollTop <= 0;
  }, []);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || isRefreshing) return;
      if (!isAtTop()) return;

      startYRef.current = e.touches[0].clientY;
      currentYRef.current = e.touches[0].clientY;
      setIsPulling(true);
    },
    [disabled, isRefreshing, isAtTop]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (disabled || isRefreshing || !isPulling) return;
      if (!isAtTop() && pullDistance === 0) {
        setIsPulling(false);
        return;
      }

      currentYRef.current = e.touches[0].clientY;
      const diff = currentYRef.current - startYRef.current;

      if (diff > 0) {
        // Apply resistance - the further you pull, the harder it gets
        const resistance = 0.5;
        const adjustedDiff = Math.min(diff * resistance, maxPull);
        setPullDistance(adjustedDiff);

        // Prevent default scrolling when pulling down from top
        if (adjustedDiff > 10) {
          e.preventDefault();
        }
      }
    },
    [disabled, isRefreshing, isPulling, pullDistance, maxPull, isAtTop]
  );

  const handleTouchEnd = useCallback(async () => {
    if (disabled || isRefreshing) return;

    setIsPulling(false);

    if (pullDistance >= threshold) {
      setIsRefreshing(true);
      setPullDistance(threshold * 0.6); // Keep some visual feedback during refresh

      try {
        await onRefresh();
      } catch (error) {
        console.error("Refresh failed:", error);
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [disabled, isRefreshing, pullDistance, threshold, onRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use passive: false to allow preventDefault on touchmove
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const progress = Math.min(pullDistance / threshold, 1);
  const showIndicator = pullDistance > 10 || isRefreshing;

  return (
    <div ref={containerRef} className="relative min-h-full">
      {/* Pull indicator */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex items-center justify-center overflow-hidden transition-opacity duration-200"
        style={{
          height: `${pullDistance}px`,
          opacity: showIndicator ? 1 : 0,
        }}
      >
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg dark:bg-gray-800 ${
            isRefreshing ? "animate-spin" : ""
          }`}
          style={{
            transform: isRefreshing ? "none" : `rotate(${progress * 360}deg)`,
            transition: isPulling ? "none" : "transform 0.2s ease-out",
          }}
        >
          {isRefreshing ? (
            // Spinning loader
            <svg
              className="h-5 w-5 text-blue-500"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            // Arrow icon that rotates
            <svg
              className={`h-5 w-5 transition-colors ${
                progress >= 1
                  ? "text-blue-500"
                  : "text-gray-400 dark:text-gray-500"
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Content with transform */}
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling ? "none" : "transform 0.2s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
