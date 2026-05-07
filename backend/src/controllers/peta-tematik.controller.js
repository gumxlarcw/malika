/**
 * Peta Tematik Controller
 * Choropleth map for /dashboard section. See spec:
 *   docs/superpowers/specs/2026-05-06-peta-tematik-design.md
 */

'use strict';

const svc = require('../services/petaTematik/petaTematik.service');
const metaLookup = require('../services/petaTematik/metadataLookup.service');

function parseInt32(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 99999 ? n : null;
}

async function withGuard(req, res, fn) {
  try {
    const result = await fn();
    res.json({ ok: true, ...result });
  } catch (e) {
    const code = /Invalid/.test(e.message) ? 400 : 500;
    res.status(code).json({ ok: false, error: e.message || 'Server error' });
  }
}

module.exports = {
  async getIndikatorList(req, res) {
    return withGuard(req, res, async () => {
      const list = await svc.getIndikatorList();
      return list;
    });
  },

  async getYears(req, res) {
    return withGuard(req, res, async () => {
      const id = parseInt32(req.query.indikator);
      if (!id) throw new Error('Invalid indikator id');
      if (!svc.isValidIndikator(id)) throw new Error('Invalid indikator (not in eligible list)');
      return svc.getYears(id);
    });
  },

  async getMetrics(req, res) {
    return withGuard(req, res, async () => {
      const id = parseInt32(req.query.indikator);
      if (!id) throw new Error('Invalid indikator id');
      if (!svc.isValidIndikator(id)) throw new Error('Invalid indikator (not in eligible list)');
      return svc.getMetrics(id);
    });
  },

  async getData(req, res) {
    return withGuard(req, res, async () => {
      const id = parseInt32(req.query.indikator);
      const year = parseInt32(req.query.year);
      if (!id || !year) throw new Error('Invalid indikator or year');
      if (!svc.isValidIndikator(id)) throw new Error('Invalid indikator (not in eligible list)');
      const month = req.query.month ? parseInt32(req.query.month) : null;
      const metric = typeof req.query.metric === 'string' && req.query.metric ? req.query.metric : null;

      // Fetch rows + metadata in parallel — different DBs, no shared lock.
      const [rows, meta] = await Promise.all([
        svc.getData({ indikator: id, year, month, metric }),
        metaLookup.resolveMeta(id, metric),
      ]);

      return { data: rows, meta };
    });
  },

  async getIndikatorMeta(req, res) {
    return withGuard(req, res, async () => {
      const id = parseInt32(req.params.id);
      if (!id) throw new Error('Invalid indikator id');
      const full = await metaLookup.getFullMeta(id);
      if (!full) throw new Error('Indikator metadata not found');
      return { meta: full };
    });
  },

  async getSummary(req, res) {
    return withGuard(req, res, async () => {
      const id = parseInt32(req.query.indikator);
      const year = parseInt32(req.query.year);
      if (!id || !year) throw new Error('Invalid indikator or year');
      if (!svc.isValidIndikator(id)) throw new Error('Invalid indikator (not in eligible list)');
      const month = req.query.month ? parseInt32(req.query.month) : null;
      const metric = typeof req.query.metric === 'string' && req.query.metric ? req.query.metric : null;
      return svc.getSummary({ indikator: id, year, month, metric });
    });
  },

  async searchIndikator(req, res) {
    return withGuard(req, res, async () => {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!q) throw new Error('Invalid query (q required)');
      const limit = req.query.limit ? parseInt32(req.query.limit) : 10;
      const type = typeof req.query.type === 'string' && req.query.type
        ? req.query.type
        : null;
      const minScore = req.query.min_score
        ? Math.max(0, Math.min(1, Number(req.query.min_score)))
        : 0;
      const results = await metaLookup.semanticSearchIndikator({
        query: q, limit: limit ?? 10, type, minScore,
      });
      return { query: q, count: results.length, results };
    });
  },
};
