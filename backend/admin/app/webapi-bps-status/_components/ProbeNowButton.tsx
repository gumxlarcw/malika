"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { api } from "@/lib/axios";
import { getErrorMessage, isHttpError } from "@/lib/errors";
import type { ProbeResult } from "../types";

export default function ProbeNowButton() {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<"success" | "warning" | "error">("success");

  const mutation = useMutation<ProbeResult, unknown>({
    mutationFn: () => api.post("/webapi-bps/probe").then(r => r.data as ProbeResult),
    onSuccess: (data) => {
      setVariant("success");
      setMessage(`Probe selesai: ${data.overall} (${data.durationMs}ms)`);
      qc.invalidateQueries({ queryKey: ["webapi-bps", "status"] });
      qc.invalidateQueries({ queryKey: ["webapi-bps", "history"] });
      qc.invalidateQueries({ queryKey: ["webapi-bps", "logs"] });
      setTimeout(() => setMessage(null), 5000);
    },
    onError: (e) => {
      if (isHttpError(e, 409)) {
        setVariant("warning");
        setMessage("Probe sedang berjalan, tunggu sebentar");
      } else if (isHttpError(e, 429)) {
        setVariant("warning");
        setMessage("Terlalu banyak probe manual, coba 1 menit lagi");
      } else {
        setVariant("error");
        setMessage(getErrorMessage(e, "Probe gagal"));
      }
      setTimeout(() => setMessage(null), 6000);
    },
  });

  const variantClasses: Record<string, string> = {
    success: "bg-green-100 text-green-900",
    warning: "bg-yellow-100 text-yellow-900",
    error:   "bg-red-100   text-red-900",
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        <Zap className={`h-4 w-4 ${mutation.isPending ? "animate-pulse" : ""}`} />
        <span>Probe Sekarang</span>
      </button>
      {message && (
        <span className={`text-xs px-3 py-1 rounded-lg ${variantClasses[variant]}`}>{message}</span>
      )}
    </div>
  );
}
