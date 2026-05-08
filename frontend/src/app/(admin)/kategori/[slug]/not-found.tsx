import Link from "next/link";

export default function KategoriNotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-300">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-gray-900 dark:text-white/95">
        Kategori tidak ditemukan
      </h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        Kategori yang kamu cari mungkin sudah dihapus atau pindah. Lihat daftar
        kategori yang tersedia.
      </p>
      <Link
        href="/kategori"
        className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600"
      >
        Kembali ke Kategori
      </Link>
    </div>
  );
}
