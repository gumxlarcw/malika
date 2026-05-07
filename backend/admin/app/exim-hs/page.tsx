"use client";
import { useState } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import { Package, Search } from "lucide-react";

interface HsCode {
  kode_hs: string;
  deskripsi: string;
}

export default function EximHsLookupPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<HsCode[]>([]);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) {
      setError("Masukkan kode HS atau deskripsi");
      return;
    }
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const { data } = await api.get(`/exim/hs2?q=${encodeURIComponent(query.trim())}`);
      setResults(data.results || data.data || []);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal mencari HS code"));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Package className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">EXIM HS Code Lookup</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Cari kode HS (Harmonized System) untuk data ekspor-impor.
        </p>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Search Form */}
        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            type="text"
            placeholder="Cari kode HS atau deskripsi (contoh: 03 atau ikan)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg border border-border bg-background"
          />
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Search className="h-4 w-4" />
            <span>Cari</span>
          </button>
        </form>

        {loading && <LoadingSpinner label="Mencari..." />}

        {!loading && searched && (
          <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
            <div className="p-3 bg-muted border-b border-border">
              <span className="font-medium">{results.length} hasil ditemukan</span>
            </div>
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-4 py-2 text-left w-32">Kode HS</th>
                    <th className="px-4 py-2 text-left">Deskripsi</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                        Tidak ada hasil untuk &quot;{query}&quot;
                      </td>
                    </tr>
                  ) : (
                    results.map((hs, i) => (
                      <tr key={i} className="border-t border-border hover:bg-muted/50">
                        <td className="px-4 py-2 font-mono font-medium text-primary">
                          {hs.kode_hs}
                        </td>
                        <td className="px-4 py-2">{hs.deskripsi}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Quick Reference */}
        {!searched && (
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold mb-3">Referensi Cepat</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-muted">
                <div className="font-mono font-medium">01-05</div>
                <div className="text-muted-foreground">Hewan hidup & produk hewan</div>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <div className="font-mono font-medium">06-15</div>
                <div className="text-muted-foreground">Produk nabati</div>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <div className="font-mono font-medium">16-24</div>
                <div className="text-muted-foreground">Makanan olahan</div>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <div className="font-mono font-medium">25-27</div>
                <div className="text-muted-foreground">Produk mineral</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
