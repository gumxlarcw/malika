"use client";
import { Zap, ShieldOff, Shield, AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/formatters";
import type { CircuitSummary } from "../types";

interface Props {
  circuit: CircuitSummary;
}

const colorByState: Record<string, string> = {
  CLOSED:    "text-green-600 border-green-300 bg-green-50",
  OPEN:      "text-red-600   border-red-300   bg-red-50",
  HALF_OPEN: "text-amber-600 border-amber-300 bg-amber-50",
};

const IconByState: Record<string, React.ComponentType<{ className?: string }>> = {
  CLOSED:    Shield,
  OPEN:      ShieldOff,
  HALF_OPEN: AlertTriangle,
};

export default function CircuitBreakerCard({ circuit }: Props) {
  const Icon = IconByState[circuit.state] || Shield;
  const cls = colorByState[circuit.state] || colorByState.CLOSED;

  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className="flex items-center gap-3">
        <Icon className="h-8 w-8" />
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70">Circuit Breaker</div>
          <div className="text-2xl font-bold">{circuit.state}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="opacity-60">Failure count</div>
          <div className="font-semibold">{circuit.failureCount}</div>
        </div>
        <div>
          <div className="opacity-60">Last failure</div>
          <div className="font-semibold">{circuit.lastFailureAt ? formatDateTime(circuit.lastFailureAt) : "-"}</div>
        </div>
        <div className="col-span-2">
          <div className="opacity-60">Next attempt</div>
          <div className="font-semibold">{circuit.nextAttemptAt ? formatDateTime(circuit.nextAttemptAt) : "-"}</div>
        </div>
      </div>

      <div className="mt-3 text-xs opacity-70">
        Status read-only dari <code>bpsAPICircuit</code> singleton. Hanya probe yang menulis ke state ini saat ini.
      </div>
    </div>
  );
}
