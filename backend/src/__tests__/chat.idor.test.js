// Integration proof that chat ownership derives from the SIGNED token (or, while
// STRICT is off, the bare uid) — not a spoofable header. Service layer is mocked
// so this needs no DB. MALIKA_ANON_SECRET comes from jest.setup.env.js.

const mockCaptured = { listThreadsOwner: undefined };

jest.mock('../services/chat/chat.service', () => ({
  // Faithful reproduction of the real owner-derivation contract.
  getOwnerIdFromReq: (req) => {
    const raw = req.malikaUid || (req.get && req.get('x-malika-uid')) || '';
    const ownerId = String(raw || '').trim();
    if (!ownerId) {
      const e = new Error('missing owner');
      e.status = 400; e.code = 'missing_owner';
      throw e;
    }
    return ownerId;
  },
  listThreads: jest.fn(async (ownerId) => {
    mockCaptured.listThreadsOwner = ownerId;
    return [{ id: 1, owner_id: ownerId }];
  }),
  createThread: jest.fn(),
  listMessages: jest.fn(),
  sendMessage: jest.fn(),
  deleteThread: jest.fn(),
}));
jest.mock('../services/chat/streaming.service', () => ({ streamChatResponse: jest.fn() }));
jest.mock('../services/chat/threadSuggestions.service', () => ({ generateForThread: jest.fn() }));

const express = require('express');
const request = require('supertest');
const chatRoutes = require('../routes/chat.routes');
const chatService = require('../services/chat/chat.service');
const { issueToken, verifyToken } = require('../services/chat/anonIdentity.service');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/chat', chatRoutes);
  return app;
}

const app = makeApp();

beforeEach(() => {
  jest.clearAllMocks();
  mockCaptured.listThreadsOwner = undefined;
  delete process.env.MALIKA_IDENTITY_STRICT; // default: dual-mode (off)
});

describe('POST /chat/identity', () => {
  it('mints a fresh uid + verifiable token when given nothing', async () => {
    const res = await request(app).post('/chat/identity').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(verifyToken(res.body.token)).toMatchObject({ sub: res.body.uid, typ: 'anon' });
  });

  it('adopts a well-formed legacy uid from the body', async () => {
    const res = await request(app).post('/chat/identity').send({ uid: 'uid_legacy_123' });
    expect(res.body.uid).toBe('uid_legacy_123');
    expect(verifyToken(res.body.token).sub).toBe('uid_legacy_123');
  });

  it('renews (keeps the same sub) when a valid token is presented', async () => {
    const token = issueToken('uid_renew_me');
    const res = await request(app).post('/chat/identity').set('x-malika-token', token).send({});
    expect(res.body.uid).toBe('uid_renew_me');
  });
});

describe('owner derivation (IDOR)', () => {
  it('scopes to the token subject, ignoring a spoofed x-malika-uid header', async () => {
    const tokenA = issueToken('user-A');
    const res = await request(app)
      .get('/chat/threads')
      .set('x-malika-token', tokenA)
      .set('x-malika-uid', 'user-B'); // attacker tries to impersonate B
    expect(res.status).toBe(200);
    expect(mockCaptured.listThreadsOwner).toBe('user-A'); // token wins, not the header
  });

  it('dual-mode (STRICT off): falls back to the bare uid when no token', async () => {
    const res = await request(app).get('/chat/threads').set('x-malika-uid', 'user-legacy');
    expect(res.status).toBe(200);
    expect(mockCaptured.listThreadsOwner).toBe('user-legacy');
  });

  it('strict mode: a bare uid with no token is rejected (401), service untouched', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'on';
    const res = await request(app).get('/chat/threads').set('x-malika-uid', 'user-B');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'identity_required' });
    expect(chatService.listThreads).not.toHaveBeenCalled();
  });

  it('strict mode: a valid token is accepted and scoped to its subject', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'on';
    const res = await request(app).get('/chat/threads').set('x-malika-token', issueToken('user-A'));
    expect(res.status).toBe(200);
    expect(mockCaptured.listThreadsOwner).toBe('user-A');
  });

  it('strict mode keeps the bootstrap /identity route reachable without a token', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'on';
    const res = await request(app).post('/chat/identity').send({});
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});
