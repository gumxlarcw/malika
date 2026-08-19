/**
 * Response-side disclosure filter.
 *
 * Backstop for the model formatting an individual-level disclosure mid-answer.
 * The contract that matters: the records following a disclosure header must
 * never stream, and the persisted text must not contain the header either —
 * filtering the stream but storing the raw text would put it straight back on
 * screen at replay.
 */

const {
  createDisclosureFilter,
  hasDisclosure,
  sanitizeReasoningTrace,
} = require('../services/chat/chatUtils');

/** Feed a string through the filter one small delta at a time, as the LLM would. */
function streamThrough(filter, text, size = 4) {
  let forwarded = '';
  for (let i = 0; i < text.length; i += size) {
    const out = filter.push(text.slice(i, i + size));
    if (out) forwarded += out;
  }
  return forwarded;
}

describe('createDisclosureFilter — ordinary answers pass through untouched', () => {
  it.each([
    'Jumlah penduduk miskin di Ternate tercatat 12,3 ribu jiwa pada 2024.',
    'Berikut daftar orang yang bekerja menurut lapangan usaha.',
    'Berikut daftar nama kabupaten/kota di Maluku Utara.',
    'Identitas responden dirahasiakan oleh undang-undang.',
    'Nama indikator: Persentase Penduduk Miskin.',
  ])('forwards intact: "%s"', (answer) => {
    const filter = createDisclosureFilter();
    expect(streamThrough(filter, answer)).toBe(answer);
    expect(filter.tripped()).toBe(false);
    expect(filter.text()).toBe(answer);
  });
});

describe('createDisclosureFilter — halts on a disclosure header', () => {
  it('suppresses the records that follow the header', () => {
    const filter = createDisclosureFilter();
    const leak = 'Berikut datanya. Nama responden: Budi Santoso, 42 tahun, Ternate.';
    const forwarded = streamThrough(filter, leak);

    expect(filter.tripped()).toBe(true);
    expect(forwarded).not.toContain('Budi Santoso');
    expect(forwarded).not.toContain('42 tahun');
    // Text before the header is legitimate and still reaches the user.
    expect(forwarded).toContain('Berikut datanya.');
  });

  it('truncates persisted text at the match so replay cannot show it', () => {
    const filter = createDisclosureFilter();
    streamThrough(filter, 'Data tersedia. Data per individu: 1. Ahmad, 2. Siti');

    expect(filter.text()).not.toContain('Ahmad');
    expect(filter.text()).not.toContain('Data per individu');
    expect(filter.text()).toContain('Data tersedia.');
  });

  it('appends the confidentiality notice to the persisted text', () => {
    const filter = createDisclosureFilter();
    streamThrough(filter, 'Nama responden: Budi');
    expect(filter.text()).toMatch(/Pasal 21/);
  });

  it('stays tripped and suppresses everything after the match', () => {
    const filter = createDisclosureFilter();
    streamThrough(filter, 'Nama responden: Budi.');
    expect(filter.push(' Data lain menyusul.')).toBeNull();
    expect(filter.push('Masih ada.')).toBeNull();
  });

  it.each([
    'Nama responden: Budi',
    'Berikut daftar nama responden survei:',
    'Data per individu: satu',
    'Identitas responden: NIK 8271',
  ])('catches: "%s"', (leak) => {
    const filter = createDisclosureFilter();
    streamThrough(filter, leak);
    expect(filter.tripped()).toBe(true);
  });
});

describe('createDisclosureFilter — detection survives delta fragmentation', () => {
  it('catches a header split across many deltas', () => {
    // The header arrives one character at a time, so no single delta ever
    // contains the pattern — only the accumulated text does.
    const filter = createDisclosureFilter();
    streamThrough(filter, 'Nama responden: Budi', 1);
    expect(filter.tripped()).toBe(true);
    expect(filter.text()).not.toContain('Budi');
  });
});

describe('createDisclosureFilter — input handling', () => {
  it('handles empty and non-string deltas without tripping', () => {
    const filter = createDisclosureFilter();
    expect(filter.push('')).toBe('');
    expect(filter.push(null)).toBe('');
    expect(filter.push(undefined)).toBe('');
    expect(filter.tripped()).toBe(false);
    expect(filter.text()).toBe('');
  });
});

describe('sanitizeReasoningTrace — reasoning traces are user-visible too', () => {
  it('truncates at the disclosing line, taking the records with it', () => {
    // The names sit on the lines AFTER the header and match nothing on their
    // own, so dropping only the header would leave exactly what it announced.
    const trace = [
      'Mencari data kemiskinan Ternate.',
      'Nama responden: Budi Santoso',
      '1. Ahmad, 42, Ternate',
      '2. Siti, 35, Tidore',
    ].join('\n');

    const out = sanitizeReasoningTrace(trace);
    expect(out).toBe('Mencari data kemiskinan Ternate.');
    expect(out).not.toContain('Ahmad');
    expect(out).not.toContain('Siti');
    expect(out).not.toContain('Budi');
  });

  it('leaves an ordinary trace intact', () => {
    const trace = 'Mencari indikator TPT.\nMenemukan sumber Sakernas.\nMenyusun jawaban.';
    expect(sanitizeReasoningTrace(trace)).toBe(trace);
  });

  it('still strips internal-instruction lines alongside disclosure', () => {
    // The pre-existing REASONING_INTERNAL_PATTERNS drop must survive.
    const out = sanitizeReasoningTrace('Mencari data.\nMenurut system prompt, saya harus ringkas.\nSelesai.');
    expect(out).toContain('Mencari data.');
    expect(out).toContain('Selesai.');
  });

  it('returns null when nothing survives', () => {
    expect(sanitizeReasoningTrace('Nama responden: Budi')).toBeNull();
    expect(sanitizeReasoningTrace('')).toBeNull();
    expect(sanitizeReasoningTrace(null)).toBeNull();
  });
});

describe('hasDisclosure — shared predicate', () => {
  it.each([
    'Nama responden: Budi',
    'Berikut daftar nama responden survei:',
    'Identitas responden: NIK 8271',
  ])('flags: "%s"', (line) => expect(hasDisclosure(line)).toBe(true));

  it.each([
    'Berikut daftar orang yang bekerja menurut lapangan usaha.',
    'Identitas responden dirahasiakan oleh undang-undang.',
    'Mencari indikator TPT.',
    '',
  ])('allows: "%s"', (line) => expect(hasDisclosure(line)).toBe(false));
});
