"use client";

import React from "react";

/**
 * A single skeleton line with configurable width
 */
export function SkeletonLine({ w }: { w: string }) {
  return <div className={`h-3 ${w} animate-pulse rounded bg-gray-200 dark:bg-gray-800`} />;
}

/**
 * Thread list item skeleton for loading state
 */
export function ThreadSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonLine w="w-3/4" />
          <SkeletonLine w="w-1/3" />
        </div>
        <SkeletonLine w="w-10" />
      </div>
    </div>
  );
}

/**
 * Message skeleton for loading state - simulates chat bubble appearance
 */
export function MessageSkeleton({ position }: { position: "left" | "right" }) {
  const isRight = position === "right";
  return (
    <div className={`flex ${isRight ? "justify-end" : "justify-start"} px-4 py-2`}>
      <div
        className={`max-w-[min(85%,520px)] rounded-2xl px-4 py-3 ${
          isRight
            ? "bg-brand-500/10 dark:bg-brand-900/30"
            : "bg-gray-100 dark:bg-gray-800"
        }`}
      >
        <div className="space-y-2">
          <div className={`h-3 ${isRight ? "w-24" : "w-40"} animate-pulse rounded bg-gray-300 dark:bg-gray-700`} />
          {!isRight && (
            <>
              <div className="h-3 w-32 animate-pulse rounded bg-gray-300 dark:bg-gray-700" />
              <div className="h-3 w-20 animate-pulse rounded bg-gray-300 dark:bg-gray-700" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Chat messages skeleton - shows realistic chat loading state
 */
export function MessagesLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col justify-end pb-4">
      <MessageSkeleton position="right" />
      <MessageSkeleton position="left" />
      <MessageSkeleton position="right" />
      <MessageSkeleton position="left" />
    </div>
  );
}
