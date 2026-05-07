"use client";
import React from "react";

type Props = {
  title: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  variant?: "default" | "primary" | "destructive";
};

const leftBorder: Record<NonNullable<Props["variant"]>, string> = {
  default: "border-l-border",
  primary: "border-l-primary",
  destructive: "border-l-destructive",
};

export function StatCard({ title, value, subtitle, variant = "default" }: Props) {
  return (
    <div className={`rounded-2xl border border-border bg-card text-card-foreground p-5 border-l-4 ${leftBorder[variant]}`}>
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <div className="text-3xl font-bold leading-tight mt-2">{value}</div>
      {subtitle ? <div className="text-xs text-muted-foreground mt-2">{subtitle}</div> : null}
    </div>
  );
}

export default StatCard;
