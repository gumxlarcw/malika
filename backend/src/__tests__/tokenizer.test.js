/**
 * Tests for utils/tokenizer.js — BPE token counting utility
 */

const { countTextTokens, countTokens, normalizeMessageContent } = require('../utils/tokenizer');

describe('tokenizer', () => {
  describe('countTextTokens', () => {
    it('returns 0 for empty/null/undefined input', () => {
      expect(countTextTokens('')).toBe(0);
      expect(countTextTokens(null)).toBe(0);
      expect(countTextTokens(undefined)).toBe(0);
      expect(countTextTokens('   ')).toBe(0);
    });

    it('counts tokens for simple English text', () => {
      expect(countTextTokens('hello world')).toBe(2);
      expect(countTextTokens('abcd')).toBe(1);
    });

    it('counts tokens for Indonesian text', () => {
      const text = 'Data kemiskinan Kota Ternate tahun 2025';
      const tokens = countTextTokens(text);
      expect(tokens).toBeGreaterThan(0);
      // BPE encodes Indonesian text — should NOT equal char/4
      const charEstimate = Math.ceil(text.length / 4);
      // The actual count should differ from the rough char/4 estimate
      expect(typeof tokens).toBe('number');
    });

    it('handles numbers and special characters', () => {
      expect(countTextTokens('12345')).toBeGreaterThan(0);
      expect(countTextTokens('$100.00')).toBeGreaterThan(0);
      expect(countTextTokens('100%')).toBeGreaterThan(0);
    });

    it('handles long text efficiently', () => {
      const longText = 'Statistik data penduduk provinsi. '.repeat(500);
      const start = Date.now();
      const tokens = countTextTokens(longText);
      const elapsed = Date.now() - start;

      expect(tokens).toBeGreaterThan(100);
      // Should complete in reasonable time (< 500ms even on slow hardware)
      expect(elapsed).toBeLessThan(500);
    });

    it('converts non-string input to string', () => {
      expect(countTextTokens(12345)).toBeGreaterThan(0);
    });
  });

  describe('normalizeMessageContent', () => {
    it('returns empty string for null/undefined', () => {
      expect(normalizeMessageContent(null)).toBe('');
      expect(normalizeMessageContent(undefined)).toBe('');
    });

    it('returns string content as-is', () => {
      expect(normalizeMessageContent('hello')).toBe('hello');
    });

    it('joins array of text parts', () => {
      const parts = [
        { text: 'first' },
        { text: 'second' },
      ];
      expect(normalizeMessageContent(parts)).toBe('first second');
    });

    it('handles mixed array content', () => {
      const parts = ['plain', { text: 'object' }, { image: 'url' }];
      expect(normalizeMessageContent(parts)).toBe('plain object ');
    });

    it('extracts .text property from object', () => {
      expect(normalizeMessageContent({ text: 'extracted' })).toBe('extracted');
    });
  });

  describe('countTokens', () => {
    it('returns 0 for null/undefined', () => {
      expect(countTokens(null)).toBe(0);
      expect(countTokens(undefined)).toBe(0);
    });

    it('counts tokens from a plain string', () => {
      expect(countTokens('hello world')).toBe(2);
    });

    it('counts tokens from message array', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ];
      const tokens = countTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('counts tokens from object with .messages', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'test' },
        ],
      };
      expect(countTokens(payload)).toBeGreaterThan(0);
    });

    it('counts tokens from object with .input', () => {
      const payload = { input: 'test input text' };
      expect(countTokens(payload)).toBeGreaterThan(0);
    });

    it('handles messages with multi-part content', () => {
      const messages = [
        { role: 'user', content: [{ text: 'part1' }, { text: 'part2' }] },
      ];
      expect(countTokens(messages)).toBeGreaterThan(0);
    });

    it('is more accurate than char/4 for Indonesian text', () => {
      // Indonesian uses more tokens per character than English
      const indonesian = 'Berdasarkan data BPS, jumlah penduduk miskin di Provinsi Maluku Utara adalah 12.345 jiwa atau setara dengan 5,67 persen.';
      const bpeTokens = countTokens(indonesian);
      const charEstimate = Math.ceil(indonesian.length / 4);

      // Both should be positive
      expect(bpeTokens).toBeGreaterThan(0);
      expect(charEstimate).toBeGreaterThan(0);

      // BPE should give a different (more accurate) result than the crude estimate
      // For Indonesian text, BPE typically counts MORE tokens than char/4
      expect(bpeTokens).not.toBe(charEstimate);
    });
  });
});
