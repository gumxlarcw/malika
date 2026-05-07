"use client";

import React from "react";

type EmptyStateVariant = "no-results" | "no-data" | "error" | "no-recommendations";

type EmptyStateProps = {
  variant?: EmptyStateVariant;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
};

// Search/magnifying glass with X
function NoResultsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="28" cy="28" r="20" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="4" fill="none" />
      <line x1="42" y1="42" x2="56" y2="56" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="4" strokeLinecap="round" />
      <line x1="22" y1="22" x2="34" y2="34" className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="3" strokeLinecap="round" />
      <line x1="34" y1="22" x2="22" y2="34" className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Empty table/document icon
function NoDataIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="8" width="44" height="48" rx="4" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="3" fill="none" />
      <line x1="18" y1="20" x2="46" y2="20" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="3" strokeLinecap="round" />
      <line x1="18" y1="30" x2="40" y2="30" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="3" strokeLinecap="round" />
      <line x1="18" y1="40" x2="34" y2="40" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="48" r="12" className="fill-gray-100 dark:fill-gray-800 stroke-gray-400 dark:stroke-gray-500" strokeWidth="2" />
      <line x1="44" y1="48" x2="52" y2="48" className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Error/warning icon
function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="24" className="stroke-orange-300 dark:stroke-orange-500/50" strokeWidth="3" fill="none" />
      <line x1="32" y1="18" x2="32" y2="36" className="stroke-orange-400 dark:stroke-orange-400" strokeWidth="4" strokeLinecap="round" />
      <circle cx="32" cy="44" r="3" className="fill-orange-400 dark:fill-orange-400" />
    </svg>
  );
}

// Lightbulb/recommendation icon
function NoRecommendationsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path 
        d="M32 8C22 8 14 16 14 26C14 32 17 37 22 40V48C22 50 24 52 26 52H38C40 52 42 50 42 48V40C47 37 50 32 50 26C50 16 42 8 32 8Z" 
        className="stroke-gray-300 dark:stroke-gray-600" 
        strokeWidth="3" 
        fill="none" 
      />
      <line x1="26" y1="56" x2="38" y2="56" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="3" strokeLinecap="round" />
      <line x1="32" y1="20" x2="32" y2="32" className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="2" strokeLinecap="round" />
      <line x1="26" y1="26" x2="38" y2="26" className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const defaultConfigs: Record<EmptyStateVariant, { icon: React.ReactNode; title: string; description: string }> = {
  "no-results": {
    icon: <NoResultsIcon className="h-16 w-16" />,
    title: "Tidak ditemukan",
    description: "Coba kata kunci lain atau periksa ejaan pencarian Anda.",
  },
  "no-data": {
    icon: <NoDataIcon className="h-16 w-16" />,
    title: "Tidak ada data",
    description: "Data untuk periode yang diminta belum tersedia.",
  },
  "error": {
    icon: <ErrorIcon className="h-16 w-16" />,
    title: "Terjadi kesalahan",
    description: "Gagal memuat data. Silakan coba lagi nanti.",
  },
  "no-recommendations": {
    icon: <NoRecommendationsIcon className="h-16 w-16" />,
    title: "Tidak ada rekomendasi",
    description: "Coba kata kunci lain untuk mendapatkan rekomendasi yang lebih relevan.",
  },
};

export default function EmptyState({
  variant = "no-data",
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  const config = defaultConfigs[variant];
  
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="mb-4">
        {icon || config.icon}
      </div>
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {title || config.title}
      </h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-xs">
        {description || config.description}
      </p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// Compact variant for inline use
export function EmptyStateInline({
  message = "Tidak ada data.",
  icon,
}: {
  message?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-4 px-2 text-sm text-gray-500 dark:text-gray-400">
      {icon || (
        <svg className="h-5 w-5 flex-shrink-0 text-gray-400 dark:text-gray-500" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      )}
      <span>{message}</span>
    </div>
  );
}
