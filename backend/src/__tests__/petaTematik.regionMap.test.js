const { dimValueToKdkab, KDKAB_TO_NAMA } = require('../services/petaTematik/regionMap.service');

describe('regionMap', () => {
  describe('dimValueToKdkab', () => {
    test('maps plain kab/kota names to kdkab', () => {
      expect(dimValueToKdkab('Halmahera Barat')).toBe('01');
      expect(dimValueToKdkab('Halmahera Tengah')).toBe('02');
      expect(dimValueToKdkab('Halmahera Utara')).toBe('03');
      expect(dimValueToKdkab('Halmahera Selatan')).toBe('04');
      expect(dimValueToKdkab('Kepulauan Sula')).toBe('05');
      expect(dimValueToKdkab('Halmahera Timur')).toBe('06');
      expect(dimValueToKdkab('Pulau Morotai')).toBe('07');
      expect(dimValueToKdkab('Pulau Taliabu')).toBe('08');
      expect(dimValueToKdkab('Ternate')).toBe('71');
      expect(dimValueToKdkab('Tidore Kepulauan')).toBe('72');
    });

    test('strips "Kabupaten "/"Kota " prefix', () => {
      expect(dimValueToKdkab('Kabupaten Halmahera Barat')).toBe('01');
      expect(dimValueToKdkab('Kota Ternate')).toBe('71');
      expect(dimValueToKdkab('Kota Tidore Kepulauan')).toBe('72');
    });

    test('case-insensitive', () => {
      expect(dimValueToKdkab('halmahera barat')).toBe('01');
      expect(dimValueToKdkab('TERNATE')).toBe('71');
    });

    test('returns null for province total', () => {
      expect(dimValueToKdkab('Maluku Utara')).toBeNull();
    });

    test('returns null for unknown / falsy', () => {
      expect(dimValueToKdkab('')).toBeNull();
      expect(dimValueToKdkab(null)).toBeNull();
      expect(dimValueToKdkab(undefined)).toBeNull();
      expect(dimValueToKdkab('Kalimantan Barat')).toBeNull();
      expect(dimValueToKdkab('garbage')).toBeNull();
    });
  });

  describe('KDKAB_TO_NAMA', () => {
    test('contains all 10 entries', () => {
      expect(Object.keys(KDKAB_TO_NAMA)).toHaveLength(10);
      expect(KDKAB_TO_NAMA['01']).toBe('Halmahera Barat');
      expect(KDKAB_TO_NAMA['71']).toBe('Ternate');
    });
  });
});
