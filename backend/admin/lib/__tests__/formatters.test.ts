import { describe, it, expect } from "vitest";
import {
  formatDateTime,
  fmt,
  formatDate,
  formatTime,
  formatBytes,
  formatNumber,
  formatPercent,
  truncate,
  maxDate,
  clampPercent,
} from "../formatters";

describe("formatDateTime / fmt", () => {
  it("returns - for null/undefined/empty", () => {
    expect(formatDateTime(null)).toBe("-");
    expect(formatDateTime(undefined)).toBe("-");
    expect(formatDateTime("")).toBe("-");
    expect(fmt(null)).toBe("-");
  });

  it("formats a valid ISO string in id-ID Asia/Jayapura locale", () => {
    const out = formatDateTime("2026-01-15T03:00:00.000Z");
    expect(out).not.toBe("-");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(5);
  });

  it("returns the input string for invalid date string", () => {
    expect(formatDateTime("not-a-date")).toContain("Invalid");
  });
});

describe("formatDate / formatTime", () => {
  it("returns - for null", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatTime(null)).toBe("-");
  });
});

describe("formatBytes", () => {
  it("returns - for invalid input", () => {
    expect(formatBytes(undefined)).toBe("-");
    expect(formatBytes(-1)).toBe("-");
  });
  it("formats bytes < 1024 as B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });
  it("formats KB/MB/GB with one decimal under 10", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
  it("drops decimal at >=10", () => {
    expect(formatBytes(15 * 1024)).toBe("15 KB");
  });
});

describe("formatNumber", () => {
  it("returns - for null/undefined/Infinity/NaN", () => {
    expect(formatNumber(null)).toBe("-");
    expect(formatNumber(undefined)).toBe("-");
    expect(formatNumber(Infinity)).toBe("-");
    expect(formatNumber(NaN)).toBe("-");
  });
  it("formats numbers with id-ID thousand separators", () => {
    const out = formatNumber(1234567);
    expect(out).toBe("1.234.567");
  });
  it("handles zero and negatives", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-1234)).toBe("-1.234");
  });
});

describe("formatPercent", () => {
  it("formats integer percent by default", () => {
    expect(formatPercent(42)).toBe("42%");
  });
  it("converts decimal when isDecimal=true", () => {
    expect(formatPercent(0.42, 1, true)).toBe("42.0%");
  });
  it("returns - for null/Infinity", () => {
    expect(formatPercent(null)).toBe("-");
    expect(formatPercent(Infinity)).toBe("-");
  });
});

describe("truncate", () => {
  it("returns empty for null", () => {
    expect(truncate(null)).toBe("");
  });
  it("truncates with ellipsis when over maxLen", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcde…");
  });
  it("returns input when within maxLen", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });
});

describe("maxDate", () => {
  it("picks the later date", () => {
    expect(maxDate("2026-01-01", "2026-02-01")).toBe("2026-02-01");
  });
  it("falls back to non-null when one is null", () => {
    expect(maxDate(null, "2026-02-01")).toBe("2026-02-01");
    expect(maxDate("2026-02-01", null)).toBe("2026-02-01");
  });
  it("returns null when both null", () => {
    expect(maxDate(null, null)).toBe(null);
  });
});

describe("clampPercent", () => {
  it("clamps to 0-100", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(50)).toBe(50);
  });
  it("returns 0 for non-finite", () => {
    expect(clampPercent("abc")).toBe(0);
    expect(clampPercent(null)).toBe(0);
  });
});
