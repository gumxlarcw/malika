// Icon and color mapping for datasource categories
// Used by Kategori page components

export type CategoryStyle = {
  icon: string; // emoji or icon name
  bgColor: string; // Tailwind bg class
  textColor: string; // Tailwind text class
  iconColor: string; // Tailwind icon/accent class
};

const categoryKeywords: Array<{ pattern: RegExp; style: CategoryStyle }> = [
  // Agriculture & Nature
  {
    pattern: /pertanian|kehutanan|perikanan|pangan/i,
    style: {
      icon: "🌾",
      bgColor: "bg-green-50 dark:bg-green-500/10",
      textColor: "text-green-700 dark:text-green-400",
      iconColor: "text-green-500",
    },
  },
  {
    pattern: /hortikultura|perkebunan|peternakan|tanaman/i,
    style: {
      icon: "🥕",
      bgColor: "bg-lime-50 dark:bg-lime-500/10",
      textColor: "text-lime-700 dark:text-lime-400",
      iconColor: "text-lime-500",
    },
  },
  // Economy & Finance
  {
    pattern: /neraca.*ekonomi|ekonomi/i,
    style: {
      icon: "📊",
      bgColor: "bg-blue-50 dark:bg-blue-500/10",
      textColor: "text-blue-700 dark:text-blue-400",
      iconColor: "text-blue-500",
    },
  },
  {
    pattern: /keuangan|fiskal|sektor.*publik/i,
    style: {
      icon: "💰",
      bgColor: "bg-emerald-50 dark:bg-emerald-500/10",
      textColor: "text-emerald-700 dark:text-emerald-400",
      iconColor: "text-emerald-500",
    },
  },
  {
    pattern: /harga/i,
    style: {
      icon: "💵",
      bgColor: "bg-yellow-50 dark:bg-yellow-500/10",
      textColor: "text-yellow-700 dark:text-yellow-400",
      iconColor: "text-yellow-500",
    },
  },
  // Social
  {
    pattern: /pendidikan/i,
    style: {
      icon: "📚",
      bgColor: "bg-purple-50 dark:bg-purple-500/10",
      textColor: "text-purple-700 dark:text-purple-400",
      iconColor: "text-purple-500",
    },
  },
  {
    pattern: /kesehatan/i,
    style: {
      icon: "🏥",
      bgColor: "bg-red-50 dark:bg-red-500/10",
      textColor: "text-red-700 dark:text-red-400",
      iconColor: "text-red-500",
    },
  },
  {
    pattern: /kemiskinan|tempat.*tinggal|sosial.*lintas/i,
    style: {
      icon: "🏠",
      bgColor: "bg-amber-50 dark:bg-amber-500/10",
      textColor: "text-amber-700 dark:text-amber-400",
      iconColor: "text-amber-500",
    },
  },
  {
    pattern: /kependudukan|migrasi/i,
    style: {
      icon: "👥",
      bgColor: "bg-cyan-50 dark:bg-cyan-500/10",
      textColor: "text-cyan-700 dark:text-cyan-400",
      iconColor: "text-cyan-500",
    },
  },
  {
    pattern: /ketenagakerjaan|tenaga.*kerja/i,
    style: {
      icon: "👷",
      bgColor: "bg-indigo-50 dark:bg-indigo-500/10",
      textColor: "text-indigo-700 dark:text-indigo-400",
      iconColor: "text-indigo-500",
    },
  },
  {
    pattern: /gender|populasi.*khusus/i,
    style: {
      icon: "👨‍👩‍👧",
      bgColor: "bg-pink-50 dark:bg-pink-500/10",
      textColor: "text-pink-700 dark:text-pink-400",
      iconColor: "text-pink-500",
    },
  },
  // Trade & Industry
  {
    pattern: /exim|ekspor|impor|perdagangan.*internasional/i,
    style: {
      icon: "🚢",
      bgColor: "bg-orange-50 dark:bg-orange-500/10",
      textColor: "text-orange-700 dark:text-orange-400",
      iconColor: "text-orange-500",
    },
  },
  {
    pattern: /pertambangan|manufaktur|konstruksi|industri/i,
    style: {
      icon: "🏭",
      bgColor: "bg-slate-50 dark:bg-slate-500/10",
      textColor: "text-slate-700 dark:text-slate-400",
      iconColor: "text-slate-500",
    },
  },
  {
    pattern: /statistik.*bisnis/i,
    style: {
      icon: "📈",
      bgColor: "bg-teal-50 dark:bg-teal-500/10",
      textColor: "text-teal-700 dark:text-teal-400",
      iconColor: "text-teal-500",
    },
  },
  // Other
  {
    pattern: /pariwisata/i,
    style: {
      icon: "✈️",
      bgColor: "bg-sky-50 dark:bg-sky-500/10",
      textColor: "text-sky-700 dark:text-sky-400",
      iconColor: "text-sky-500",
    },
  },
  {
    pattern: /transportasi/i,
    style: {
      icon: "🚗",
      bgColor: "bg-violet-50 dark:bg-violet-500/10",
      textColor: "text-violet-700 dark:text-violet-400",
      iconColor: "text-violet-500",
    },
  },
  {
    pattern: /energi/i,
    style: {
      icon: "⚡",
      bgColor: "bg-yellow-50 dark:bg-yellow-500/10",
      textColor: "text-yellow-700 dark:text-yellow-400",
      iconColor: "text-yellow-500",
    },
  },
  {
    pattern: /lingkungan/i,
    style: {
      icon: "🌿",
      bgColor: "bg-green-50 dark:bg-green-500/10",
      textColor: "text-green-700 dark:text-green-400",
      iconColor: "text-green-500",
    },
  },
  {
    pattern: /pemukiman|perumahan/i,
    style: {
      icon: "🏘️",
      bgColor: "bg-stone-50 dark:bg-stone-500/10",
      textColor: "text-stone-700 dark:text-stone-400",
      iconColor: "text-stone-500",
    },
  },
  {
    pattern: /konsumsi|pendapatan/i,
    style: {
      icon: "🛒",
      bgColor: "bg-rose-50 dark:bg-rose-500/10",
      textColor: "text-rose-700 dark:text-rose-400",
      iconColor: "text-rose-500",
    },
  },
  {
    pattern: /budaya/i,
    style: {
      icon: "🎭",
      bgColor: "bg-fuchsia-50 dark:bg-fuchsia-500/10",
      textColor: "text-fuchsia-700 dark:text-fuchsia-400",
      iconColor: "text-fuchsia-500",
    },
  },
  {
    pattern: /politik|komunitas/i,
    style: {
      icon: "🗳️",
      bgColor: "bg-neutral-50 dark:bg-neutral-500/10",
      textColor: "text-neutral-700 dark:text-neutral-400",
      iconColor: "text-neutral-500",
    },
  },
  {
    pattern: /statistik.*regional|area.*kecil/i,
    style: {
      icon: "🗺️",
      bgColor: "bg-cyan-50 dark:bg-cyan-500/10",
      textColor: "text-cyan-700 dark:text-cyan-400",
      iconColor: "text-cyan-500",
    },
  },
  {
    pattern: /masyarakat.*informasi/i,
    style: {
      icon: "💻",
      bgColor: "bg-blue-50 dark:bg-blue-500/10",
      textColor: "text-blue-700 dark:text-blue-400",
      iconColor: "text-blue-500",
    },
  },
  {
    pattern: /berita.*resmi.*statistik|brs/i,
    style: {
      icon: "📰",
      bgColor: "bg-amber-50 dark:bg-amber-500/10",
      textColor: "text-amber-700 dark:text-amber-400",
      iconColor: "text-amber-500",
    },
  },
  {
    pattern: /peradilan|kriminal/i,
    style: {
      icon: "⚖️",
      bgColor: "bg-slate-50 dark:bg-slate-500/10",
      textColor: "text-slate-700 dark:text-slate-400",
      iconColor: "text-slate-500",
    },
  },
  {
    pattern: /perlindungan.*sosial/i,
    style: {
      icon: "🛡️",
      bgColor: "bg-blue-50 dark:bg-blue-500/10",
      textColor: "text-blue-700 dark:text-blue-400",
      iconColor: "text-blue-500",
    },
  },
];

const defaultStyle: CategoryStyle = {
  icon: "📋",
  bgColor: "bg-gray-50 dark:bg-gray-500/10",
  textColor: "text-gray-700 dark:text-gray-400",
  iconColor: "text-gray-500",
};

export function getCategoryStyle(categoryName: string): CategoryStyle {
  for (const { pattern, style } of categoryKeywords) {
    if (pattern.test(categoryName)) {
      return style;
    }
  }
  return defaultStyle;
}

export function getCategoryIcon(categoryName: string): string {
  return getCategoryStyle(categoryName).icon;
}
