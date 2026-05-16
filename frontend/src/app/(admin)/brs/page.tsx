import type { Metadata } from "next";
import ArchiveBrowser from "@/components/archive/ArchiveBrowser";

export const metadata: Metadata = {
  title: "Berita Resmi Statistik",
  description: "Berita Resmi Statistik",
};

export const dynamic = "force-dynamic";

export default function BeritaResmiStatistikPage() {
  return <ArchiveBrowser defaultKind="report" />;
}
