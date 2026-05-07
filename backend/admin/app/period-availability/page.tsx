"use client";
import { useState } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import { Calendar, Search, ChevronRight } from "lucide-react";

interface Period {
  tahun: string | number;
  th_id?: string | number;
  label?: string;
}

export default function PeriodAvailabilityPage() {
  const [sourceId, setSourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [months, setMonths] = useState<number[]>([]);
  const [loadingMonths, setLoadingMonths] = useState(false);

  async function handleFetchPeriods() {
    if (!sourceId.trim()) {
      setError("Source ID wajib diisi");
      return;
    }
    setLoading(true);
    setError("");
    setPeriods([]);
    setSelectedYear(null);
    setMonths([]);
    try {
      const { data } = await api.get(`/period/available/${sourceId.trim()}`);
      setPeriods(data.periods || data.data || []);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat periode"));
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchMonths(year: string) {
    setSelectedYear(year);
    setLoadingMonths(true);
    setMonths([]);
    try {
      const { data } = await api.get(`/period/available/${sourceId}/months?year=${year}`);
      setMonths(data.months || []);
    } catch {
      setMonths([]);
    } finally {
      setLoadingMonths(false);
    }
  }

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agt", "Sep", "Okt", "Nov", "Des"
  ];

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Calendar className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Period Availability</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Cek periode yang tersedia dari API BPS untuk datasource tertentu.
        </p>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Search Form */}
        <div className="flex gap-3">
          <input
            type="number"
            placeholder="Source ID (contoh: 1)"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="w-40 px-4 py-2 rounded-lg border border-border bg-background"
            onKeyDown={(e) => e.key === "Enter" && handleFetchPeriods()}
          />
          <button
            onClick={handleFetchPeriods}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Search className="h-4 w-4" />
            <span>Cek Periode</span>
          </button>
        </div>

        {loading && <LoadingSpinner label="Memuat periode..." />}

        {!loading && periods.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Years List */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="p-3 bg-muted border-b border-border font-medium">
                Periode Tersedia ({periods.length})
              </div>
              <div className="max-h-96 overflow-y-auto">
                {periods.map((p, i) => {
                  const year = String(p.tahun || p.th_id || p.label);
                  const isSelected = selectedYear === year;
                  return (
                    <button
                      key={i}
                      onClick={() => handleFetchMonths(year)}
                      className={`w-full px-4 py-2 text-left flex items-center justify-between border-b border-border last:border-0 transition-colors ${
                        isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="font-mono">{year}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Months Grid */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="p-3 bg-muted border-b border-border font-medium">
                {selectedYear ? `Bulan Tersedia (${selectedYear})` : "Pilih tahun untuk lihat bulan"}
              </div>
              <div className="p-4">
                {!selectedYear && (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    Klik tahun di sebelah kiri untuk melihat bulan yang tersedia
                  </p>
                )}
                {selectedYear && loadingMonths && <LoadingSpinner label="Memuat bulan..." />}
                {selectedYear && !loadingMonths && (
                  <div className="grid grid-cols-4 gap-2">
                    {monthNames.map((name, i) => {
                      const monthNum = i + 1;
                      const available = months.includes(monthNum);
                      return (
                        <div
                          key={monthNum}
                          className={`p-3 rounded-lg text-center text-sm font-medium transition-colors ${
                            available
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {name}
                        </div>
                      );
                    })}
                  </div>
                )}
                {selectedYear && !loadingMonths && months.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-4">
                    Tidak ada data bulan untuk tahun {selectedYear}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && periods.length === 0 && sourceId && (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
            Klik &quot;Cek Periode&quot; untuk melihat periode yang tersedia
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
