// Neutralize the LLM proxy load-guard pulled in transitively by chat.service.
jest.mock('../../services/chat/streaming/openaiClient', () => ({ chat: jest.fn() }));

// In-memory ownership table: thread 100 → user-A, thread 200 → user-B.
jest.mock('../../models/ChatThread.model', () => {
  const OWNERS = { 100: 'user-A', 200: 'user-B' };
  return {
    findOne: jest.fn(async ({ where }) => {
      const owner = OWNERS[where.id];
      if (owner && owner === where.owner_id) {
        return { id: where.id, owner_id: owner, toJSON: () => ({ id: where.id, owner_id: owner }) };
      }
      return null;
    }),
  };
});

const express = require('express');
const request = require('supertest');
const { malikaIdentityMiddleware } = require('../../middleware/malikaIdentity.middleware');
const chatService = require('../../services/chat/chat.service');
const { issueToken } = require('../../services/chat/anonIdentity.service');

function makeApp() {
  const app = express();
  app.use(express.json());
  // Mirror the real read + write ownership gates (both route through getThreadOwned).
  app.get('/chat/threads/:id/messages', malikaIdentityMiddleware, async (req, res, next) => {
    try {
      const ownerId = chatService.getOwnerIdFromReq(req);
      const thread = await chatService.getThreadOwned(ownerId, Number(req.params.id));
      res.json({ ok: true, thread: thread.toJSON() });
    } catch (e) { next(e); }
  });
  app.post('/chat/threads/:id/stream', malikaIdentityMiddleware, async (req, res, next) => {
    try {
      const ownerId = chatService.getOwnerIdFromReq(req);
      await chatService.getThreadOwned(ownerId, Number(req.params.id));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ ok: false, error: err.code || 'err' }));
  return app;
}

describe('IDOR regression: thread ownership scoping', () => {
  afterEach(() => { delete process.env.MALIKA_IDENTITY_STRICT; });

  it("A's token cannot READ B's thread → 404", async () => {
    const res = await request(makeApp()).get('/chat/threads/200/messages').set('x-malika-token', issueToken('user-A'));
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('thread_not_found');
  });

  it("A's token cannot WRITE to B's thread → 404", async () => {
    const res = await request(makeApp()).post('/chat/threads/200/stream').set('x-malika-token', issueToken('user-A')).send({ text: 'hi' });
    expect(res.statusCode).toBe(404);
  });

  it("A's token CAN read A's own thread → 200", async () => {
    const res = await request(makeApp()).get('/chat/threads/100/messages').set('x-malika-token', issueToken('user-A'));
    expect(res.statusCode).toBe(200);
    expect(res.body.thread).toEqual({ id: 100, owner_id: 'user-A' });
  });

  it('forged bare uid, no token, STRICT=on → 401 (never reaches the query)', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'true';
    const res = await request(makeApp()).get('/chat/threads/200/messages').set('x-malika-uid', 'user-B');
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('identity_required');
  });
});
