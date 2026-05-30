// Mock chat.controller so app load stays light and we isolate routing/guard wiring.
jest.mock('../../controllers/chat.controller', () => ({
  listThreads: (req, res) => res.json({ ok: true, uid: req.malikaUid || null }),
  createThread: (req, res) => res.status(201).json({ ok: true }),
  listMessages: (req, res) => res.json({ ok: true }),
  sendMessage: (req, res) => res.status(201).json({ ok: true }),
  getThreadSuggestions: (req, res) => res.json({ ok: true }),
  streamMessage: (req, res) => res.status(200).end(),
  createIdentity: (req, res) => res.json({ ok: true, uid: 'minted', token: 'tok', exp: 1 }),
}));

const request = require('supertest');
const app = require('../../../app');
const { issueToken } = require('../../services/chat/anonIdentity.service');

describe('chat identity routing + guard', () => {
  afterEach(() => { delete process.env.MALIKA_IDENTITY_STRICT; });

  it('STRICT=on: guarded data route without token → 401', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'true';
    const res = await request(app).get('/chat/threads');
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'identity_required' });
  });

  it('STRICT=on: POST /chat/identity reachable WITHOUT a token (bootstrap exempt)', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'true';
    const res = await request(app).post('/chat/identity').send({});
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('STRICT=on: valid token reaches the controller with req.malikaUid set', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'true';
    const res = await request(app).get('/chat/threads').set('x-malika-token', issueToken('user-A'));
    expect(res.statusCode).toBe(200);
    expect(res.body.uid).toBe('user-A');
  });

  it('GET /chat/threads/:id/stream is removed → 404', async () => {
    const res = await request(app).get('/chat/threads/1/stream?text=hi').set('x-malika-token', issueToken('user-A'));
    expect(res.statusCode).toBe(404);
  });
});
