const request = require('supertest');

jest.mock('../../controllers/datasource.controller', () => ({
  getAll: (req, res) => res.json({ items: [{ id: 1, name: 'Kemiskinan' }] }),
  getAdminList: (req, res) => res.json({ items: [] }),
  create: (req, res) => res.status(201).json({ id: 10, name: req.body.name }),
  update: (req, res) => res.json({ id: Number(req.params.id), name: req.body.name }),
  remove: (req, res) => res.json({ ok: true }),
  hardRemove: (req, res) => res.json({ ok: true }),
  reindexSearchTermsForAll: (req, res) => res.json({ ok: true }),
  reindexSearchTermsForSource: (req, res) => res.json({ ok: true }),
  reindexSearchMetadataForAllFromCache: (req, res) => res.json({ ok: true }),
  reindexSearchMetadataForSourceFromCache: (req, res) => res.json({ ok: true }),
  seedExim: (req, res) => res.json({ ok: true }),
  seedEximJobStart: (req, res) => res.json({ ok: true }),
  seedEximJobActive: (req, res) => res.json({ ok: true }),
  seedEximJobStatus: (req, res) => res.json({ ok: true }),
  prepareFromUrl: (req, res) => res.json({ ok: true }),
}));

jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    next();
  },
  requireAdmin: (req, res, next) => next(),
}));

jest.mock('../../middleware/csrf.middleware', () => ({
  csrfMiddleware: (req, res, next) => next(),
  getCsrfToken: (req, res) => res.json({ ok: true, csrfToken: 'test' }),
}));

jest.mock('../../middleware/rateLimit.middleware', () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/auditLog.middleware', () => ({
  createAuditLogMiddleware: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/validate.middleware', () => ({
  validateBody: () => (req, res, next) => next(),
  validateParams: () => (req, res, next) => next(),
  validateQuery: () => (req, res, next) => next(),
}));

const app = require('../../../app');

describe('integration: datasource routes', () => {
  it('GET /datasource returns list', async () => {
    const res = await request(app).get('/datasource');

    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('POST /datasource creates datasource', async () => {
    const res = await request(app)
      .post('/datasource')
      .send({ name: 'Test', type: 'dynamic', api_url: 'https://example.com' });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});
