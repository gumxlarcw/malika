/**
 * Shared SVG Icons for Chat Components
 *
 * L3: Extract commonly duplicated inline SVGs to shared components.
 * Each icon accepts className and optional SVG props for flexibility.
 *
 * Usage:
 *   import { CloseIcon, EyeIcon, LightbulbIcon } from '@/components/chat/icons';
 *   <CloseIcon className="h-5 w-5" />
 */

import React from "react";

type IconProps = React.SVGProps<SVGSVGElement>;

/** Close / X icon (×7 occurrences across 4 files) */
export function CloseIcon({ className = "h-5 w-5", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/** Eye / view icon — both paths paired (×7 occurrences across 4 files) */
export function EyeIcon({ className = "h-4 w-4", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

/** Lightbulb / idea icon (×5 occurrences across 3 files) */
export function LightbulbIcon({ className = "h-4 w-4", fill, strokeWidth = 1.5, ...props }: IconProps & { strokeWidth?: number }) {
  const d = "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z";
  if (fill && fill !== "none") {
    return (
      <svg className={className} fill={fill} viewBox="0 0 20 20" {...props}>
        <path d={d} />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={d} />
    </svg>
  );
}

/** External link icon (×4 occurrences across 3 files) */
export function ExternalLinkIcon({ className = "h-4 w-4", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

/** Checkmark / tick outline icon (×3 occurrences across 3 files) */
export function CheckIcon({ className = "h-5 w-5", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** Chevron down icon (×3 occurrences across 3 files) */
export function ChevronDownIcon({ className = "h-5 w-5", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

/** Chevron right icon (×2 occurrences across 2 files) */
export function ChevronRightIcon({ className = "h-4 w-4", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Copy / clipboard icon (×2 occurrences across 2 files) */
export function CopyIcon({ className = "h-4 w-4", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

/** Download icon (×2 occurrences across 2 files) */
export function DownloadIcon({ className = "h-4 w-4", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

/** Table / grid icon (×2 occurrences across 2 files) */
export function TableIcon({ className = "h-4 w-4", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

/** Retry / refresh icon (×3 occurrences across 2 files) */
export function RetryIcon({ className = "h-4 w-4", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

/** Warning / triangle icon (×2 occurrences across 2 files) */
export function WarningIcon({ className = "h-4 w-4", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

/** Lightning bolt icon (×4 occurrences across 2 files) */
export function LightningIcon({ className = "h-4 w-4", fill, strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  const d = "M13 10V3L4 14h7v7l9-11h-7z";
  if (fill && fill !== "none") {
    return (
      <svg className={className} fill={fill} viewBox="0 0 20 20" {...props}>
        <path d={d} />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={d} />
    </svg>
  );
}

/** Book / open book icon (×2 occurrences across 2 files) */
export function BookIcon({ className = "h-4 w-4", strokeWidth = 2, ...props }: IconProps & { strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}
