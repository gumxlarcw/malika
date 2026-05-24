"use client";
import { CheckCircle, XCircle, AlertCircle, HelpCircle } from "lucide-react";
import { formatDateTime, formatPercent, formatNumber } from "@/lib/formatters";
import type { StatusResponse } from "../types";

interface Props {
  status: StatusResponse;
}

const colorByOverall: Record<string, string> = {
  UP:        "text-green-600 border-green-300 bg-green-50",
  DEGRADED:  "text-amber-600 border-amber-300 bg-amber-50",
  DOWN:      "text-red-600   border-red-300   bg-red-50",
  UNKNOWN:   "text-gray-600  border-gray-300  bg-gray-50",
};

const IconByOverall: Record<string, React.ComponentType<{ className?: string }>> = {
  UP:       CheckCircle,
  DEGRADED: AlertCircle,
  DOWN:     XCircle,
  UNKNOWN:  HelpCircle,
};

export default function OverallStatusCard({ status }: Props) {
  const Icon = IconByOverall[status.overall] || HelpCircle;
  const cls = colorByOverall[status.overall] || colorByOverall.UNKNOWN;

  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className="flex items-center gap-3">
        <Icon className="h-8 w-8" />
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70">Status</div>
          <div className="text-2xl font-bold">{status.overall}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="opacity-60">Ketersediaan 24j</div>
          <div className="font-semibold">
            {status.uptime24h != null ? formatPercent(status.uptime24h, 2, true) : "-"}
          </div>
        </div>
        <div>
          <div className="opacity-60">p95 latency</div>
          <div className="font-semibold">
            {status.p95LatencyMs24h != null ? `${formatNumber(status.p95LatencyMs24h)} ms` : "-"}
          </div>
        </div>
        <div>
          <div className="opacity-60">Probe terakhir</div>
          <div className="font-semibold">
            {status.lastProbeAt ? formatDateTime(status.lastProbeAt) : "-"}
          </div>
        </div>
        <div>
          <div className="opacity-60">Total 24h</div>
          <div className="font-semibold">
            {formatNumber(status.totalProbes24h)} ({formatNumber(status.failedProbes24h)} gagal)
          </div>
        </div>
      </div>

      {!status.apiKeyPresent && (
        <div className="mt-3 rounded-lg bg-yellow-100 px-3 py-2 text-xs text-yellow-900">
          API key BPS belum di-konfigurasi. Set <code>BPS_API_KEY</code> di <code>.env</code>.
        </div>
      )}
    </div>
  );
}
