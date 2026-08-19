/**
 * Indicator unit resolution.
 *
 * The bug this guards: "Jumlah Penduduk Miskin" stores 10.53 meaning 10,530
 * people, but a decimal that small reads as a percentage and was reported as
 * "10,53%". The fix is to state the unit; the risk is stating a wrong one, so
 * "unknown" must stay unknown rather than become a guess.
 */

const {
  resolveIndicatorUnit,
  formatUnitContext,
  _clearCache,
} = require('../services/chat/indicatorUnit.service');

beforeEach(() => _clearCache());

describe('resolveIndicatorUnit', () => {
  const loader = async (id) => ({ 452: 'Ribu Jiwa', 315: 'Persen', 428: null }[id]);

  it('returns the unit recorded in metadata', async () => {
    await expect(resolveIndicatorUnit(452, { loader })).resolves.toBe('Ribu Jiwa');
    await expect(resolveIndicatorUnit(315, { loader })).resolves.toBe('Persen');
  });

  it('returns null when metadata records no unit', async () => {
    await expect(resolveIndicatorUnit(428, { loader })).resolves.toBeNull();
  });

  it.each([[null], [undefined], [0], [-5], ['abc'], [NaN]])(
    'returns null for invalid source id %p',
    async (id) => {
      await expect(resolveIndicatorUnit(id, { loader })).resolves.toBeNull();
    },
  );

  it('treats a blank unit as unknown', async () => {
    await expect(resolveIndicatorUnit(9, { loader: async () => '   ' })).resolves.toBeNull();
  });

  it('never lets a metadata failure cost the user their answer', async () => {
    const boom = async () => { throw new Error('db down'); };
    await expect(resolveIndicatorUnit(452, { loader: boom })).resolves.toBeNull();
  });

  it('caches so a lookup does not repeat per chat turn', async () => {
    let calls = 0;
    const counting = async () => { calls += 1; return 'Ribu Jiwa'; };
    const store = new Map();
    await resolveIndicatorUnit(452, { loader: counting, cache: store });
    await resolveIndicatorUnit(452, { loader: counting, cache: store });
    expect(calls).toBe(1);
  });
});

describe('formatUnitContext', () => {
  it('states a known unit and forbids converting it', () => {
    const out = formatUnitContext('Ribu Jiwa');
    expect(out).toContain('Ribu Jiwa');
    expect(out).toMatch(/persen/i); // explicitly warns against the observed failure
  });

  it('forbids inventing a unit when none is recorded', () => {
    const out = formatUnitContext(null);
    expect(out).toMatch(/JANGAN mengarang satuan/i);
    expect(out).not.toMatch(/Satuan nilai: /);
  });
});
