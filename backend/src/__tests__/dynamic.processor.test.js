const processDynamic = require('../services/processor/dynamic.processor');

describe('dynamic.processor', () => {
  test('generates columns and rows with single turvar', () => {
    const api = {
      vervar: [{ val: '1', label: 'Wilayah' }, { val: '2', label: 'Wilayah 2' }],
      // Dynamic meta shapes follow BPS conventions (fixed-length components)
      var: [{ val: '001', label: 'Sumber A' }],
      turvar: [{ val: '000', label: 'Tidak Ada' }],
      tahun: [{ val: '124', label: '2024' }],
      turtahun: [{ val: '0', label: '0' }],
      datacontent: {
        // key = vervar + var + turvar + tahun + turtahun
        '10010001240': 10,
        '20010001240': 20,
      },
      labelvervar: 'Wilayah',
      last_update: '2024-01-01',
    };

    const result = processDynamic(api);
    expect(result.columns).toEqual(['Wilayah', 'Nilai']);
    expect(result.data).toEqual([
      { Wilayah: 'Wilayah', Nilai: 10 },
      { Wilayah: 'Wilayah 2', Nilai: 20 },
    ]);
    expect(result.period).toBe('2024');
    expect(result.source).toBe('Sumber A');
    expect(result.last_update).toBe('2024-01-01');
  });
  
  test('produces correct columns and rows for simple dynamic data', () => {
    const api = {
      vervar: [{ val: '1', label: 'Wilayah' }],
      var: [{ val: '394', label: 'PDRB Kab/Kota (Triwulanan)' }],
      turvar: [{ val: '1', label: 'ADHB' }],
      tahun: [{ val: '125', label: '2025' }],
      turtahun: [{ val: '31', label: 'Triwulan I' }],
      datacontent: {
        '8201394112531': 764.5,
      },
      last_update: '2026-01-05 09:08:18',
    };
  
    const result = processDynamic(api);
    expect(result.period).toBe('2025');
  });
  
  test('handles triwulan dynamic data (turtahun as period) with a dimension column', () => {
    const api = {
      __th_id: '125',
      labelvervar: 'Wilayah',
      vervar: [{ val: '8201', label: 'Halmahera Barat' }],
      var: [{ val: '394', label: 'PDRB Kab/Kota (Triwulanan)' }],
      turvar: [
        { val: '1', label: 'ADHB' },
        { val: '96', label: 'ADHK 2010' },
      ],
      tahun: [
        { val: '124', label: '2024' },
        { val: '125', label: '2025' },
      ],
      turtahun: [
        { val: '31', label: 'Triwulan I' },
        { val: '32', label: 'Triwulan II' },
        { val: '35', label: 'Tahunan' },
      ],
      // key = vervar + var + turvar + tahun + turtahun
      datacontent: {
        // 2025 Q1
        '8201394112531': 764.5,
        '82013949612531': 437.6,
        // 2024 Q1 (should be ignored due to __th_id filter)
        '8201394112431': 706.8,
      },
      last_update: '2026-01-05 09:08:18',
    };
  
    const result = processDynamic(api);
    expect(result.columns).toEqual(['Bulan', 'Wilayah', 'ADHB', 'ADHK 2010']);
    expect(result.period).toBe('2025');
  
    const rowQ1 = result.data.find((r) => r.Bulan === 'Triwulan I' && r.Wilayah === 'Halmahera Barat');
    expect(rowQ1).toBeTruthy();
    expect(rowQ1.ADHB).toBe(764.5);
    expect(rowQ1['ADHK 2010']).toBe(437.6);
  });
});
