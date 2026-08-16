import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Dashboard publik (embed Metabase)",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function DashboardPage() {
  const dashboardIdRaw = process.env.NEXT_PUBLIC_METABASE_DASHBOARD_ID || "3";
  const dashboardId = Number(dashboardIdRaw);

  const apiBase = process.env.METABASE_EMBED_API_BASE || "http://127.0.0.1:5000";
  const apiUrl = `${apiBase.replace(/\/$/, "")}/metabase/embed/dashboard/${dashboardId}?bordered=true&titled=true`;

  let iframeUrl = "";
  if (Number.isFinite(dashboardId) && dashboardId > 0) {
    try {
      const res = await fetch(apiUrl, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        iframeUrl = String(json.iframeUrl || "");
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="h-full w-full min-h-0 overflow-hidden">
      {!Number.isFinite(dashboardId) || dashboardId <= 0 ? (
        <div className="p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Env var <strong>NEXT_PUBLIC_METABASE_DASHBOARD_ID</strong> tidak
            valid.
          </p>
        </div>
      ) : !iframeUrl ? (
        <div className="p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Gagal membuat signed embed. Pastikan backend berjalan dan env
            <strong> METABASE_SECRET_KEY</strong> tersedia di backend.
          </p>
        </div>
      ) : (
        <iframe
          title="Metabase Dashboard"
          src={iframeUrl}
          className="h-full w-full min-h-0"
          referrerPolicy="no-referrer"
          loading="eager"
        />
      )}
    </div>
  );
}
