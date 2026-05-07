import { NextRequest } from "next/server";

type PubItem = {
  pub_id: string;
  title: string;
  abstract?: string;
  rl_date?: string;
  cover?: string;
  pdf?: string;
  size?: string;
};

type ApiResponse = {
  data?: [
    { page: number; pages: number; per_page: number; count: number; total: number },
    PubItem[],
  ];
};

function getApiKey() {
  return (
    process.env.BPS_API_KEY ||
    process.env.NEXT_PUBLIC_BPS_API_KEY ||
    "e5d1be11320576d466bdeb2f7f210387"
  );
}

export async function GET(req: NextRequest) {
  const pageRaw = req.nextUrl.searchParams.get("page");
  const page = Math.max(1, Number.parseInt(pageRaw || "1", 10) || 1);
  
  // Optional filter parameters
  const keyword = req.nextUrl.searchParams.get("keyword") || "";
  const month = req.nextUrl.searchParams.get("month") || "";
  const year = req.nextUrl.searchParams.get("year") || "";

  const apiKey = getApiKey();
  
  // Build URL with optional filter segments
  let url = `https://webapi.bps.go.id/v1/api/list/model/publication/domain/8200/page/${page}`;
  
  // Add keyword filter (server-side)
  if (keyword.trim()) {
    url += `/keyword/${encodeURIComponent(keyword.trim())}`;
  }
  
  // Add month filter (server-side)
  if (month) {
    url += `/month/${month}`;
  }
  
  // Add year filter (server-side)
  if (year) {
    url += `/year/${year}`;
  }
  
  url += `/key/${apiKey}/`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      // Cache on server to reduce load; client still rotates locally.
      next: { revalidate: 3600 },
    });
  } catch {
    return new Response("Failed to fetch upstream", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("Upstream error", { status: upstream.status });
  }

  let raw: ApiResponse;
  try {
    raw = (await upstream.json()) as ApiResponse;
  } catch {
    return new Response("Invalid upstream JSON", { status: 502 });
  }

  const meta = (raw?.data?.[0] || null) as ApiResponse["data"] extends [infer M, unknown] ? M : null;
  const items = Array.isArray(raw?.data?.[1]) ? raw.data![1] : [];

  const sorted = items.slice().sort((a, b) => {
    const da = Date.parse(a?.rl_date || "") || 0;
    const db = Date.parse(b?.rl_date || "") || 0;
    return db - da;
  });

  return Response.json(
    {
      meta,
      items: sorted,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}
