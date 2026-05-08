export type SourceType = "dynamic" | "interop" | "exim" | "static";

export type CategorySource = {
  id: number;
  name: string;
  type: SourceType | string;
};

export type Category = {
  name: string;
  count: number;
  slug: string;
  sources: CategorySource[];
};

export type Indicator = {
  id: number;
  name: string;
  title?: string;
  type: string;
  category: string;
  score: number;
  subtitle?: string;
  link?: string;
};

export const SOURCE_TYPES: SourceType[] = ["dynamic", "interop", "exim", "static"];

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  dynamic: "Dinamis",
  interop: "Interop",
  exim: "EXIM",
  static: "Statis",
};

export type TypeCounts = Record<SourceType, number>;

export function emptyTypeCounts(): TypeCounts {
  return { dynamic: 0, interop: 0, exim: 0, static: 0 };
}

export function countByType(category: Category): TypeCounts {
  const c = emptyTypeCounts();
  for (const s of category.sources) {
    if (s.type === "dynamic" || s.type === "interop" || s.type === "exim" || s.type === "static") {
      c[s.type]++;
    }
  }
  return c;
}

export function dominantType(tc: TypeCounts): SourceType {
  let best: SourceType = "dynamic";
  let n = -1;
  for (const t of SOURCE_TYPES) {
    if (tc[t] > n) {
      n = tc[t];
      best = t;
    }
  }
  return best;
}

export function nfmt(n: number): string {
  return n.toLocaleString("id-ID");
}

export function inferTypeFromLink(link: string | undefined): SourceType {
  if (!link) return "dynamic";
  if (link.includes("type=exim")) return "exim";
  if (link.includes("type=interop")) return "interop";
  if (link.includes("type=static")) return "static";
  return "dynamic";
}
