"use client";
export default function Footer() {
  return (
    <footer className="w-full bg-card text-muted-foreground border-t border-border p-3 text-sm shrink-0">
      © {new Date().getFullYear()} BPS Provinsi Maluku Utara · Diseminasi dan Layanan Statistik · MALIKA Backend
    </footer>
  );
}
