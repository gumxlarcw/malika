import type { Metadata } from "next";
import React from "react";
import LandingClient from "./_components/LandingClient";

export const metadata: Metadata = {
  title: "Beranda",
  description:
    "Portal data BPS Provinsi Maluku Utara — tanya MALIKA, jelajahi peta tematik, dan temukan rilis statistik resmi.",
};

export default function BerandaPage() {
  return (
    <>
      {/* Section reveals are server-rendered at opacity 0 and animated in by
          framer-motion. Without scripting that animation never runs, so the
          sections must be unhidden outright. */}
      <noscript>
        <style>{`.landing-reveal { opacity: 1 !important; transform: none !important; }`}</style>
      </noscript>
      <LandingClient />
    </>
  );
}
