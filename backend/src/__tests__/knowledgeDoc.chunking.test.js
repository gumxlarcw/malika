/**
 * Tests for semantic chunking in knowledgeDoc.service.js
 */

const { detectNumberedSections, smartChunkText, chunkText } = require('../services/ai/knowledgeDoc.service');

describe('detectNumberedSections', () => {
  test('detects "1. Question" format', () => {
    const text = `
1. Apa itu Sensus Ekonomi?
Sensus Ekonomi adalah pendataan lengkap tentang usaha.

2. Kapan dilaksanakan?
Sensus dilaksanakan mulai Mei 2026.

3. Apa manfaatnya?
Manfaat Sensus Ekonomi antara lain data dasar perencanaan.
`;
    const result = detectNumberedSections(text);
    expect(result).not.toBeNull();
    expect(result.matches.length).toBe(3);
  });

  test('detects "FAQ 1:" format', () => {
    const text = `
FAQ 1: Apa itu inflasi?
Inflasi adalah kenaikan harga barang secara umum.

FAQ 2: Bagaimana cara menghitung?
Inflasi dihitung dari perubahan IHK.

FAQ 3: Apa dampaknya?
Dampak inflasi termasuk penurunan daya beli.
`;
    const result = detectNumberedSections(text);
    expect(result).not.toBeNull();
    expect(result.matches.length).toBe(3);
  });

  test('detects "Pertanyaan 1:" format', () => {
    const text = `
Pertanyaan 1: Apa itu BPS?
BPS adalah lembaga statistik nasional.

Pertanyaan 2: Apa tugas BPS?
BPS bertugas menyediakan data statistik.

Pertanyaan 3: Dimana kantor BPS?
Kantor BPS ada di setiap provinsi dan kabupaten/kota.
`;
    const result = detectNumberedSections(text);
    expect(result).not.toBeNull();
    expect(result.matches.length).toBe(3);
  });

  test('returns null for non-FAQ text', () => {
    const text = `
Inflasi adalah kenaikan harga barang dan jasa secara umum.
BPS menghitung inflasi menggunakan Indeks Harga Konsumen.
Data inflasi dirilis setiap bulan.
Tahun 2025 inflasi Indonesia relatif terkendali.
`;
    const result = detectNumberedSections(text);
    expect(result).toBeNull();
  });

  test('returns null for text with less than 3 numbered items', () => {
    const text = `
1. Item pertama
Penjelasan item pertama.

2. Item kedua
Penjelasan item kedua.
`;
    const result = detectNumberedSections(text);
    expect(result).toBeNull();
  });
});

describe('smartChunkText', () => {
  test('chunks FAQ-style document by sections', () => {
    const text = `
FAQ Sensus Ekonomi 2026

1. Apa itu Sensus Ekonomi?
Sensus Ekonomi adalah pendataan lengkap tentang usaha di Indonesia yang dilakukan oleh BPS.

2. Kapan Sensus Ekonomi dilaksanakan?
Sensus Ekonomi 2026 dilaksanakan mulai bulan Mei 2026 hingga selesai.

3. Apa manfaat Sensus Ekonomi?
Manfaat Sensus Ekonomi antara lain:
- Data dasar perencanaan pembangunan
- Informasi struktur ekonomi
- Basis sampling survei lanjutan

4. Siapa yang menjadi objek?
Objek SE2026 adalah seluruh usaha/perusahaan non-pertanian di Indonesia.

5. Bagaimana cara ikut serta?
Anda akan dikunjungi petugas BPS untuk pendataan secara langsung.
`;
    const chunks = smartChunkText(text);
    
    // Should create 5 chunks (one per section)
    expect(chunks.length).toBe(5);
    
    // Each chunk should contain a question
    for (const chunk of chunks) {
      expect(chunk).toMatch(/\?/);
    }
  });

  test('preserves question and answer in same chunk', () => {
    const text = `
1. Apa itu inflasi?
Inflasi adalah kenaikan harga barang dan jasa secara umum dalam perekonomian.

2. Bagaimana menghitung inflasi?
Inflasi dihitung dari perubahan Indeks Harga Konsumen (IHK) dari bulan ke bulan.

3. Apa dampak inflasi tinggi?
Inflasi tinggi menyebabkan daya beli masyarakat menurun karena nilai uang berkurang.
`;
    const chunks = smartChunkText(text);
    
    // Check first chunk has question and answer
    expect(chunks[0]).toContain('Apa itu inflasi?');
    expect(chunks[0]).toContain('kenaikan harga');
    
    // Check second chunk has question and answer
    expect(chunks[1]).toContain('Bagaimana menghitung');
    expect(chunks[1]).toContain('IHK');
  });

  test('falls back to standard chunking for non-FAQ text', () => {
    const text = `
Inflasi adalah kenaikan harga barang dan jasa secara umum.
BPS menghitung inflasi menggunakan Indeks Harga Konsumen.
Data inflasi dirilis setiap bulan.
`;
    const chunks = smartChunkText(text);
    
    // Short text should result in 1 chunk
    expect(chunks.length).toBe(1);
  });

  test('handles large FAQ document efficiently', () => {
    // Generate FAQ with 20 items
    let largeFaq = 'FAQ Lengkap\n\n';
    for (let i = 1; i <= 20; i++) {
      largeFaq += `${i}. Pertanyaan nomor ${i}?\n`;
      largeFaq += `Ini adalah jawaban untuk pertanyaan nomor ${i}. Jawaban ini cukup panjang untuk memastikan chunk memiliki konten yang bermakna dan bisa dicari dengan baik.\n\n`;
    }
    
    const chunks = smartChunkText(largeFaq);
    
    // Should create ~20 chunks (one per FAQ item)
    expect(chunks.length).toBe(20);
    
    // Each chunk should be reasonably sized
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(50);
      expect(chunk.length).toBeLessThan(2000);
    }
  });

  test('handles very long answer in a single FAQ item', () => {
    // One FAQ item with very long answer (over MAX_CHUNK_SIZE)
    const longAnswer = 'Jawaban panjang. '.repeat(200); // ~3400 chars
    const text = `
1. Pertanyaan dengan jawaban pendek?
Jawaban singkat satu paragraf lengkap.

2. Pertanyaan dengan jawaban sangat panjang?
${longAnswer}

3. Pertanyaan lain dengan jawaban cukup panjang?
Jawaban normal yang cukup panjang untuk tidak difilter.
`;
    
    const chunks = smartChunkText(text);
    
    // Section 1: 1 chunk, Section 2: 2 sub-chunks, Section 3: 1 chunk = 4 total
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    
    // Long answer should be split with "(lanjutan)" marker
    const continuationChunks = chunks.filter(c => c.includes('lanjutan'));
    expect(continuationChunks.length).toBeGreaterThan(0);
  });

  test('returns empty array for empty text', () => {
    expect(smartChunkText('')).toEqual([]);
    expect(smartChunkText(null)).toEqual([]);
    expect(smartChunkText(undefined)).toEqual([]);
  });

  test('returns single chunk for short text', () => {
    const shortText = 'Ini adalah teks pendek yang tidak perlu di-chunk.';
    const chunks = smartChunkText(shortText);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(shortText);
  });
});

describe('chunkText (fallback)', () => {
  test('breaks at sentence boundaries when possible', () => {
    const text = 'Kalimat pertama. Kalimat kedua. Kalimat ketiga. '.repeat(100);
    const chunks = chunkText(text, 500, 50);
    
    // Each chunk should end with period (sentence boundary)
    for (const chunk of chunks.slice(0, -1)) { // Exclude last chunk
      expect(chunk.trim()).toMatch(/\.$/);
    }
  });

  test('handles text without sentence markers', () => {
    const text = 'kata '.repeat(500);
    const chunks = chunkText(text, 200, 20);
    
    // Should still produce chunks even without periods
    expect(chunks.length).toBeGreaterThan(1);
  });
});
