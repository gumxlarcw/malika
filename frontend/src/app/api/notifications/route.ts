import { NextResponse } from "next/server";

function pickBackendBaseUrl() {
  const internal =
    process.env.BACKEND_INTERNAL_API_URL ||
    process.env.INTERNAL_BACKEND_API_URL ||
    process.env.BACKEND_API_URL;
  if (internal && /^https?:\/\//i.test(internal)) return internal.replace(/\/$/, "");

  const fromEnv = process.env.NEXT_PUBLIC_BACKEND_API_URL;
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) return fromEnv.replace(/\/$/, "");

  // Default to local backend (co-located deployment).
  return "http://127.0.0.1:5000";
}

function timeAgoFrom(dateInput: string | Date | null | undefined) {
  if (!dateInput) return "-";
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) return "-";

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  
  // Check if it's today (same date in local timezone)
  const isToday = d.toDateString() === now.toDateString();
  
  if (isToday) {
    // For very recent (< 1 minute), show seconds ago
    if (diffSec < 60) return `${diffSec}s ago`;
    
    // For recent (< 5 minutes), show minutes ago  
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 5) return `${diffMin} min ago`;
    
    // For today but more than 5 minutes ago, show local time (e.g., "14:03")
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  
  // For older dates, show the date
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  
  if (diffDay < 7) {
    // For recent days, also show the time
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const dayText = diffDay === 1 ? "Yesterday" : `${diffDay} days ago`;
    return `${dayText} ${hours}:${minutes}`;
  }
  
  // For older than 7 days, show the date
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") || "20";
  const type = searchParams.get("type");

  const backendBase = pickBackendBaseUrl();
  const backendUrl = new URL(`${backendBase}/notifications`);
  backendUrl.searchParams.set("limit", limit);
  if (type) backendUrl.searchParams.set("type", type);

  let res: Response;
  try {
    res = await fetch(backendUrl.toString(), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
  } catch {
    return NextResponse.json({ items: [], error: "Upstream fetch failed" }, { status: 200 });
  }

  if (!res.ok) {
    return NextResponse.json(
      { items: [], error: `Upstream error ${res.status}` },
      { status: 200 }
    );
  }

  const data = (await res.json()) as {
    items?: Array<{
      id: number;
      type: string;
      title: string;
      message?: string | null;
      link?: string | null;
      created_at?: string;
      metadata?: {
        keyword?: string;
        source_id?: number;
        signature?: string;
        pdf_url?: string;
        rl_date?: string;
        brs_id?: string | number;
        pub_id?: string;
        domain_id?: number;
        source?: string; // Indicator name for data type notifications
        last_update?: string;
        kind?: string;
      } | null;
    }>;
  };

  const items = (data.items || []).map((n) => {
    // For data notifications, redirect directly to /data with source_id
    // This avoids text parsing issues (e.g., years in indicator names like "2022 = 100")
    const dataDeepLink = (() => {
      if (n.type !== "data") return null;
      const sourceId = n.metadata?.source_id;
      if (sourceId != null && Number.isFinite(Number(sourceId))) {
        // Redirect to data page with source_id - will auto-select latest period
        return `/data?source_id=${encodeURIComponent(String(sourceId))}`;
      }
      // Fallback to search with indicator name if source_id not available
      const indicatorName = n.metadata?.source || n.title || "";
      const trimmed = String(indicatorName).trim();
      if (!trimmed || trimmed === "Data Statistik") return "/";
      return `/search?q=${encodeURIComponent(trimmed)}`;
    })();

    const deepLink =
      n.type === "pressrelease"
        ? n.metadata?.brs_id != null
          ? `/brs?brs_id=${encodeURIComponent(String(n.metadata.brs_id))}`
          : "/brs"
        : n.type === "publication"
          ? n.metadata?.pub_id
            ? `/publikasi?pub_id=${encodeURIComponent(String(n.metadata.pub_id))}`
            : "/publikasi"
          : n.type === "data"
            ? dataDeepLink
            : null;

    const statusDotClass =
      n.type === "data"
        ? "bg-success-500"
        : n.type === "pressrelease"
          ? "bg-warning-500"
          : n.type === "publication"
            ? "bg-success-500"
          : "bg-success-500";

    const category =
      n.type === "pressrelease"
        ? "Berita Resmi Statistik"
        : n.type === "publication"
          ? "Publikasi"
          : n.type === "data"
            ? "Data Statistik"
            : (n.type || "info");

    return {
      id: String(n.id),
      userName: n.title || "Sistem",
      userImageSrc: "/images/user/user-01.jpg",
      statusDotClass,
      actionText: n.message || "",
      targetText: "",
      category,
      timeAgo: timeAgoFrom(n.created_at || null),
      createdAt: n.created_at || null,
      link:
        deepLink ||
        n.link ||
        (n.type === "pressrelease" || n.type === "publication" ? n.metadata?.pdf_url || null : null),
    };
  });

  return NextResponse.json({ items });
}
