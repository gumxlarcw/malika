const {
  getPressReleaseKeywordTableName,
} = require('../services/replication/pressreleaseTableBps.service');

describe('pressrelease table naming', () => {
  test('deterministic per keyword', () => {
    const a = getPressReleaseKeywordTableName('Inflasi');
    const b = getPressReleaseKeywordTableName(' inflasi ');
    expect(a).toBe(b);
  });

  test('produces safe length', () => {
    const long = 'ini keyword yang sangat panjang sekali dan mengandung spasi + simbol !!!'.repeat(5);
    const name = getPressReleaseKeywordTableName(long);
    expect(typeof name).toBe('string');
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith('pressrelease_kw_')).toBe(true);
  });
});
