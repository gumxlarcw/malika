'use strict';

jest.mock('../config/db', () => {
  const query = jest.fn();
  return { query, close: jest.fn() };
});

const sequelize = require('../config/db');
const { rankByQuery, NAME_MATCH_WEIGHT } = require('../services/search/fulltextRanker');

describe('rankByQuery', () => {
  beforeEach(() => sequelize.query.mockReset());

  test('builds SQL with name boost and term_scores join, returns candidates', async () => {
    sequelize.query.mockResolvedValueOnce([[
      { id: 19, name: 'TPT Menurut Jenis Kelamin', type: 'dynamic', base_relevance: 5.2, click_count: 100 },
      { id: 201, name: 'TPT Kabupaten/Kota',       type: 'dynamic', base_relevance: 4.1, click_count: 30 },
    ]]);

    const result = await rankByQuery({ q: 'tpt malut 2024', limit: 10 });

    expect(sequelize.query).toHaveBeenCalledTimes(1);
    const [sql, opts] = sequelize.query.mock.calls[0];
    expect(sql).toMatch(/MATCH\(ds\.name\) AGAINST\(:q/);
    expect(sql).toMatch(/MATCH\(ds\.description\) AGAINST\(:q/);
    expect(sql).toMatch(/LEFT JOIN data_search_stats ss/);
    expect(sql).toMatch(/ORDER BY base_relevance DESC/);
    expect(opts.replacements.q).toBe('tpt malut 2024');
    expect(opts.replacements.limit).toBe(10);
    expect(opts.replacements.name_boost).toBe(NAME_MATCH_WEIGHT);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(19);
    expect(result[0].base_relevance).toBe(5.2);
  });

  test('respects ignored_source_ids', async () => {
    sequelize.query.mockResolvedValueOnce([[]]);
    await rankByQuery({ q: 'x', limit: 5, ignoredIds: [166, 167] });
    const opts = sequelize.query.mock.calls[0][1];
    expect(opts.replacements.ignored_source_ids).toEqual([166, 167]);
  });

  test('returns empty array on empty query', async () => {
    const result = await rankByQuery({ q: '', limit: 10 });
    expect(result).toEqual([]);
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  test('NAME_MATCH_WEIGHT is a structural constant', () => {
    expect(NAME_MATCH_WEIGHT).toBe(2.0);
  });
});

describe('applyClickPrior', () => {
  const { applyClickPrior, MAX_CLICK_WEIGHT } = require('../services/search/fulltextRanker');

  test('returns candidates unchanged when all have zero clicks', () => {
    const input = [
      { id: 1, base_relevance: 5, click_count: 0 },
      { id: 2, base_relevance: 3, click_count: 0 },
    ];
    const out = applyClickPrior(input);
    expect(out).toEqual(input);
  });

  test('scales effective_score by up to MAX_CLICK_WEIGHT for most-clicked candidate', () => {
    const input = [
      { id: 1, base_relevance: 5, click_count: 100 },  // top clicks
      { id: 2, base_relevance: 4, click_count: 1 },    // minimal clicks
    ];
    const out = applyClickPrior(input);
    // Most-clicked gets full boost (click_prior = 1.0)
    expect(out[0].click_prior).toBe(1);
    expect(out[0].effective_score).toBeCloseTo(5 * (1 + MAX_CLICK_WEIGHT), 5);
    // Low-clicked gets a small boost (log(2) / log(101) ≈ 0.15)
    expect(out[1].click_prior).toBeGreaterThan(0);
    expect(out[1].click_prior).toBeLessThan(0.3);
  });

  test('empty input returns empty array', () => {
    expect(applyClickPrior([])).toEqual([]);
  });

  test('MAX_CLICK_WEIGHT is a structural constant', () => {
    expect(MAX_CLICK_WEIGHT).toBe(0.5);
  });
});

describe('deriveConfidence', () => {
  const { deriveConfidence } = require('../services/search/fulltextRanker');

  test('0 candidates → 0 confidence', () => {
    expect(deriveConfidence([])).toBe(0);
  });

  test('1 candidate → full confidence', () => {
    expect(deriveConfidence([{ effective_score: 5 }])).toBe(1);
  });

  test('tied top two → near-zero confidence', () => {
    const r = deriveConfidence([
      { effective_score: 5 },
      { effective_score: 5 },
    ]);
    expect(r).toBeCloseTo(0);
  });

  test('top dominates second → high confidence', () => {
    const r = deriveConfidence([
      { effective_score: 10 },
      { effective_score: 2 },
    ]);
    expect(r).toBeCloseTo(0.8, 1);  // (10-2)/10 = 0.8
  });
});
