"use client";

import React, { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { getCopy, type Lang } from "../_lib/copy";
import { PAGE_BG } from "../_lib/ui";
import AboutStrip from "./AboutStrip";
import HeadlineFigures from "./HeadlineFigures";
import Hero from "./Hero";
import KategoriGrid from "./KategoriGrid";
import Konsultasi from "./Konsultasi";
import LandingFooter from "./LandingFooter";
import LandingHeader from "./LandingHeader";
import LandingModals, { type ModalKind } from "./LandingModals";
import LayananResmi from "./LayananResmi";
import MenuGrid from "./MenuGrid";
import PetaPreview from "./PetaPreview";
import RilisTrending from "./RilisTrending";

/**
 * Landing page root. Owns the two pieces of state every section reads —
 * the display language and which dialog is open — and nothing else; section
 * animations and timers stay local to the section that runs them.
 */
export default function LandingClient() {
  const [lang, setLang] = useState<Lang>("id");
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [petugas, setPetugas] = useState(0);
  const t = getCopy(lang);

  const closeModal = useCallback(() => setModal(null), []);
  const openReservasi = useCallback(() => setModal("reservasi"), []);
  const openMasuk = useCallback(() => setModal("masuk"), []);
  const openNotif = useCallback(() => setModal("notif"), []);
  const openPetugas = useCallback((index: number) => {
    setPetugas(index);
    setModal("petugas");
  }, []);

  return (
    <div className={cn("min-h-screen font-outfit", PAGE_BG)}>
      <LandingHeader t={t} lang={lang} onLangChange={setLang} onOpenNotif={openNotif} />

      <main>
        <Hero t={t} lang={lang} />
        <MenuGrid t={t} onOpenReservasi={openReservasi} />
        <HeadlineFigures t={t} />
        <PetaPreview t={t} lang={lang} />
        <Konsultasi
          t={t}
          onOpenReservasi={openReservasi}
          onOpenMasuk={openMasuk}
          onOpenPetugas={openPetugas}
        />
        <KategoriGrid t={t} />
        <RilisTrending t={t} />
        <AboutStrip t={t} />
        <LayananResmi t={t} />
      </main>

      <LandingFooter t={t} />

      <LandingModals
        t={t}
        lang={lang}
        modal={modal}
        petugas={petugas}
        onClose={closeModal}
        onOpenReservasi={openReservasi}
      />
    </div>
  );
}
