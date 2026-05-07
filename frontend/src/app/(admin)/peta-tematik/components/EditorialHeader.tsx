"use client";
import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface Props {
  totalIndikator: number;
  actions?: ReactNode;
}

/**
 * Page intro: H1 + intro paragraph on the left, action toolbar slot on the right.
 * Matches design bundle's split layout (app.jsx: page intro before FilterBar).
 */
export default function EditorialHeader({ totalIndikator, actions }: Props) {
  return (
    <header className="mb-5">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        className="flex items-start justify-between gap-4 flex-wrap"
      >
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-[22px] sm:text-[26px] tracking-tight leading-tight text-gray-900 dark:text-white">
            Peta Tematik <span className="text-[#3641f5] dark:text-blue-400">Maluku Utara</span>
          </h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
            <span className="font-semibold text-gray-700 dark:text-gray-200">{totalIndikator}</span>{" "}
            indikator dari Badan Pusat Statistik. Pilih topik di bawah, jelajahi tren antar tahun, dan bandingkan capaian antar kabupaten/kota.
          </p>
        </div>
        {actions && <div className="flex flex-shrink-0 items-center">{actions}</div>}
      </motion.div>
    </header>
  );
}
