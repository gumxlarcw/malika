'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeJsonReport, timestampString } = require('../lib/reportWriter');

describe('reportWriter', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes JSON to dated filename and returns path', () => {
    const report = { meta: { duration_ms: 123 }, profiles: { chat: { cases: [] } } };
    const p = writeJsonReport({ dir: tmpDir, report, now: new Date('2026-04-18T10:30:22Z') });
    expect(p).toBe(path.join(tmpDir, 'eval-2026-04-18-10-30.json'));
    expect(fs.existsSync(p)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(parsed.meta.duration_ms).toBe(123);
  });

  test('creates directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'nested', 'reports');
    writeJsonReport({ dir: nested, report: {}, now: new Date('2026-04-18T10:30:22Z') });
    expect(fs.existsSync(nested)).toBe(true);
  });

  test('timestampString formats a Date correctly', () => {
    expect(timestampString(new Date('2026-04-18T10:30:22Z'))).toBe('2026-04-18-10-30');
  });
});

describe('writeMarkdownReport', () => {
  const { writeMarkdownReport } = require('../lib/reportWriter');
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-md-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('emits a table for each profile', () => {
    const report = {
      meta: { duration_ms: 60000, started_at: '2026-04-18T10:30:22Z', host: { base: 'x', bff: 'y' }, flags: { profile: 'all' } },
      profiles: {
        search: { summary: { cases_total: 2, stages: { dropdown: { cases: 2, pass_rate: 1, p95_latency_ms: 50 } }, comparison_llm_vs_det: { retire_llm_safe: true, retire_llm_reason: 'ok', llm_wins: 0, det_wins: 0, both_pass: 2, both_fail: 0 } } },
        chat:   { summary: { cases_total: 3, cases_passed: 3, overall_score: 0.95, by_category: { greeting: { total: 1, passed: 1, score: 1 } }, mean_latency_ms: 1200 } },
      },
    };
    const p = writeMarkdownReport({ dir: tmpDir, report, now: new Date('2026-04-18T10:30:22Z') });
    expect(p).toBe(path.join(tmpDir, 'eval-2026-04-18-10-30.md'));
    const md = fs.readFileSync(p, 'utf8');
    expect(md).toContain('## Search profile');
    expect(md).toContain('## Chat profile');
    expect(md).toContain('dropdown');
    expect(md).toContain('greeting');
  });
});

describe('findPreviousJsonReport', () => {
  const { findPreviousJsonReport } = require('../lib/reportWriter');
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-prev-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('returns the most recent report excluding the current filename', () => {
    fs.writeFileSync(path.join(tmpDir, 'eval-2026-04-17-10-00.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'eval-2026-04-18-09-00.json'), '{}');
    const prev = findPreviousJsonReport(tmpDir, 'eval-2026-04-18-10-30.json');
    expect(prev).toBe(path.join(tmpDir, 'eval-2026-04-18-09-00.json'));
  });

  test('returns null if no prior reports exist', () => {
    const prev = findPreviousJsonReport(tmpDir, 'eval-2026-04-18-10-30.json');
    expect(prev).toBeNull();
  });
});

describe('computeRegressionDiff', () => {
  const { computeRegressionDiff } = require('../lib/reportWriter');

  test('returns null when no previous report', () => {
    expect(computeRegressionDiff({ profiles: {} }, null)).toBeNull();
  });

  test('computes per-stage deltas', () => {
    const current = { profiles: { search: { summary: { stages: { dropdown: { pass_rate: 0.9 } } } } } };
    const previous = { profiles: { search: { summary: { stages: { dropdown: { pass_rate: 0.8 } } } } } };
    const d = computeRegressionDiff(current, previous);
    expect(d.search.stages.dropdown.delta).toBeCloseTo(0.1);
  });
});
