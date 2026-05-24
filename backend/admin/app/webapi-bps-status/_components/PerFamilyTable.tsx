"use client";
import { CheckCircle, XCircle, MinusCircle } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/formatters";
import type { PerFamilySummary } from "../types";

interface Props {
  perFamily: PerFamilySummary[];
}

export default function PerFamilyTable({ perFamily }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-semibold">Status per Famili Endpoint</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr className="text-left">
            <th className="px-4 py-2">Family</th>
            <th className="px-4 py-2 text-center">Status</th>
            <th className="px-4 py-2 text-right">Latency</th>
            <th className="px-4 py-2">Error</th>
            <th className="px-4 py-2">Checked</th>
          </tr>
        </thead>
        <tbody>
          {perFamily.map(f => (
            <tr key={f.family} className="border-t border-border">
              <td className="px-4 py-2 font-mono">{f.family}</td>
              <td className="px-4 py-2 text-center">
                {f.lastOk === null
                  ? <MinusCircle className="inline h-4 w-4 text-gray-400" />
                  : f.lastOk
                    ? <CheckCircle className="inline h-4 w-4 text-green-600" />
                    : <XCircle className="inline h-4 w-4 text-red-600" />}
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground">
                {f.lastLatencyMs != null ? `${formatNumber(f.lastLatencyMs)} ms` : "-"}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{f.lastErrorCode || "-"}</td>
              <td className="px-4 py-2 text-muted-foreground">{f.lastCheckedAt ? formatDateTime(f.lastCheckedAt) : "-"}</td>
            </tr>
          ))}
          {perFamily.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Belum ada data probe</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
