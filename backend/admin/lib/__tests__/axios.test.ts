import { describe, it, expect } from "vitest";
import { sanitizeBaseUrl } from "../axios";

describe("sanitizeBaseUrl", () => {
  it("returns / for empty / nullish", () => {
    expect(sanitizeBaseUrl("")).toBe("/");
    expect(sanitizeBaseUrl(null)).toBe("/");
    expect(sanitizeBaseUrl(undefined)).toBe("/");
  });

  it("rewrites bare /backend to /", () => {
    expect(sanitizeBaseUrl("/backend")).toBe("/");
    expect(sanitizeBaseUrl("/backend/")).toBe("/");
  });

  it("strips /backend prefix from absolute URL", () => {
    expect(sanitizeBaseUrl("https://api-malika.bpsmalut.com/backend/")).toBe(
      "https://api-malika.bpsmalut.com"
    );
  });

  it("preserves non-/backend absolute URL (trailing slash trimmed)", () => {
    expect(sanitizeBaseUrl("https://api-malika.bpsmalut.com/")).toBe(
      "https://api-malika.bpsmalut.com"
    );
  });

  it("returns / for malformed absolute URL", () => {
    expect(sanitizeBaseUrl("https://[invalid")).toBe("/");
  });

  it("passes through other relative paths unchanged", () => {
    expect(sanitizeBaseUrl("/api")).toBe("/api");
  });
});
