import type { Metadata } from "next";
import ArchiveBrowser from "@/components/archive/ArchiveBrowser";

export const metadata: Metadata = {
  title: "Publikasi",
  description: "Publikasi",
};

export const dynamic = "force-dynamic";

export default function PublikasiPage() {
  return <ArchiveBrowser defaultKind="publication" />;
}
