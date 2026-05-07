import type { Metadata } from "next";
import PetaTematikClient from "./PetaTematikClient";

export const metadata: Metadata = {
  title: "Peta Tematik",
  description: "Visualisasi tematik data BPS Maluku Utara per kabupaten/kota",
};

export const dynamic = "force-dynamic";

export default function PetaTematikPage() {
  return <PetaTematikClient />;
}
