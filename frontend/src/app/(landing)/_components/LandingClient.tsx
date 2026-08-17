"use client";

import React, { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { landingNav } from "@/components/site/siteNav";
import { getCopy, type Lang } from "../_lib/copy";
import { PAGE_BG } from "../_lib/ui";
import AboutStrip from "./AboutStrip";
import HeadlineFigures from "./HeadlineFigures";
import Hero from "./Hero";
import KategoriGrid from "./KategoriGrid";
import Konsultasi from "./Konsultasi";
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
  const nav = useMemo(() => landingNav(t), [t]);

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
      <SiteHeader t={t} lang={lang} onLangChange={setLang} home="#" nav={nav} onOpenNotif={openNotif} />

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

      <SiteFooter t={t} onLanding />

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
