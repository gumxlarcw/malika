const request = require('supertest');

jest.mock('../../controllers/auth.controller', () => ({
  login: (req, res) => res.json({ ok: true, token: 'test-token' }),
  register: (req, res) => res.status(201).json({ ok: true }),
  me: (req, res) => res.json({ ok: true, user: { id: 1, name: 'Admin' } }),
  logout: (req, res) => res.json({ ok: true }),
  listUsers: (req, res) => res.json({ ok: true, users: [] }),
  deleteUser: (req, res) => res.json({ ok: true }),
}));

jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    next();
  },
  requireAdmin: (req, res, next) => next(),
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

describe('integration: auth routes', () => {
  it('POST /auth/login returns token', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'secret' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('token');
  });

  it('GET /auth/me returns user', async () => {
    const res = await request(app).get('/auth/me');

    expect(res.statusCode).toBe(200);
    expect(res.body.user).toHaveProperty('id', 1);
  });

  it('POST /auth/logout returns ok', async () => {
    const res = await request(app).post('/auth/logout');

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });
});
