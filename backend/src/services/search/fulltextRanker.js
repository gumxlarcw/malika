'use strict';

const sequelize = require('../../config/db');

// Structural constant: data_sources.name (~10 chars) carries denser information per character
// than description (~200 chars). Same query term in name = ~20x more informative, weighted down to 2.0
// to avoid saturating the score.
const NAME_MATCH_WEIGHT = 2.0;

// Structural policy bound: popularity can boost relevance by up to 50%.
// Not a per-indicator weight — applies corpus-wide to any source with non-zero clicks.
const MAX_CLICK_WEIGHT = 0.5;

// Structural guardrail list (pre-existing in datasourceSearch.service.js — kept as default).
// Callers can pass their own via ignoredIds param.
const DEFAULT_IGNORED_SOURCE_IDS = [166, 167, 168, 169];

const RANK_SQL = `
  SELECT
    ds.id, ds.name, ds.type,
    (MATCH(ds.name) AGAINST(:q IN NATURAL LANGUAGE MODE) * :name_boost
      + MATCH(ds.description) AGAINST(:q IN NATURAL LANGUAGE MODE)
      + COALESCE(term_scores.term_score, 0)
    ) AS base_relevance,
    COALESCE(ss.search_count, 0) AS click_count
  FROM data_sources ds
  LEFT JOIN data_search_stats ss ON ss.source_id = ds.id
  LEFT JOIN (
    SELECT st.source_id,
           SUM(MATCH(st.term) AGAINST(:q IN NATURAL LANGUAGE MODE)) AS term_score
    FROM data_source_search_terms st
    WHERE MATCH(st.term) AGAINST(:q IN NATURAL LANGUAGE MODE)
    GROUP BY st.source_id
  ) term_scores ON term_scores.source_id = ds.id
  WHERE ds.id NOT IN (:ignored_source_ids)
    AND (
      MATCH(ds.name) AGAINST(:q IN NATURAL LANGUAGE MODE)
      OR MATCH(ds.description) AGAINST(:q IN NATURAL LANGUAGE MODE)
      OR term_scores.term_score IS NOT NULL
    )
  ORDER BY base_relevance DESC
  LIMIT :limit
`;

async function rankByQuery({ q, limit = 25, ignoredIds = DEFAULT_IGNORED_SOURCE_IDS }) {
  const query = String(q || '').trim();
  if (!query) return [];

  const [rows] = await sequelize.query(RANK_SQL, {
    replacements: {
      q: query,
      name_boost: NAME_MATCH_WEIGHT,
      ignored_source_ids: ignoredIds.length ? ignoredIds : [-1],  // :ignored_source_ids must not be empty
      limit: Math.max(1, Math.min(100, Math.floor(limit))),
    },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    base_relevance: Number(r.base_relevance) || 0,
    click_count: Number(r.click_count) || 0,
  }));
}

function applyClickPrior(candidates) {
  if (!candidates.length) return candidates;

  // Corpus-derived denominator: max click count among this query's candidates.
  // Self-scaling — nothing hardcoded globally.
  const maxClicks = Math.max(0, ...candidates.map((c) => c.click_count || 0));
  if (maxClicks === 0) return candidates;

  const logMax = Math.log1p(maxClicks);
  return candidates.map((c) => {
    const clickPrior = logMax > 0 ? Math.log1p(c.click_count || 0) / logMax : 0;
    const effective_score = (c.base_relevance || 0) * (1 + clickPrior * MAX_CLICK_WEIGHT);
    return { ...c, effective_score, click_prior: clickPrior };
  });
}

// Confidence = (top1 - top2) / top1. Single candidate → 1. Empty → 0.
// Measures how unambiguous the top result is, purely from the score distribution.
function deriveConfidence(candidates) {
  if (!candidates.length) return 0;
  if (candidates.length === 1) return 1;
  const top1 = candidates[0].effective_score || 0;
  if (top1 <= 0) return 0;
  const gap = top1 - (candidates[1].effective_score || 0);
  return Math.min(1, Math.max(0, gap / top1));
}

module.exports = {
  rankByQuery,
  applyClickPrior,
  deriveConfidence,
  NAME_MATCH_WEIGHT,
  MAX_CLICK_WEIGHT,
  DEFAULT_IGNORED_SOURCE_IDS,
};
