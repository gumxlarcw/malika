const { classify, KATEGORI_LIST } = require('../services/petaTematik/categorization.service');

describe('categorization', () => {
  describe('classify', () => {
    test('Kependudukan keywords', () => {
      expect(classify('Proyeksi Penduduk Menurut Kabupaten/Kota')).toBe('Kependudukan');
      expect(classify('Kepadatan Penduduk Menurut Kabupten/Kota')).toBe('Kependudukan');
      expect(classify('Rasio Jenis Kelamin Menurut Kabupaten/Kota')).toBe('Kependudukan');
      expect(classify('Rumah Tangga dan Rata-rata Banyaknya Anggota Rumah Tangga')).toBe('Kependudukan');
    });

    test('Ketenagakerjaan keywords', () => {
      expect(classify('Tingkat Pengangguran Terbuka (TPT) Kabupaten/Kota')).toBe('Ketenagakerjaan');
      expect(classify('Tingkat Partisipasi Angkatan Kerja (TPAK) Menurut Kabupaten/Kota')).toBe('Ketenagakerjaan');
      expect(classify('Pencari Kerja Terdaftar')).toBe('Ketenagakerjaan');
    });

    test('Pendidikan keywords', () => {
      expect(classify('Harapan Lama Sekolah Menurut Kabupaten/Kota (Tahun)')).toBe('Pendidikan');
      expect(classify('Rata-Rata Lama Sekolah Menurut Kabupaten/Kota (Tahun)')).toBe('Pendidikan');
    });

    test('Kesehatan keywords', () => {
      expect(classify('[Metode Baru] Umur Harapan Hidup Saat Lahir (UHH)')).toBe('Kesehatan');
    });

    test('Ekonomi keywords', () => {
      expect(classify('[Seri 2010] Produk Domestik Regional Bruto Menurut Kabupaten/Kota')).toBe('Ekonomi');
      expect(classify('Persentase Penduduk Miskin Maluku Utara')).toBe('Ekonomi');
      expect(classify('Inflasi Provinsi Maluku Utara')).toBe('Ekonomi');
      expect(classify('Nilai Tukar Petani')).toBe('Ekonomi');
    });

    test('Pariwisata & Akomodasi keywords', () => {
      expect(classify('Jumlah Perjalanan Wisatawan Nusantara Menurut Kabupaten Tujuan'))
        .toBe('Pariwisata & Akomodasi');
      expect(classify('Tingkat Penghunian Kamar Hotel Bintang dan Non Bintang'))
        .toBe('Pariwisata & Akomodasi');
    });

    test('Pembangunan & Sosial keywords', () => {
      expect(classify('[Metode Baru] Indeks Pembangunan Manusia')).toBe('Pembangunan & Sosial');
      expect(classify('Jumlah Perceraian Menurut Kabupaten/Kota')).toBe('Pembangunan & Sosial');
    });

    test('falls back to Lainnya', () => {
      expect(classify('Some Random Indikator Title Without Keyword')).toBe('Lainnya');
      expect(classify('XYZ ABC')).toBe('Lainnya');
    });

    test('handles falsy input', () => {
      expect(classify('')).toBe('Lainnya');
      expect(classify(null)).toBe('Lainnya');
      expect(classify(undefined)).toBe('Lainnya');
    });

    test('case-insensitive', () => {
      expect(classify('PENDUDUK MISKIN')).toBe('Ekonomi');
      expect(classify('penduduk miskin')).toBe('Ekonomi');
    });
  });

  describe('KATEGORI_LIST', () => {
    test('exposes 8 kategori (7 + Lainnya) in order', () => {
      expect(KATEGORI_LIST).toEqual([
        'Kependudukan',
        'Ketenagakerjaan',
        'Pendidikan',
        'Kesehatan',
        'Ekonomi',
        'Pariwisata & Akomodasi',
        'Pembangunan & Sosial',
        'Lainnya',
      ]);
    });
  });
});
