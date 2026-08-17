import type { Metadata } from "next";
import React from "react";
import { backendBaseUrl } from "@/lib/apiHelpers";
import DashboardClient from "./_components/DashboardClient";
import type { DashboardSummary } from "./_lib/types";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Indikator strategis Maluku Utara dari Badan Pusat Statistik.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadSummary(): Promise<DashboardSummary | null> {
  try {
    const res = await fetch(`${backendBaseUrl()}/dashboard/public/summary`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as DashboardSummary;
  } catch {
    // Rendered as an empty-state below rather than crashing the route.
    return null;
  }
}

export default async function DashboardPage() {
  const summary = await loadSummary();
  return <DashboardClient summary={summary} />;
}
