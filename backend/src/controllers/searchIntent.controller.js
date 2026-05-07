const { resolveSearchIntent, buildDatasourceCandidates } = require('../services/search/intent.service');
const { intentCache } = require('../services/search/intentCache.service');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { intentStats } = require('../services/search/intentStats.service');

function shouldLogIntent() {
  const raw = String(process.env.SEARCH_INTENT_LOG || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function getLogSampleRate() {
  const raw = String(process.env.SEARCH_INTENT_LOG_SAMPLE_RATE || '').trim();
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function shouldSample(rate) {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

function hashQuery(q) {
  const s = String(q || '');
  if (!s) return '';
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
}

async function getSearchIntent(req, res) {
  const q = String(req.query.q || '').trim();
  const includeCandidates = String(req.query.includeCandidates || '') === '1';
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
  const noLlm = String(req.query.noLlm || '').trim() === '1';
  try {
    // Skip cache entirely when noLlm=true — the flag exists specifically to get
    // deterministic results, never a stale LLM-derived cache entry.
    if (!noLlm) {
      const cached = intentCache.get({ q, includeCandidates, limit });
      if (cached.hit) {
        try {
          const plan = cached?.value?.plan;
          intentStats.record({ action: plan?.action || '', reason: plan?.reason || '' });
        } catch {
          // ignore
        }
        if (shouldLogIntent()) {
          const sampleRate = getLogSampleRate();
          if (shouldSample(sampleRate)) {
            logger.info(
              {
                event: 'search_intent_cache_hit',
                q_hash: hashQuery(q),
                q_len: String(q || '').length,
                includeCandidates,
                limit,
                sample_rate: sampleRate,
              },
              'search intent cache hit'
            );
          }
        }
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached.value);
      }
    }

    const result = await resolveSearchIntent({ q, noLlm });
    if (!includeCandidates || !result?.ok) return res.json(result);

    const candidates = await buildDatasourceCandidates({ q, qb: result.query_builder, limit });
    const payload = {
      ...result,
      candidates: { items: candidates },
    };

    // Only populate the cache when the result came from the LLM path — deterministic
    // results are cheap to recompute and shouldn't displace LLM entries from the cache.
    if (!noLlm) intentCache.set({ q, includeCandidates, limit }, payload);
    res.setHeader('X-Cache', noLlm ? 'BYPASS' : 'MISS');
    return res.json(payload);
  } catch (err) {
    const message = (err && err.message ? String(err.message) : 'Unknown error').trim();
    return res.status(500).json({
      ok: false,
      code: 'SEARCH_INTENT_FAILED',
      message,
    });
  }
}

module.exports = {
  getSearchIntent,
};
