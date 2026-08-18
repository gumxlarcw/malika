'use strict';

// The prompt asks the model to keep its reasoning free of internal instructions,
// and mostly it complies — measured 0/8 English, 0/8 markdown, but 2/8 still
// quoted our own constraints back. This is the net under that 25%.

const { sanitizeReasoningLine } = require('../chatUtils');

const kept = (line) => expect(sanitizeReasoningLine(line)).toBe(line);
const dropped = (line) => expect(sanitizeReasoningLine(line)).toBeNull();

describe('sanitizeReasoningLine', () => {
  test('keeps ordinary reasoning', () => {
    kept('Data menunjukkan persentase penduduk miskin Maret 2025 sebesar 5,81 persen.');
    kept('Kita perlu menjawab pertanyaan user tentang garis kemiskinan.');
  });

  test('drops our own answer-shape constraints', () => {
    dropped('    *   Constraint: Must answer directly with one main number.');
    dropped('Max 5-6 sentences. Do not list multiple sources.');
    dropped('- Batas: maksimal 4-5 kalimat.');
  });

  test('drops references to internal prompt plumbing', () => {
    dropped('Check the Data Preview (System Message)');
    dropped('Must use data from dataPreview if available.');
    dropped('Dokumen di atas berasal dari KNOWLEDGE BASE (informasi internal BPS).');
    dropped('INSTRUKSI PENTING: prioritaskan angka dari rows.');
  });

  test('does not drop a line merely for naming a data table', () => {
    kept('Tabel yang tersedia memuat data kemiskinan per kabupaten.');
    kept('Saya akan menggunakan angka dari tabel tersebut.');
  });

  test('strips markdown emphasis but keeps the sentence', () => {
    expect(sanitizeReasoningLine('1. **Analisis pertanyaan**: soal kemiskinan'))
      .toBe('1. Analisis pertanyaan: soal kemiskinan');
  });

  test('strips list bullets that would render as stray asterisks', () => {
    expect(sanitizeReasoningLine('    *   Question: apa itu garis kemiskinan?'))
      .toBe('    Question: apa itu garis kemiskinan?');
  });

  test('leaves arithmetic and prose asterisks alone', () => {
    kept('Nilai 3 * 4 dihitung terpisah.');
  });

  test('handles blank and non-string input', () => {
    expect(sanitizeReasoningLine('')).toBe('');
    expect(sanitizeReasoningLine(null)).toBe('');
  });
});
