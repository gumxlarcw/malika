const request = require('supertest');

jest.mock('../../controllers/search.controller', () => ({
  searchDatasource: (req, res) => res.json({ items: [{ id: 1, name: 'Kemiskinan' }] }),
  favorites: (req, res) => res.json({ items: [] }),
  trackDatasource: (req, res) => res.json({ ok: true }),
  searchKnowledge: (req, res) => res.json({ items: [] }),
  getKnowledgeById: (req, res) => res.json({ id: Number(req.params.id), title: 'Doc' }),
}));

jest.mock('../../controllers/searchIntent.controller', () => ({
  getSearchIntent: (req, res) => res.json({ ok: true, intent: 'search' }),
}));

jest.mock('../../middleware/validate.middleware', () => ({
  validateBody: () => (req, res, next) => next(),
  validateParams: () => (req, res, next) => next(),
  validateQuery: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimit.middleware', () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

const app = require('../../../app');

describe('integration: search routes', () => {
  it('GET /search/datasource returns items', async () => {
    const res = await request(app).get('/search/datasource?q=kemiskinan');

    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('GET /search/intent returns intent', async () => {
    const res = await request(app).get('/search/intent?q=kemiskinan');

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('intent', 'search');
  });
});
