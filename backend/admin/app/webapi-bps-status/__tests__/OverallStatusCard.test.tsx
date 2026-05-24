import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OverallStatusCard from "../_components/OverallStatusCard";
import type { StatusResponse } from "../types";

function mkStatus(o: Partial<StatusResponse> = {}): StatusResponse {
  return {
    overall: "UP",
    lastProbeAt: "2026-05-24T03:00:00.000Z",
    lastProbeRunId: "abc",
    uptime24h: 0.9931,
    p50LatencyMs24h: 287,
    p95LatencyMs24h: 1240,
    totalProbes24h: 96,
    failedProbes24h: 4,
    perFamily: [],
    circuit: { state: "CLOSED", failureCount: 0, lastFailureAt: null, nextAttemptAt: null },
    apiKeyPresent: true,
    ...o,
  };
}

describe("OverallStatusCard", () => {
  it("renders UP state in green", () => {
    render(<OverallStatusCard status={mkStatus()} />);
    expect(screen.getByText(/UP/i)).toBeInTheDocument();
    expect(screen.getByText(/99\.31/)).toBeInTheDocument();
  });

  it("renders DOWN state in red", () => {
    render(<OverallStatusCard status={mkStatus({ overall: "DOWN" })} />);
    expect(screen.getByText(/DOWN/i)).toBeInTheDocument();
  });

  it("renders UNKNOWN when api key missing", () => {
    render(<OverallStatusCard status={mkStatus({ overall: "UNKNOWN", apiKeyPresent: false })} />);
    expect(screen.getByText(/UNKNOWN/i)).toBeInTheDocument();
    expect(screen.getByText(/API key BPS belum/i)).toBeInTheDocument();
  });
});
