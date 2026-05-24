import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import HistoryChart from "../_components/HistoryChart";
import type { HistoryBucket } from "../types";

function mkBuckets(n: number, failedAt: number[] = []): HistoryBucket[] {
  return Array.from({ length: n }, (_, i) => ({
    t: new Date(Date.now() - (n - i) * 3600_000).toISOString(),
    probes: 4,
    failed: failedAt.includes(i) ? 4 : 0,
    p95LatencyMs: 300,
  }));
}

describe("HistoryChart", () => {
  it("renders N bars for N buckets", () => {
    const { container } = render(<HistoryChart buckets={mkBuckets(24)} />);
    expect(container.querySelectorAll("rect")).toHaveLength(24);
  });

  it("renders empty state when no buckets", () => {
    const { container } = render(<HistoryChart buckets={[]} />);
    expect(container.textContent).toMatch(/Belum ada data/i);
  });

  it("colors failed-bucket red", () => {
    const { container } = render(<HistoryChart buckets={mkBuckets(3, [1])} />);
    const rects = container.querySelectorAll("rect");
    expect(rects[1].getAttribute("fill")).toMatch(/red|#dc2626|#ef4444/);
  });
});
