const express = require('express');
const request = require('supertest');
const { malikaIdentityMiddleware } = require('../malikaIdentity.middleware');
const { issueToken } = require('../../services/chat/anonIdentity.service');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.get('/probe', malikaIdentityMiddleware, (req, res) => {
    res.json({ uid: req.malikaUid || null, legacy: !!req.malikaLegacy });
  });
  return app;
}

describe('malikaIdentityMiddleware', () => {
  afterEach(() => { delete process.env.MALIKA_IDENTITY_STRICT; });

  it('valid token → req.malikaUid = sub, not legacy', async () => {
    const app = makeApp();
    const res = await request(app).get('/probe').set('x-malika-token', issueToken('user-A'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ uid: 'user-A', legacy: false });
  });

  it('STRICT=on + no token → 401 identity_required (bare uid ignored)', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'true';
    const app = makeApp();
    const res = await request(app).get('/probe').set('x-malika-uid', 'forged-B');
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'identity_required' });
  });

  it('STRICT=off + no token + bare uid → fallback, legacy=true', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'false';
    const app = makeApp();
    const res = await request(app).get('/probe').set('x-malika-uid', 'legacy-1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ uid: 'legacy-1', legacy: true });
  });

  it('STRICT=on + valid token wins over a different bare uid', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'true';
    const app = makeApp();
    const res = await request(app).get('/probe')
      .set('x-malika-token', issueToken('user-A'))
      .set('x-malika-uid', 'forged-B');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ uid: 'user-A', legacy: false });
  });

  it('STRICT=on + invalid token → 401', async () => {
    process.env.MALIKA_IDENTITY_STRICT = 'true';
    const app = makeApp();
    const res = await request(app).get('/probe').set('x-malika-token', 'not-a-jwt');
    expect(res.statusCode).toBe(401);
  });
});
