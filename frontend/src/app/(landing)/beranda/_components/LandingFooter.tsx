"use client";

import React from "react";
import Link from "next/link";
import type { Copy } from "../_lib/copy";
import { MalikaMark } from "./LandingIcons";

type Props = { t: Copy };

export default function LandingFooter({ t }: Props) {
  const columns: Array<{ heading: string; links: Array<{ label: string; href: string }> }> = [
    {
      heading: t.tFootExplore,
      links: [
        { label: "Dashboard", href: "/" },
        { label: "Peta Tematik", href: "/peta-tematik" },
        { label: "Chat MALIKA", href: "/chat" },
        { label: "Data Statistik", href: "/kategori" },
        { label: "Konsultasi Langsung", href: "#konsultasi" },
      ],
    },
    {
      heading: t.tFootPub,
      links: [
        { label: "Berita Resmi Statistik", href: "/brs" },
        { label: t.tPub2, href: "/publikasi" },
        { label: t.tPub3, href: "/notifications" },
      ],
    },
    {
      heading: t.tFootHelp,
      links: [
        // The interactive guide lives in Settings.
        { label: t.tHelp1, href: "/settings" },
        { label: t.tHelp2, href: "/feedback" },
        { label: t.tHelp3, href: "/settings" },
      ],
    },
  ];

  return (
    <footer className="mt-16 bg-gray-900 text-gray-300 dark:bg-gray-950">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-6 px-[18px] py-9 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-10 md:px-8 md:py-12">
        <div>
          <span className="flex items-center gap-2.5">
            <MalikaMark className="h-7 w-7" />
            <span className="text-[17px] font-semibold text-white">MALIKA</span>
          </span>
          <p className="mt-3.5 max-w-80 text-[13px] leading-[21px] text-gray-400">
            Badan Pusat Statistik Provinsi Maluku Utara
            <br />
            Jl. Stadion No. 220, Ternate, Maluku Utara
          </p>
          <p className="mt-3 text-[13px] leading-[21px] text-gray-400">
            bps8200@bps.go.id · (0921) 3121190
            <br />
            malika.bpsmalut.com
          </p>
        </div>

        {columns.map((column) => (
          <div key={column.heading}>
            <div className="text-[13px] font-semibold uppercase tracking-[0.04em] text-white">
              {column.heading}
            </div>
            <div className="mt-3.5 flex flex-col gap-2.5">
              {column.links.map((link) => (
                <Link
                  key={`${column.heading}-${link.label}`}
                  href={link.href}
                  className="text-sm text-gray-300 transition-colors duration-150 hover:text-white"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-800">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-2 px-[18px] py-5 text-xs leading-[18px] text-gray-400 md:flex-row md:items-center md:gap-6 md:px-8">
          <span>{t.tCopy}</span>
          <span>Official statistics · free to reuse with attribution</span>
        </div>
      </div>
    </footer>
  );
}
