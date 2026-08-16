import type { Metadata } from "next";
import React from "react";
import LandingClient from "./_components/LandingClient";

export const metadata: Metadata = {
  // `absolute` bypasses the root layout's "%s | MALIKA" template — this is the
  // site root, so it should read as the site's own name, not "Beranda | MALIKA".
  title: { absolute: "MALIKA — Portal Data BPS Provinsi Maluku Utara" },
  description:
    "Portal data BPS Provinsi Maluku Utara — tanya MALIKA, jelajahi peta tematik, dan temukan rilis statistik resmi.",
};

export default function LandingPage() {
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
