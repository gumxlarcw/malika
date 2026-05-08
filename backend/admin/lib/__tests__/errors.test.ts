import { describe, it, expect } from "vitest";
import { getErrorMessage, isHttpError, getErrorCode } from "../errors";

describe("getErrorMessage", () => {
  it("returns fallback for null/undefined", () => {
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("extracts axios response.data.message", () => {
    const err = { response: { status: 422, data: { message: "Invalid email" } } };
    expect(getErrorMessage(err, "x")).toBe("HTTP 422: Invalid email");
  });

  it("extracts axios response.data.error when message absent", () => {
    const err = { response: { status: 500, data: { error: "Boom" } } };
    expect(getErrorMessage(err, "x")).toBe("HTTP 500: Boom");
  });

  it("returns just status when both message and error are absent", () => {
    const err = { response: { status: 503, data: {} } };
    expect(getErrorMessage(err, "x")).toBe("HTTP 503");
  });

  it("falls back to Error.message", () => {
    expect(getErrorMessage(new Error("native"), "x")).toBe("native");
  });

  it("uses fallback for empty Error", () => {
    expect(getErrorMessage(new Error(""), "fb")).toBe("fb");
  });
});

describe("isHttpError", () => {
  it("matches status", () => {
    expect(isHttpError({ response: { status: 404 } }, 404)).toBe(true);
    expect(isHttpError({ response: { status: 500 } }, 404)).toBe(false);
  });

  it("returns false for non-axios", () => {
    expect(isHttpError(new Error("x"), 500)).toBe(false);
    expect(isHttpError(null, 500)).toBe(false);
  });
});

describe("getErrorCode", () => {
  it("extracts string code from response.data.code", () => {
    expect(getErrorCode({ response: { data: { code: "DUPLICATE" } } })).toBe("DUPLICATE");
  });

  it("returns null when missing", () => {
    expect(getErrorCode({ response: { data: {} } })).toBe(null);
    expect(getErrorCode({})).toBe(null);
    expect(getErrorCode(null)).toBe(null);
  });
});
