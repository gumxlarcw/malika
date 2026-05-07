const { searchDatasources } = require('../services/search/datasourceSearch.service');
const { getFavoriteDatasources, trackDatasourceClick } = require('../services/search/searchFavorites.service');

// Lazy-load vector search (may not be configured)
let vectorSearchService = null;
try {
  vectorSearchService = require('../services/ai/vectorSearch.service');
} catch (e) {
  console.warn('[Search] Vector search service not available:', e.message);
}

// Public search endpoint for datasources (read-only, limited fields)
async function searchDatasource(req, res, next) {
  try {
    const qRaw = String(req.query.q || "").trim();
    const q = qRaw.slice(0, 80);
    const limit = Math.min(20, Math.max(1, Number.parseInt(String(req.query.limit || "10"), 10) || 10));

    if (!q || q.length < 2) {
      return res.json({ items: [] });
    }

    const ranked = await searchDatasources({ q, limit });

    // Geo fallback: if a geo-specific query yields no results, retry with geo tokens removed.
    if (ranked.length === 0) {
      const stripGeoPhrases = (input) => {
        const norm = String(input || '').toLowerCase();
        const known = [
          'pulau morotai',
          'kepulauan sula',
          'pulau taliabu',
          'tidore kepulauan',
          'halmahera barat',
          'halmahera selatan',
          'halmahera tengah',
          'halmahera timur',
          'halmahera utara',
          'maluku utara',
          'ternate',
          'tidore',
          'morotai',
          'taliabu',
          'sula',
        ];
        let out = norm;
        for (const p of known) {
          out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
        }
        return out.replace(/\s+/g, ' ').trim();
      };

      const stripped = stripGeoPhrases(q);
      if (stripped.length >= 2 && stripped !== q.toLowerCase()) {
        const retry = await searchDatasources({ q: stripped, limit });
        if (retry.length > 0) {
          return res.json({ items: retry });
        }
      }
    }

    return res.json({
      items: ranked,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  searchDatasource,
  // Public: top favorites for dropdown when query is empty
  async favorites(req, res, next) {
    try {
      const limit = Math.min(10, Math.max(1, Number.parseInt(String(req.query.limit || '5'), 10) || 5));
      const items = await getFavoriteDatasources({ limit });
      return res.json({ items });
    } catch (err) {
      return next(err);
    }
  },

  // Public: track a datasource click from dropdown suggestions
  async trackDatasource(req, res, next) {
    try {
      const sourceId = req.body?.source_id;
      const r = await trackDatasourceClick({ sourceId });
      return res.json(r);
    } catch (err) {
      return next(err);
    }
  },

  // Public: search knowledge base documents
  async searchKnowledge(req, res, next) {
    try {
      const q = String(req.query.q || '').trim();
      const limit = Math.min(10, Math.max(1, parseInt(req.query.limit || '5', 10) || 5));
      
      if (!q || q.length < 2) {
        return res.json({ items: [] });
      }
      
      if (!vectorSearchService?.searchKnowledge) {
        return res.json({ items: [], message: 'Knowledge search not available' });
      }
      
      const result = await vectorSearchService.searchKnowledge(q, limit);
      
      // Filter by minimum similarity threshold
      const items = (result.results || [])
        .filter(r => r.similarity >= 0.40)
        .map(r => ({
          id: r.id,
          title: r.name,
          content: r.content?.slice(0, 300),
          category: r.category,
          similarity: r.similarity,
        }));
      
      return res.json({ items });
    } catch (err) {
      console.error('[Search] searchKnowledge error:', err);
      return next(err);
    }
  },
};
