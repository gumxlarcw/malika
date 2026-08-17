"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { BORDER, SURFACE, TEXT, TEXT_5 } from "@/lib/surfaceTokens";

/** The card shell every non-KPI panel sits in: title, optional subtitle, actions. */
export function Panel({
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn("flex flex-col gap-3.5 rounded-2xl border p-[18px] shadow-theme-xs", BORDER, SURFACE, className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className={cn("text-[15px] font-semibold leading-[22px]", TEXT)}>{title}</h2>
          {subtitle ? <p className={cn("text-xs leading-[18px]", TEXT_5)}>{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Quiet square icon button used for a panel's expand / download affordances. */
export function PanelAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
        TEXT_5
      )}
    >
      {children}
    </button>
  );
}

export function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5L11 9M3.5 16.5L9 11" />
    </svg>
  );
}

/** Shown in place of a chart when the source has nothing to plot. */
export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn("py-8 text-center text-sm", TEXT_5)}>{children}</p>
  );
}
