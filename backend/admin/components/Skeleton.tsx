"use client";
import React from "react";

export default function Skeleton({ className = "w-full h-4" }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}
