const request = require('supertest');

jest.mock('../../controllers/chat.controller', () => ({
  createIdentity: (req, res) => res.json({ ok: true, uid: 'u', token: 't', exp: 0 }),
  listThreads: (req, res) => res.json({ items: [{ id: 1, title: 'Test' }] }),
  createThread: (req, res) => res.status(201).json({ id: 10, title: req.body.title || 'New' }),
  listMessages: (req, res) => res.json({ items: [{ id: 1, content: 'Hello' }] }),
  deleteThread: (req, res) => res.json({ success: true }),
  sendMessage: (req, res) => res.json({ ok: true, message: req.body.text }),
  streamMessage: (req, res) => res.status(200).end(),
  searchMemory: (req, res) => res.json({ results: [] }),
  getMemoryStats: (req, res) => res.json({ totalFacts: 0 }),
  getUserMemories: (req, res) => res.json({ facts: [] }),
  deleteMemory: (req, res) => res.json({ success: true }),
  clearMemories: (req, res) => res.json({ success: true }),
  compactThread: (req, res) => res.json({ success: true }),
  getSuggestions: (req, res) => res.json({ suggestions: [] }),
  getThreadSuggestions: (req, res) => res.json({ suggestions: [] }),
  getQualityStats: (req, res) => res.json({ stats: {} }),
  getThreadQuality: (req, res) => res.json({ quality: {} }),
  getQueueStatus: (req, res) => res.json({ ok: true, active: 0, waiting: 0, maxConcurrent: 2, maxQueue: 8 }),
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

describe('integration: chat routes', () => {
  it('GET /chat/threads returns list', async () => {
    const res = await request(app).get('/chat/threads');

    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('POST /chat/threads creates thread', async () => {
    const res = await request(app)
      .post('/chat/threads')
      .send({ title: 'Diskusi' });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('POST /chat/threads/:id/messages sends message', async () => {
    const res = await request(app)
      .post('/chat/threads/1/messages')
      .send({ text: 'halo' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });
});
