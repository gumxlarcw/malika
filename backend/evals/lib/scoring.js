'use strict';

function heuristicScore(response, expect) {
  const scores = {};
  const content = response.content;
  const contentLower = content.toLowerCase();

  if (expect.shouldContain) {
    const found = [];
    const missing = [];
    for (const s of expect.shouldContain) {
      const alternatives = s.split('|');
      const match = alternatives.find((a) => contentLower.includes(a.toLowerCase()));
      if (match) found.push(match);
      else missing.push(s);
    }
    scores.shouldContain = {
      score: found.length / expect.shouldContain.length,
      found,
      missing,
    };
  }

  if (expect.shouldNotContain) {
    const violations = expect.shouldNotContain.filter((s) => contentLower.includes(s.toLowerCase()));
    scores.shouldNotContain = { score: violations.length === 0 ? 1 : 0, violations };
  }

  if (expect.mustCiteNumber) {
    const numbers = (content.match(/\d[\d.,]+\d|\d+/g) || []).filter((n) => n.replace(/[.,]/g, '').length >= 2);
    scores.mustCiteNumber = { score: numbers.length >= 1 ? 1 : 0, numbersFound: numbers.length };
  }

  if (expect.mustCiteSource) {
    const sourcePatterns = /sumber|brs|publikasi|sensus|sakernas|susenas|survei|ihk|indeks harga|berasal dari/i;
    scores.mustCiteSource = { score: sourcePatterns.test(content) ? 1 : 0 };
  }

  if (expect.minLength) {
    scores.minLength = { score: content.length >= expect.minLength ? 1 : 0, actual: content.length, required: expect.minLength };
  }

  if (expect.maxLatencyMs) {
    scores.latency = { score: response.latencyMs <= expect.maxLatencyMs ? 1 : 0, actual: response.latencyMs, limit: expect.maxLatencyMs };
  }

  scores.noAskBack = {
    score: /apakah anda|bisa diperjelas|maksud anda/i.test(content) ? 0 : 1,
    description: 'Should not ask clarifying questions when data is available',
  };

  const weights = {
    shouldContain: 0.25,
    shouldNotContain: 0.20,
    mustCiteNumber: 0.20,
    mustCiteSource: 0.10,
    minLength: 0.10,
    latency: 0.10,
    noAskBack: 0.05,
  };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (scores[key]) {
      weightedSum += scores[key].score * weight;
      totalWeight += weight;
    }
  }

  const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const grade = composite >= 0.9 ? 'A' : composite >= 0.8 ? 'B' : composite >= 0.7 ? 'C' : composite >= 0.5 ? 'D' : 'F';

  return { composite: Math.round(composite * 100) / 100, grade, details: scores };
}

function scoreStructural(result, expected) {
  const diffs = [];
  let total = 0;
  let matched = 0;

  for (const key of Object.keys(expected)) {
    total++;
    const expectedValue = expected[key];
    const actualValue = result == null || result[key] === undefined ? null : result[key];
    if (deepEqual(actualValue, expectedValue)) {
      matched++;
    } else {
      diffs.push(`${key}: expected ${formatValue(expectedValue)}, got ${formatValue(actualValue)}`);
    }
  }

  return {
    passed: diffs.length === 0,
    diffs,
    match_rate: total === 0 ? 1 : matched / total,
    got: result,
    expected,
  };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return false;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function formatValue(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

module.exports = { heuristicScore, scoreStructural };
