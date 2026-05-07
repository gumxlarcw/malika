function norm(input: string) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqLimit(list: string[], limit: number) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const v = String(raw || '').trim();
    if (v.length < 2) continue;
    const k = norm(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

function stripKnownGeoNoise(keyword: string) {
  // BPS keyword endpoints often fail for overly specific phrases like
  // "gini ratio maluku utara"; add a simpler variant without geo.
  return norm(keyword)
    .replace(/\bprovinsi\s+maluku\s+utara\b/g, ' ')
    .replace(/\bmaluku\s+utara\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function expandBpsKeywordVariants(args: {
  q: string;
  base: string[];
  datasourceCategories?: Array<string | null | undefined>;
}): string[] {
  const qNorm = norm(args.q);
  const base = Array.isArray(args.base) ? args.base : [];

  const extra: string[] = [];

  // Add simplified variants without geo noise.
  for (const b of base) {
    const stripped = stripKnownGeoNoise(b);
    if (stripped && stripped !== norm(b)) extra.push(stripped);
  }

  // Category hints from datasource candidates.
  const cats = (args.datasourceCategories || [])
    .map((c) => String(c || '').trim())
    .filter(Boolean);
  for (const c of cats) {
    const cNorm = norm(c);
    if (cNorm === 'pariwisata') {
      // Tourism-related indicators are often covered in BRS/pubs under broader keywords.
      extra.push('hotel');
      extra.push('tingkat penghunian kamar');
    }
    if (cNorm === 'inflasi' || cNorm === 'harga-harga') {
      extra.push('inflasi');
      extra.push('indeks harga konsumen');
    }
    if (cNorm === 'ketenagakerjaan') {
      extra.push('ketenagakerjaan');
      extra.push('tenaga kerja');
      extra.push('angkatan kerja');
    }
    if (cNorm === 'kemiskinan') {
      extra.push('kemiskinan');
      extra.push('ketimpangan');
      extra.push('gini ratio');
    }
    if (cNorm === 'pendidikan') {
      extra.push('pendidikan');
      extra.push('angka partisipasi sekolah');
    }
    if (cNorm === 'kependudukan') {
      extra.push('penduduk');
      extra.push('kependudukan');
    }
    if (cNorm === 'ekonomi' || cNorm === 'pdrb') {
      extra.push('pdrb');
      extra.push('produk domestik regional bruto');
    }
  }

  // Query-hint expansions.
  if (/(\bkamar\b|\bakomodasi\b|\btempat\s+tidur\b|\bhotel\b|\bnonbintang\b|\bbintang\b)/i.test(qNorm)) {
    extra.push('hotel');
  }
  if (/\btpk\b/i.test(qNorm)) {
    extra.push('tingkat penghunian kamar');
  }
  if (/\bihk\b/i.test(qNorm)) {
    extra.push('indeks harga konsumen');
    extra.push('inflasi');
  }

  // Common indicator → broader BPS keyword variants.
  if (/(\bgini\b|\bgini\s+ratio\b|\bketimpangan\b|\bdistribusi\s+pendapatan\b)/i.test(qNorm)) {
    extra.push('gini ratio');
    extra.push('ketimpangan');
    extra.push('distribusi pendapatan');
  }

  if (/(\btpak\b|\bketenagakerjaan\b|\btenaga\s+kerja\b|\bangkatan\s+kerja\b|\bpengangguran\b)/i.test(qNorm)) {
    extra.push('ketenagakerjaan');
    extra.push('tenaga kerja');
    extra.push('angkatan kerja');
    extra.push('pengangguran');
    extra.push('tpak');
  }

  if (/(\bpdrb\b|\bproduk\s+domestik\b|\bpertumbuhan\s+ekonomi\b)/i.test(qNorm)) {
    extra.push('pdrb');
    extra.push('produk domestik regional bruto');
    extra.push('pertumbuhan ekonomi');
  }

  if (/(\bpendidikan\b|\bsekolah\b|\bsma\b|\bsmk\b|\bsd\b|\bsmp\b|\bapk\b|\bapm\b|\bpartisipasi\b)/i.test(qNorm)) {
    extra.push('pendidikan');
    extra.push('angka partisipasi sekolah');
    extra.push('apk');
    extra.push('apm');
  }

  if (/(\bpenduduk\b|\bkependudukan\b|\bsensus\b|\bsp2020\b)/i.test(qNorm)) {
    extra.push('penduduk');
    extra.push('kependudukan');
    extra.push('sensus penduduk');
  }

  if (/(\bstunting\b|\bgizi\b|\bbalita\b|\bstatus\s+gizi\b|\b1000\s*hpk\b)/i.test(qNorm)) {
    extra.push('stunting');
    extra.push('gizi');
    extra.push('kesehatan');
  }

  if (/(\bperikanan\b|\bikan\b|\btangkapan\b|\bnelayan\b|\baquakultur\b|\bbudidaya\b)/i.test(qNorm)) {
    extra.push('perikanan');
    extra.push('ikan');
    extra.push('kelautan');
  }

  if (/(\bbandara\b|\bpenerbangan\b|\bpenumpang\b|\bpesawat\b|\bangkutan\s+udara\b)/i.test(qNorm)) {
    extra.push('angkutan udara');
    extra.push('bandara');
    extra.push('transportasi udara');
  }

  if (/(\bekspor\b|\bimpor\b|\bperdagangan\b|\bluar\s+negeri\b)/i.test(qNorm)) {
    extra.push('perdagangan luar negeri');
    extra.push('ekspor');
    extra.push('impor');
  }

  // Keep list small; each keyword multiplies BPS page fetches.
  return uniqLimit([...base, ...extra], 5);
}
