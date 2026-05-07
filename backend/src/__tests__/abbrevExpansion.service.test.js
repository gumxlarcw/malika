const { expandLocal, shouldTryOpenAi } = require('../services/ai/abbrevExpansion.service');

describe('abbrevExpansion', () => {
  test('expandLocal expands common indicator abbreviations', () => {
    const terms = expandLocal('PDRB Maluku Utara 2024');
    expect(terms).toEqual(expect.arrayContaining(['produk domestik regional bruto']));
  });

  test('shouldTryOpenAi detects uppercase abbreviations', () => {
    expect(shouldTryOpenAi('IPM maluku utara')).toBe(true);
    expect(shouldTryOpenAi('inflasi maret 2025')).toBe(false);
  });
});
