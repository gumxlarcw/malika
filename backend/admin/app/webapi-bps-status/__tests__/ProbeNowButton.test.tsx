import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProbeNowButton from "../_components/ProbeNowButton";

vi.mock("@/lib/axios", () => ({
  api: { post: vi.fn() },
}));

const { api } = await import("@/lib/axios");

function withQuery(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("ProbeNowButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("triggers probe on click and shows success message", async () => {
    (api.post as any).mockResolvedValueOnce({ data: { runId: "x", overall: "UP", durationMs: 100, perFamily: [] } });
    render(withQuery(<ProbeNowButton />));
    fireEvent.click(screen.getByRole("button", { name: /Probe Sekarang/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/webapi-bps/probe"));
  });

  it("shows 409 message when probe already running", async () => {
    const err: any = new Error("409");
    err.response = { status: 409, data: { reason: "probe_already_running" } };
    (api.post as any).mockRejectedValueOnce(err);
    render(withQuery(<ProbeNowButton />));
    fireEvent.click(screen.getByRole("button", { name: /Probe Sekarang/i }));
    await waitFor(() => expect(screen.getByText(/Probe sedang berjalan/i)).toBeInTheDocument());
  });

  it("shows 429 message when rate limited", async () => {
    const err: any = new Error("429");
    err.response = { status: 429 };
    (api.post as any).mockRejectedValueOnce(err);
    render(withQuery(<ProbeNowButton />));
    fireEvent.click(screen.getByRole("button", { name: /Probe Sekarang/i }));
    await waitFor(() => expect(screen.getByText(/Terlalu banyak probe/i)).toBeInTheDocument());
  });
});
