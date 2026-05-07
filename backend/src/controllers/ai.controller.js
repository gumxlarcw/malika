const { buildQueryFromText } = require('../services/ai/queryBuilder.service');

exports.queryBuilder = async (req, res) => {
  try {
    const q = String(req.body?.q || '').trim();
    if (!q) {
      return res.status(400).json({ ok: false, message: 'Missing q' });
    }

    const result = await buildQueryFromText({ q });
    return res.json({ ok: true, result });
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    const code = err?.code || 'ERR_AI_QUERY_BUILDER';
    const message = String(err?.message || '').trim() || 'Internal Server Error';
    return res.status(status).json({ ok: false, code, message });
  }
};
