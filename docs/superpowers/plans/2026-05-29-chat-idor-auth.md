# Chat IDOR Fix — Unforgeable Anonymous Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the `/chat/*` IDOR by wrapping the anonymous UUID in a server-signed (HMAC) identity token the backend verifies before trusting it, without ending anonymous public chat.

**Architecture:** A stateless HS256 JWT (`{ sub: uid, typ: "anon" }`, dedicated `MALIKA_ANON_SECRET`) is minted by a public bootstrap endpoint, carried in `x-malika-token`, and verified by a per-route middleware that sets `req.malikaUid`. A dual-mode flag (`MALIKA_IDENTITY_STRICT`) lets legacy bare-uid clients keep working during a migration window, then flips to reject unsigned requests. Ownership derivation moves from the raw header to `req.malikaUid`.

**Tech Stack:** Node 20 / Express 5 / CommonJS / `jsonwebtoken` / Sequelize (backend); Next.js 16 / React 19 / TypeScript (frontend); Jest + Supertest (backend tests).

**Source spec:** `docs/superpowers/specs/2026-05-29-chat-idor-auth-design.md`

---

## File Structure

**Backend — new**
- `backend/src/services/chat/anonIdentity.service.js` — issue/verify/renew the signed token. Pure crypto, no DB. Fail-closed at load if secret unset.
- `backend/src/middleware/malikaIdentity.middleware.js` — read `x-malika-token` → `req.malikaUid`; strict vs dual-mode.
- `backend/src/services/chat/__tests__/anonIdentity.service.test.js` — unit tests for the service.
- `backend/src/middleware/__tests__/malikaIdentity.middleware.test.js` — middleware behavior.
- `backend/src/controllers/__tests__/chatIdentity.controller.test.js` — `createIdentity` mint/adopt/renew.
- `backend/src/__tests__/integration/chat.idor.test.js` — IDOR regression (ownership scoping).
- `backend/src/__tests__/integration/chat.identity.routing.test.js` — guard mounting + bootstrap exemption + removed GET stream.

**Backend — modified**
- `backend/jest.setup.env.js` — provide a test default for `MALIKA_ANON_SECRET`.
- `backend/src/controllers/chat.controller.js` — add `createIdentity`; drop `req.query.text` from `streamMessage`.
- `backend/src/services/chat/chat.service.js` — `getOwnerIdFromReq` reads `req.malikaUid`.
- `backend/src/routes/chat.routes.js` — add `POST /identity` (un-guarded); guard data routes; delete `GET /threads/:id/stream`.
- `backend/src/routes/chatFeedback.routes.js` — guard all routes.
- `backend/src/controllers/chatFeedback.controller.js` — 4 header reads → `req.malikaUid`.
- `backend/src/routes/errorLearning.routes.js` — guard `POST /flag` only (leave admin routes).
- `backend/src/controllers/errorLearning.controller.js` — 1 header read → `req.malikaUid`.
- `backend/.env` — add `MALIKA_ANON_SECRET`, `MALIKA_IDENTITY_STRICT` (ops step; gitignored, **not committed**).

**Frontend — new**
- `frontend/src/app/api/chat/identity/route.ts` — Next proxy → backend `POST /chat/identity`.

**Frontend — modified**
- `frontend/src/app/(admin)/chat/chatHelpers.tsx` — `getMalikaTokenSync()`, `ensureMalikaToken()`.
- `frontend/src/lib/chatTransport.ts` — send `x-malika-token` on the stream fetch.
- `frontend/src/app/(admin)/chat/ChatPageClient.tsx` — token state + mount effect + header.
- `frontend/src/app/api/chat/threads/route.ts`, `.../threads/[id]/messages/route.ts`, `.../threads/[id]/suggestions/route.ts` — forward `x-malika-token`.
- `frontend/src/app/api/chat/threads/[id]/stream/route.ts` — forward `x-malika-token` on POST; **delete the GET handler**.

**Project conventions (apply to every task):** Backend is CommonJS — no ESM `import`. 2-space indent. Before editing any existing file, `cp {file} {file}.backup`. Commits: `type(scope): desc`, **no `Co-Authored-By` trailer**, stage explicit paths (never `git add -A`). Run backend tests from inside `backend/`.

---

## Task 1: Test bootstrap — make the fail-closed secret available to Jest

`anonIdentity.service.js` (Task 2) throws at module load when `MALIKA_ANON_SECRET` is unset. `jest.setup.env.js` runs before any test module loads, so seed a test secret there. Without this, every backend test that transitively requires the service crashes before `describe` runs (and CI has no `.env`).

**Files:**
- Modify: `backend/jest.setup.env.js`

- [ ] **Step 1: Back up the file**

Run: `cd backend && cp jest.setup.env.js jest.setup.env.js.backup`

- [ ] **Step 2: Append the test default**

Replace the entire contents of `backend/jest.setup.env.js` with:

```js
// jest.setup.env.js — loads backend/.env so tests inherit the OPENAI_API_URL /
// OPENAI_API_BASE_URL vars that the chat/AI services now require at module load
// (per the 2026-05-16 proxy-only rule). Without this, importing any module that
// checks process.env.OPENAI_API_URL at load time crashes the test before describe runs.
require('dotenv').config();

// Anonymous-identity signing secret. anonIdentity.service.js fails closed at
// module load when this is unset; CI has no .env, so seed a deterministic test
// value when one was not already provided.
if (!process.env.MALIKA_ANON_SECRET) {
  process.env.MALIKA_ANON_SECRET = 'test-anon-secret-not-for-prod';
}
```

- [ ] **Step 3: Verify the existing suite still loads and passes**

Run: `cd backend && DB_NAME=testdb DB_USER=testuser DB_PASS=testpass DB_HOST=localhost JWT_SECRET=test-secret npm test -- --ci --passWithNoTests`
Expected: PASS (same result as before this change — no new failures).

- [ ] **Step 4: Commit**

```bash
cd backend && git add jest.setup.env.js && git commit -m "test(chat): seed MALIKA_ANON_SECRET default for jest env"
```

---

## Task 2: `anonIdentity.service.js` — issue / verify / renew the signed token

Pure crypto module. `verifyToken` returns the decoded payload (`{ sub, typ, iat, exp }`) or `null` — this is a deliberate refinement of the spec's shorthand `{ uid }` so callers can read `payload.sub` and `shouldRenew` can read `payload.exp` from one return value.

**Files:**
- Create: `backend/src/services/chat/anonIdentity.service.js`
- Test: `backend/src/services/chat/__tests__/anonIdentity.service.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/chat/__tests__/anonIdentity.service.test.js`:

```js
const jwt = require('jsonwebtoken');
const svc = require('../anonIdentity.service');

const SECRET = process.env.MALIKA_ANON_SECRET; // seeded by jest.setup.env.js

describe('anonIdentity.service', () => {
  it('issues a token that verifies back to the same uid with typ=anon', () => {
    const token = svc.issueToken('user-A');
    const payload = svc.verifyToken(token);
    expect(payload).toBeTruthy();
    expect(payload.sub).toBe('user-A');
    expect(payload.typ).toBe('anon');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a tampered signature', () => {
    const token = svc.issueToken('user-A');
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect(svc.verifyToken(tampered)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ sub: 'user-A', typ: 'anon' }, SECRET, { expiresIn: -3600 });
    expect(svc.verifyToken(expired)).toBeNull();
  });

  it('rejects a token signed with the wrong secret', () => {
    const foreign = jwt.sign({ sub: 'user-A', typ: 'anon' }, 'some-other-secret', { expiresIn: 3600 });
    expect(svc.verifyToken(foreign)).toBeNull();
  });

  it('rejects a token whose typ is not "anon"', () => {
    const adminish = jwt.sign({ sub: 'user-A', typ: 'admin' }, SECRET, { expiresIn: 3600 });
    expect(svc.verifyToken(adminish)).toBeNull();
  });

  it('returns null for empty / non-string input', () => {
    expect(svc.verifyToken('')).toBeNull();
    expect(svc.verifyToken(null)).toBeNull();
    expect(svc.verifyToken(123)).toBeNull();
  });

  it('rejects a token signed with a different HMAC variant (algorithm pinned to HS256)', () => {
    const hs512 = jwt.sign({ sub: 'user-A', typ: 'anon' }, SECRET, { expiresIn: 3600, algorithm: 'HS512' });
    expect(svc.verifyToken(hs512)).toBeNull();
  });

  it('shouldRenew is true inside the 30-day window and false outside it', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(svc.shouldRenew({ exp: nowSec + 29 * 24 * 3600 })).toBe(true);
    expect(svc.shouldRenew({ exp: nowSec + 31 * 24 * 3600 })).toBe(false);
    expect(svc.shouldRenew({})).toBe(false);
    expect(svc.shouldRenew(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/services/chat/__tests__/anonIdentity.service.test.js`
Expected: FAIL — `Cannot find module '../anonIdentity.service'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/chat/anonIdentity.service.js`:

```js
'use strict';

/**
 * Signed anonymous identity for PWA chat (IDOR hardening, 2026-05-29).
 * Wraps the existing localStorage UUID in an HS256 JWT the client cannot forge.
 * Uses a dedicated secret so an anon token can never satisfy admin authMiddleware
 * and vice-versa. Fails closed at load (mirrors utils/requireProxyUrl.js).
 */
const jwt = require('jsonwebtoken');

const SECRET = process.env.MALIKA_ANON_SECRET;
if (!SECRET || !String(SECRET).trim()) {
  throw new Error('[anonIdentity.service] MALIKA_ANON_SECRET env var must be set (fail-closed)');
}

const TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days
const RENEW_SECONDS = 30 * 24 * 60 * 60; // renew when < 30 days remain

function issueToken(uid) {
  const sub = String(uid || '').trim();
  if (!sub) throw new Error('issueToken: uid required');
  return jwt.sign({ sub, typ: 'anon' }, SECRET, { expiresIn: TTL_SECONDS, algorithm: 'HS256' });
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    if (!payload || payload.typ !== 'anon' || !payload.sub) return null;
    return payload; // { sub, typ, iat, exp }
  } catch {
    return null;
  }
}

function shouldRenew(payload) {
  if (!payload || !payload.exp) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp - nowSec < RENEW_SECONDS;
}

module.exports = { issueToken, verifyToken, shouldRenew, TTL_SECONDS, RENEW_SECONDS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/services/chat/__tests__/anonIdentity.service.test.js`
Expected: PASS — 8 passing.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/services/chat/anonIdentity.service.js src/services/chat/__tests__/anonIdentity.service.test.js && git commit -m "feat(chat): add anonIdentity service for signed anon tokens"
```

---

## Task 3: `malikaIdentity.middleware.js` — token → `req.malikaUid`

Reads `x-malika-token`; on a valid token sets `req.malikaUid`. Strict mode rejects unsigned requests; dual-mode falls back to the bare `x-malika-uid` and tags `req.malikaLegacy` for telemetry. The strict flag is read **per request** so tests can flip it.

**Files:**
- Create: `backend/src/middleware/malikaIdentity.middleware.js`
- Test: `backend/src/middleware/__tests__/malikaIdentity.middleware.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/middleware/__tests__/malikaIdentity.middleware.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/middleware/__tests__/malikaIdentity.middleware.test.js`
Expected: FAIL — `Cannot find module '../malikaIdentity.middleware'`.

- [ ] **Step 3: Implement the middleware**

Create `backend/src/middleware/malikaIdentity.middleware.js`:

```js
'use strict';

/**
 * Anonymous identity gate for PWA chat (IDOR hardening, 2026-05-29).
 * Trusts the uid only when it arrives as a valid server-signed token.
 * The strict flag is read per-request so rollout can flip it without redeploy.
 */
const { verifyToken } = require('../services/chat/anonIdentity.service');

function isStrict() {
  return String(process.env.MALIKA_IDENTITY_STRICT || '').trim().toLowerCase() === 'true';
}

function malikaIdentityMiddleware(req, res, next) {
  const token = req.get('x-malika-token') || '';
  const payload = token ? verifyToken(token) : null;

  if (payload && payload.sub) {
    req.malikaUid = payload.sub;
    req.malikaTokenPayload = payload;
    return next();
  }

  if (isStrict()) {
    return res.status(401).json({ ok: false, error: 'identity_required' });
  }

  // Dual-mode rollout window: accept the bare uid, tag for telemetry.
  const legacy = String(req.get('x-malika-uid') || req.get('x-malika-user') || '').trim();
  if (legacy) {
    req.malikaUid = legacy;
    req.malikaLegacy = true;
  }
  return next();
}

module.exports = { malikaIdentityMiddleware };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/middleware/__tests__/malikaIdentity.middleware.test.js`
Expected: PASS — 5 passing.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/middleware/malikaIdentity.middleware.js src/middleware/__tests__/malikaIdentity.middleware.test.js && git commit -m "feat(chat): add malikaIdentity middleware (strict + dual-mode)"
```

---

## Task 4: `createIdentity` controller — mint / adopt / renew

Add the bootstrap handler to `chat.controller.js`. Three branches: a valid presented token renews for the same `sub`; a well-formed bare uid is adopted (legacy migration); otherwise a fresh uid is generated.

**Files:**
- Modify: `backend/src/controllers/chat.controller.js`
- Test: `backend/src/controllers/__tests__/chatIdentity.controller.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/__tests__/chatIdentity.controller.test.js`:

```js
// Mock the heavy chat siblings so requiring chat.controller does not pull the
// LLM proxy / streaming chain at load. createIdentity uses none of them.
jest.mock('../../services/chat/streaming/openaiClient', () => ({ chat: jest.fn() }));
jest.mock('../../services/chat/streaming.service', () => ({ streamChatResponse: jest.fn() }));
jest.mock('../../services/chat/threadSuggestions.service', () => ({ generateForThread: jest.fn() }));

const express = require('express');
const request = require('supertest');
const chatController = require('../chat.controller');
const { verifyToken, issueToken } = require('../../services/chat/anonIdentity.service');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post('/chat/identity', chatController.createIdentity);
  return app;
}

describe('createIdentity', () => {
  it('mints a fresh uid + token when nothing is presented', async () => {
    const res = await request(makeApp()).post('/chat/identity').send({});
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.uid).toBe('string');
    expect(verifyToken(res.body.token).sub).toBe(res.body.uid);
    expect(res.body.exp).toBeGreaterThan(0);
  });

  it('adopts a well-formed legacy bare uid', async () => {
    const res = await request(makeApp()).post('/chat/identity').send({ uid: 'uid_1699999999_abc' });
    expect(res.statusCode).toBe(200);
    expect(res.body.uid).toBe('uid_1699999999_abc');
    expect(verifyToken(res.body.token).sub).toBe('uid_1699999999_abc');
  });

  it('renews for the same sub when a valid token is presented', async () => {
    const token = issueToken('user-Z');
    const res = await request(makeApp()).post('/chat/identity')
      .set('x-malika-token', token)
      .send({ uid: 'someone-else' }); // ignored in favor of the token sub
    expect(res.body.uid).toBe('user-Z');
    expect(verifyToken(res.body.token).sub).toBe('user-Z');
  });

  it('falls back to a fresh uid when the presented uid is malformed', async () => {
    const res = await request(makeApp()).post('/chat/identity').send({ uid: 'x'.repeat(200) });
    expect(res.statusCode).toBe(200);
    expect(res.body.uid).not.toBe('x'.repeat(200));
    expect(verifyToken(res.body.token).sub).toBe(res.body.uid);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/chatIdentity.controller.test.js`
Expected: FAIL — `chatController.createIdentity is not a function`.

- [ ] **Step 3: Back up the controller**

Run: `cd backend && cp src/controllers/chat.controller.js src/controllers/chat.controller.js.backup`

- [ ] **Step 4: Add the requires at the top of `chat.controller.js`**

In `backend/src/controllers/chat.controller.js`, after the existing requires (currently lines 1-3), add:

```js
const anonIdentity = require('../services/chat/anonIdentity.service');
const { randomUUID } = require('crypto');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isWellFormedUid(uid) {
  const s = String(uid || '').trim();
  if (!s || s.length > 100) return false;
  return UUID_V4.test(s) || /^uid_/.test(s);
}
```

- [ ] **Step 5: Add the `createIdentity` handler**

In `backend/src/controllers/chat.controller.js`, immediately before the `module.exports = {` block, add:

```js
/**
 * Mint / renew a signed anonymous identity token.
 * POST /chat/identity  (public; MUST stay outside the identity guard).
 */
async function createIdentity(req, res, next) {
  try {
    const presented = req.get('x-malika-token') || '';
    const payload = presented ? anonIdentity.verifyToken(presented) : null;

    let uid;
    if (payload && payload.sub) {
      uid = payload.sub;                       // 1) sliding renewal
    } else if (isWellFormedUid(req.body?.uid)) {
      uid = String(req.body.uid).trim();        // 2) legacy adoption
    } else {
      uid = randomUUID();                        // 3) fresh identity
    }

    const token = anonIdentity.issueToken(uid);
    const verified = anonIdentity.verifyToken(token);
    return res.json({ ok: true, uid, token, exp: verified?.exp });
  } catch (e) {
    next(e);
  }
}
```

- [ ] **Step 6: Export the handler**

In the `module.exports = {` block of `chat.controller.js`, add `createIdentity,` to the list.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/chatIdentity.controller.test.js`
Expected: PASS — 4 passing.

- [ ] **Step 8: Commit**

```bash
cd backend && git add src/controllers/chat.controller.js src/controllers/__tests__/chatIdentity.controller.test.js && git commit -m "feat(chat): add createIdentity bootstrap handler"
```

---

## Task 5: Owner derivation + IDOR regression test

The core fix: ownership must come from the verified token, not the raw header. This task wires `getOwnerIdFromReq` to `req.malikaUid` and proves — end to end through the real middleware and the real `getThreadOwned` scoping — that user A cannot read or write user B's thread.

The test mocks `openaiClient` (so requiring `chat.service` doesn't trip the proxy-url load guard) and the `ChatThread` model (so no live DB is needed) while exercising the **real** middleware + **real** service.

**Files:**
- Modify: `backend/src/services/chat/chat.service.js:93-109` (`getOwnerIdFromReq`)
- Test: `backend/src/__tests__/integration/chat.idor.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/integration/chat.idor.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/integration/chat.idor.test.js`
Expected: FAIL — the read/write cases return `400 missing_owner` (because `getOwnerIdFromReq` still reads the header, which supertest didn't set), not the expected `404`/`200`.

- [ ] **Step 3: Back up the service**

Run: `cd backend && cp src/services/chat/chat.service.js src/services/chat/chat.service.js.backup`

- [ ] **Step 4: Rewrite `getOwnerIdFromReq` to read `req.malikaUid`**

In `backend/src/services/chat/chat.service.js`, replace the current function (lines 93-109):

```js
function getOwnerIdFromReq(req) {
  const raw = req.get('x-malika-uid') || req.get('x-malika-user') || '';
  const ownerId = String(raw || '').trim();
  if (!ownerId) {
    const err = new Error('Missing x-malika-uid header');
    err.status = 400;
    err.code = 'missing_owner';
    throw err;
  }
  if (ownerId.length > 100) {
    const err = new Error('Invalid x-malika-uid header');
    err.status = 400;
    err.code = 'invalid_owner';
    throw err;
  }
  return ownerId;
}
```

with:

```js
function getOwnerIdFromReq(req) {
  // Identity is set by malikaIdentityMiddleware: the verified token's sub, or
  // (dual-mode only) the legacy bare uid. Never read the raw header here.
  const ownerId = String(req.malikaUid || '').trim();
  if (!ownerId) {
    const err = new Error('Missing identity');
    err.status = 400;
    err.code = 'missing_owner';
    throw err;
  }
  if (ownerId.length > 100) {
    const err = new Error('Invalid identity');
    err.status = 400;
    err.code = 'invalid_owner';
    throw err;
  }
  return ownerId;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/integration/chat.idor.test.js`
Expected: PASS — 4 passing.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/services/chat/chat.service.js src/__tests__/integration/chat.idor.test.js && git commit -m "fix(chat): derive thread ownership from verified token (closes IDOR)"
```

---

## Task 6: Route wiring + controller header swaps + remove GET stream leak vector

Apply the guard per-route (so the bootstrap `/identity` route stays open), swap the remaining direct header reads in the feedback/error-learning controllers to `req.malikaUid`, and delete the `GET …?text=` stream path (leak vector H11). A routing test proves the guard is mounted, the bootstrap is exempt, and the GET stream route is gone.

**Files:**
- Modify: `backend/src/routes/chat.routes.js`
- Modify: `backend/src/controllers/chat.controller.js` (`streamMessage` — drop `req.query.text`)
- Modify: `backend/src/routes/chatFeedback.routes.js`
- Modify: `backend/src/controllers/chatFeedback.controller.js` (4 reads)
- Modify: `backend/src/routes/errorLearning.routes.js` (`POST /flag` only)
- Modify: `backend/src/controllers/errorLearning.controller.js` (1 read)
- Test: `backend/src/__tests__/integration/chat.identity.routing.test.js`

- [ ] **Step 1: Write the failing routing test**

Create `backend/src/__tests__/integration/chat.identity.routing.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/integration/chat.identity.routing.test.js`
Expected: FAIL — the first case returns `200` (no guard mounted yet) and the GET-stream case returns `200` (route still present).

- [ ] **Step 3: Back up the files**

Run: `cd backend && cp src/routes/chat.routes.js src/routes/chat.routes.js.backup && cp src/routes/chatFeedback.routes.js src/routes/chatFeedback.routes.js.backup && cp src/routes/errorLearning.routes.js src/routes/errorLearning.routes.js.backup && cp src/controllers/chatFeedback.controller.js src/controllers/chatFeedback.controller.js.backup && cp src/controllers/errorLearning.controller.js src/controllers/errorLearning.controller.js.backup`

(`chat.controller.js` was already backed up in Task 4 — do not overwrite that backup.)

- [ ] **Step 4: Rewrite `chat.routes.js`**

Replace the entire contents of `backend/src/routes/chat.routes.js` with:

```js
const express = require('express');
const chatController = require('../controllers/chat.controller');
const { malikaIdentityMiddleware } = require('../middleware/malikaIdentity.middleware');

const router = express.Router();

// Bootstrap: mint/renew a signed identity. MUST stay un-guarded — it is what
// issues the token, so requiring a valid token here would deadlock strict mode.
router.post('/identity', chatController.createIdentity);

// Data routes — guarded: ownership is derived from the verified token.
router.get('/threads', malikaIdentityMiddleware, chatController.listThreads);
router.post('/threads', malikaIdentityMiddleware, chatController.createThread);
router.get('/threads/:id/messages', malikaIdentityMiddleware, chatController.listMessages);
router.post('/threads/:id/messages', malikaIdentityMiddleware, chatController.sendMessage);
router.get('/threads/:id/suggestions', malikaIdentityMiddleware, chatController.getThreadSuggestions);

// Streaming over SSE — POST only. The GET ?text= variant was removed: it leaked
// queries/credentials into URLs and access logs (audit finding H11).
router.post('/threads/:id/stream', malikaIdentityMiddleware, chatController.streamMessage);

module.exports = router;
```

- [ ] **Step 5: Simplify `streamMessage` to read the body only**

In `backend/src/controllers/chat.controller.js`, update the JSDoc above `streamMessage` and the `userMessage` line. Change the JSDoc line `* GET /threads/:id/stream?text=...` to `* POST /threads/:id/stream`. Change:

```js
    const userMessage = String(req.query.text || req.body?.text || '').trim();
```

to:

```js
    const userMessage = String(req.body?.text || '').trim();
```

- [ ] **Step 6: Rewrite `chatFeedback.routes.js`**

Replace the entire contents of `backend/src/routes/chatFeedback.routes.js` with:

```js
const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/chatFeedback.controller');
const { malikaIdentityMiddleware } = require('../middleware/malikaIdentity.middleware');

// Public endpoints — identity derived from the signed token (dual-mode: bare uid).
router.post('/', malikaIdentityMiddleware, feedbackController.submitFeedback);
router.post('/general', malikaIdentityMiddleware, feedbackController.submitGeneralFeedback);
router.get('/mine', malikaIdentityMiddleware, feedbackController.getMyFeedback);
router.get('/thread/:thread_id', malikaIdentityMiddleware, feedbackController.getFeedbackByThread);

// NOTE: /all returns all feedback and is NOT admin-gated today — pre-existing,
// out of scope for this IDOR fix. The guard at least requires a valid signed
// identity; proper admin-gating is tracked separately.
router.get('/all', malikaIdentityMiddleware, feedbackController.getAllFeedbacks);

module.exports = router;
```

- [ ] **Step 7: Swap the 4 header reads in `chatFeedback.controller.js`**

In `backend/src/controllers/chatFeedback.controller.js`, replace each of the 4 occurrences of:

```js
    const ownerId = req.headers['x-malika-uid'] || null;
```

with:

```js
    const ownerId = req.malikaUid || null;
```

(They are at lines 10, 71, 122, 146 — all identical, so a replace-all is safe.)

- [ ] **Step 8: Guard `POST /flag` in `errorLearning.routes.js`**

In `backend/src/routes/errorLearning.routes.js`, add the middleware import after line 10:

```js
const { malikaIdentityMiddleware } = require('../middleware/malikaIdentity.middleware');
```

Then change the public flag route (line 15) from:

```js
router.post('/flag', auditEL, errorLearningController.flagMessage);
```

to:

```js
router.post('/flag', malikaIdentityMiddleware, auditEL, errorLearningController.flagMessage);
```

**Leave every `authMiddleware, requireAdmin` route below it unchanged** — those are admin-only and must NOT receive the anon guard.

- [ ] **Step 9: Swap the header read in `errorLearning.controller.js`**

In `backend/src/controllers/errorLearning.controller.js` line 16, change:

```js
    const ownerId = req.headers['x-malika-uid'] || null;
```

to:

```js
    const ownerId = req.malikaUid || null;
```

- [ ] **Step 10: Run the routing test to verify it passes**

Run: `cd backend && npx jest src/__tests__/integration/chat.identity.routing.test.js`
Expected: PASS — 4 passing.

- [ ] **Step 11: Run the full backend suite (regression check)**

Run: `cd backend && DB_NAME=testdb DB_USER=testuser DB_PASS=testpass DB_HOST=localhost JWT_SECRET=test-secret npm test -- --ci --passWithNoTests`
Expected: PASS — no new failures. (The pre-existing `integration/chat.test.js` still passes: it mocks the controller, so the added middleware import in `chat.routes.js` loads but its handlers are bypassed.)

- [ ] **Step 12: Commit**

```bash
cd backend && git add src/routes/chat.routes.js src/controllers/chat.controller.js src/routes/chatFeedback.routes.js src/controllers/chatFeedback.controller.js src/routes/errorLearning.routes.js src/controllers/errorLearning.controller.js src/__tests__/integration/chat.identity.routing.test.js && git commit -m "fix(chat): guard chat routes with identity middleware, drop GET stream leak"
```

---

## Task 7: Backend env vars (ops — not committed)

`backend/.env` is gitignored, so this is a deployment step, not a code commit. The backend ships in **dual-mode** first.

**Files:**
- Modify: `backend/.env` (gitignored — **do not `git add`**)
- Modify: `backend/.env.example` **only if it exists**

- [ ] **Step 1: Generate a strong secret**

Run: `openssl rand -hex 32`
Expected: a 64-character hex string. Copy it.

- [ ] **Step 2: Append the two keys to `backend/.env`**

Add these lines to `backend/.env` (replace `<hex>` with the value from Step 1). Use a text editor — do not echo secrets into shell history:

```
MALIKA_ANON_SECRET=<hex>
MALIKA_IDENTITY_STRICT=false
```

- [ ] **Step 3: If `backend/.env.example` exists, mirror the keys there (no real value)**

Add to `backend/.env.example` if present:

```
MALIKA_ANON_SECRET=
MALIKA_IDENTITY_STRICT=false
```

If `backend/.env.example` does not exist, skip this step (do not create it).

- [ ] **Step 4: Reload the backend in dual-mode**

Run: `pm2 reload pds-backend --update-env`
Expected: `pds-backend` restarts cleanly. Verify it booted (the fail-closed service throws if the secret is missing):
Run: `pm2 logs pds-backend --lines 30 --nostream`
Expected: no `MALIKA_ANON_SECRET env var must be set` error.

- [ ] **Step 5: Smoke-test the bootstrap endpoint**

Run: `curl -s -X POST http://127.0.0.1:5000/chat/identity -H 'Content-Type: application/json' -d '{}'`
Expected: JSON `{ "ok": true, "uid": "...", "token": "...", "exp": <number> }`.

(No commit — `.env` is gitignored. If you edited `.env.example`, commit only that: `git add backend/.env.example && git commit -m "docs(chat): document anon-identity env vars"`.)

---

## Frontend testing note (read before Tasks 8–11)

`frontend/` has **no unit-test runner** — its only test stack is Playwright e2e (`.claude/rules/testing.md`), which needs the full app running and is out of scope for these unit-level changes. So the frontend tasks use a different verification loop than the backend TDD loop:

1. Back up the file (`cp {file} {file}.backup`).
2. Make the edit.
3. **Type-check:** `npx tsc --noEmit` (strict; this is the CI gate for the Next apps).
4. Commit.

The end-to-end behavioral proof for the frontend lives in **Task 12** (production build + manual browser smoke). Do **not** scaffold a new Jest/Vitest setup in `frontend/` just for these tasks — that is scope creep (YAGNI).

---

## Task 8: Client token store — `getMalikaTokenSync` + `ensureMalikaToken`

Add two functions to the chat helper module: a synchronous reader the transport layer can call at fetch time, and an async mint/renew that adopts the existing bare uid.

**Files:**
- Modify: `frontend/src/app/(admin)/chat/chatHelpers.tsx:51` (insert after `getOrCreateMalikaUid`)

- [ ] **Step 1: Back up the file**

```bash
cd frontend && cp "src/app/(admin)/chat/chatHelpers.tsx" "src/app/(admin)/chat/chatHelpers.tsx.backup"
```

- [ ] **Step 2: Insert the token helpers after `getOrCreateMalikaUid`**

In `frontend/src/app/(admin)/chat/chatHelpers.tsx`, find the end of `getOrCreateMalikaUid` (the closing `}` on line 51) and insert the following block immediately after it (before the `// Search history helpers` comment):

```tsx

// ---------------------------------------------------------------------------
// Signed anonymous identity token (IDOR fix)
// Spec: docs/superpowers/specs/2026-05-29-chat-idor-auth-design.md
// ---------------------------------------------------------------------------

const MALIKA_TOKEN_KEY = "malika_token";
// Renew when fewer than 30 days remain — mirrors the backend RENEW_SECONDS window.
const TOKEN_RENEW_SECONDS = 30 * 24 * 60 * 60;

type StoredToken = { uid: string; token: string; exp: number };

function readStoredToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(MALIKA_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.uid === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.exp === "number"
    ) {
      return parsed as StoredToken;
    }
    return null;
  } catch {
    return null;
  }
}

/** Synchronous read of a still-valid signed token, or "" if absent/expired. */
export function getMalikaTokenSync(): string {
  const stored = readStoredToken();
  if (!stored) return "";
  const now = Math.floor(Date.now() / 1000);
  return stored.exp > now ? stored.token : "";
}

/**
 * Ensure a signed identity token exists and is not near expiry.
 * Mints/renews via POST /api/chat/identity, adopting the existing bare uid.
 * Fail-soft: on any network/parse error returns the current stored token (or "").
 */
export async function ensureMalikaToken(uid: string): Promise<string> {
  const stored = readStoredToken();
  const now = Math.floor(Date.now() / 1000);
  if (stored && stored.exp - now > TOKEN_RENEW_SECONDS) {
    return stored.token;
  }
  try {
    const reqHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (uid) reqHeaders["x-malika-uid"] = uid;
    if (stored?.token) reqHeaders["x-malika-token"] = stored.token;
    const res = await fetch(`${backendBaseUrl()}/identity`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ uid }),
    });
    if (!res.ok) return stored?.token || "";
    const data = await res.json();
    if (data && typeof data.token === "string" && typeof data.exp === "number") {
      const next: StoredToken = { uid: data.uid || uid, token: data.token, exp: data.exp };
      try {
        localStorage.setItem(MALIKA_TOKEN_KEY, JSON.stringify(next));
      } catch {
        // localStorage quota / disabled — token still usable in-memory this session
      }
      return next.token;
    }
    return stored?.token || "";
  } catch {
    return stored?.token || "";
  }
}
```

Note: `backendBaseUrl()` returns `"/api/chat"` (line 15–17 of this same file), so the fetch URL resolves to `/api/chat/identity` — the proxy route created in Task 9.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd frontend && git add "src/app/(admin)/chat/chatHelpers.tsx" && git commit -m "feat(chat): client store for signed anon identity token"
```

---

## Task 9: New Next proxy route — `POST /api/chat/identity`

The bootstrap mint endpoint. Forwards to backend `POST /chat/identity`, passing through any existing bare uid and/or token so the backend can renew vs. adopt vs. mint-new.

**Files:**
- Create: `frontend/src/app/api/chat/identity/route.ts`

- [ ] **Step 1: Create the route file**

Write `frontend/src/app/api/chat/identity/route.ts`:

```ts
import { NextRequest } from "next/server";
import { backendBaseUrl, getMalikaUid, getMalikaToken } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  const uid = getMalikaUid(req);
  const token = getMalikaToken(req);
  const body = await req.json().catch(() => null);

  const url = `${backendBaseUrl()}/chat/identity`;

  const fwd: Record<string, string> = { "Content-Type": "application/json" };
  if (uid) fwd["x-malika-uid"] = uid;
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: fwd,
      body: JSON.stringify({ uid: body?.uid }),
      cache: "no-store",
    });
  } catch {
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `backend_http_${res.status}`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json, { status: 200 });
  } catch {
    return Response.json({ ok: false, error: "backend_non_json" }, { status: 502 });
  }
}
```

(`getMalikaToken` is added to `@/lib/apiHelpers` in Task 10, Step 1. If you execute tasks out of order, do that step first or `tsc` will fail on the missing import.)

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (after Task 10 Step 1 adds `getMalikaToken`).

- [ ] **Step 3: Commit**

```bash
cd frontend && git add src/app/api/chat/identity/route.ts && git commit -m "feat(chat): add /api/chat/identity proxy route"
```

---

## Task 10: Forward `x-malika-token` in existing proxy routes + delete the GET stream leak

Add a shared `getMalikaToken` helper, forward the token header in all four data proxy routes, relax the `missing_uid` guard to accept token-only requests (needed once `STRICT=on`), and delete the `GET …?text=` stream handler (audit finding H11 — puts queries/credentials in URLs/access logs).

**Files:**
- Modify: `frontend/src/lib/apiHelpers.ts`
- Modify: `frontend/src/app/api/chat/threads/route.ts`
- Modify: `frontend/src/app/api/chat/threads/[id]/messages/route.ts`
- Modify: `frontend/src/app/api/chat/threads/[id]/suggestions/route.ts`
- Modify: `frontend/src/app/api/chat/threads/[id]/stream/route.ts` (also **delete** the GET handler)

- [ ] **Step 1: Back up all five files**

```bash
cd frontend && for f in src/lib/apiHelpers.ts "src/app/api/chat/threads/route.ts" "src/app/api/chat/threads/[id]/messages/route.ts" "src/app/api/chat/threads/[id]/suggestions/route.ts" "src/app/api/chat/threads/[id]/stream/route.ts"; do cp "$f" "$f.backup"; done
```

- [ ] **Step 2: Add `getMalikaToken` to `apiHelpers.ts`**

In `frontend/src/lib/apiHelpers.ts`, append after `getMalikaUid` (end of file):

```ts

/**
 * Extract and sanitise the x-malika-token header from a request.
 */
export function getMalikaToken(req: NextRequest): string {
  const token = req.headers.get("x-malika-token") || "";
  return String(token).trim();
}
```

- [ ] **Step 3: Rewrite `threads/route.ts` (full file)**

Replace the entire contents of `frontend/src/app/api/chat/threads/route.ts` with:

```ts
import { NextRequest } from "next/server";
import { backendBaseUrl, getMalikaUid, getMalikaToken } from "@/lib/apiHelpers";

export async function GET(req: NextRequest) {
  const uid = getMalikaUid(req);
  const token = getMalikaToken(req);
  if (!uid && !token) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const url = `${backendBaseUrl()}/chat/threads`;

  const fwd: Record<string, string> = {};
  if (uid) fwd["x-malika-uid"] = uid;
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, { headers: fwd, cache: "no-store" });
  } catch {
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `backend_http_${res.status}`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json, { status: 200 });
  } catch {
    return Response.json({ ok: false, error: "backend_non_json" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const uid = getMalikaUid(req);
  const token = getMalikaToken(req);
  if (!uid && !token) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);

  const url = `${backendBaseUrl()}/chat/threads`;

  const fwd: Record<string, string> = { "Content-Type": "application/json" };
  if (uid) fwd["x-malika-uid"] = uid;
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: fwd,
      body: JSON.stringify({ title: body?.title }),
      cache: "no-store",
    });
  } catch {
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `backend_http_${res.status}`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json, { status: 201 });
  } catch {
    return Response.json({ ok: false, error: "backend_non_json" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Rewrite `threads/[id]/messages/route.ts` (full file)**

Replace the entire contents of `frontend/src/app/api/chat/threads/[id]/messages/route.ts` with:

```ts
import { NextRequest } from "next/server";
import { backendBaseUrl, getMalikaUid, getMalikaToken } from "@/lib/apiHelpers";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = getMalikaUid(req);
  const token = getMalikaToken(req);
  if (!uid && !token) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const threadId = Number(id);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return Response.json({ ok: false, error: "invalid_thread_id" }, { status: 400 });
  }

  const url = `${backendBaseUrl()}/chat/threads/${encodeURIComponent(String(threadId))}/messages`;

  const fwd: Record<string, string> = {};
  if (uid) fwd["x-malika-uid"] = uid;
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, { headers: fwd, cache: "no-store" });
  } catch {
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `backend_http_${res.status}`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json, { status: 200 });
  } catch {
    return Response.json({ ok: false, error: "backend_non_json" }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = getMalikaUid(req);
  const token = getMalikaToken(req);
  if (!uid && !token) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const threadId = Number(id);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return Response.json({ ok: false, error: "invalid_thread_id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);

  const url = `${backendBaseUrl()}/chat/threads/${encodeURIComponent(String(threadId))}/messages`;

  const fwd: Record<string, string> = { "Content-Type": "application/json" };
  if (uid) fwd["x-malika-uid"] = uid;
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: fwd,
      body: JSON.stringify({ text: body?.text }),
      cache: "no-store",
    });
  } catch {
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `backend_http_${res.status}`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json, { status: 201 });
  } catch {
    return Response.json({ ok: false, error: "backend_non_json" }, { status: 502 });
  }
}
```

- [ ] **Step 5: Edit `threads/[id]/suggestions/route.ts` (targeted — it already imports from apiHelpers)**

Change the import on line 2 from:

```ts
import { backendBaseUrl, getMalikaUid } from "@/lib/apiHelpers";
```

to:

```ts
import { backendBaseUrl, getMalikaUid, getMalikaToken } from "@/lib/apiHelpers";
```

Change the guard (lines 5–8) from:

```ts
  const uid = getMalikaUid(req);
  if (!uid) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }
```

to:

```ts
  const uid = getMalikaUid(req);
  const token = getMalikaToken(req);
  if (!uid && !token) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }
```

Change the fetch block (lines 18–25) from:

```ts
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "x-malika-uid": uid,
      },
      cache: "no-store",
    });
```

to:

```ts
  const fwd: Record<string, string> = {};
  if (uid) fwd["x-malika-uid"] = uid;
  if (token) fwd["x-malika-token"] = token;

  let res: Response;
  try {
    res = await fetch(url, { headers: fwd, cache: "no-store" });
```

- [ ] **Step 6: Rewrite `threads/[id]/stream/route.ts` (full file — POST only, GET deleted)**

Replace the entire contents of `frontend/src/app/api/chat/threads/[id]/stream/route.ts` with (this drops the `GET` handler entirely):

```ts
import { NextRequest } from "next/server";
import { backendBaseUrl, getMalikaUid, getMalikaToken } from "@/lib/apiHelpers";

/**
 * Proxy SSE stream from backend to client.
 * POST /api/chat/threads/[id]/stream
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = getMalikaUid(req);
  const token = getMalikaToken(req);
  if (!uid && !token) {
    return Response.json({ ok: false, error: "missing_uid" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const threadId = Number(id);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return Response.json({ ok: false, error: "invalid_thread_id" }, { status: 400 });
  }

  let text = "";
  let model = "";
  try {
    const body = await req.json();
    text = String(body?.text || "").trim();
    model = String(body?.model || "").trim();
  } catch {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (!text) {
    return Response.json({ ok: false, error: "missing_text" }, { status: 400 });
  }

  const url = `${backendBaseUrl()}/chat/threads/${encodeURIComponent(String(threadId))}/stream`;

  const fwd: Record<string, string> = { "Content-Type": "application/json" };
  if (uid) fwd["x-malika-uid"] = uid;
  if (token) fwd["x-malika-token"] = token;

  let backendRes: Response;
  try {
    backendRes = await fetch(url, {
      method: "POST",
      headers: fwd,
      body: JSON.stringify({ text, ...(model ? { model } : {}) }),
      // @ts-expect-error - Node.js fetch supports this
      duplex: "half",
    });
  } catch (error) {
    console.error("[Stream Proxy] Backend fetch error:", error);
    return Response.json({ ok: false, error: "backend_unreachable" }, { status: 502 });
  }

  if (!backendRes.ok) {
    const errorText = await backendRes.text().catch(() => "");
    return Response.json(
      { ok: false, error: `backend_http_${backendRes.status}`, detail: errorText.slice(0, 500) },
      { status: 502 }
    );
  }

  const contentType = backendRes.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream") && !backendRes.body) {
    return Response.json({ ok: false, error: "backend_not_sse" }, { status: 502 });
  }

  const stream = backendRes.body;
  if (!stream) {
    return Response.json({ ok: false, error: "no_stream_body" }, { status: 502 });
  }

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 7: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd frontend && git add src/lib/apiHelpers.ts "src/app/api/chat/threads/route.ts" "src/app/api/chat/threads/[id]/messages/route.ts" "src/app/api/chat/threads/[id]/suggestions/route.ts" "src/app/api/chat/threads/[id]/stream/route.ts" && git commit -m "fix(chat): forward x-malika-token in proxies, drop GET stream leak"
```

---

## Task 11: Wire the token into client requests

Two consumers send the headers: the SSE transport (`chatTransport.ts`) and the REST `headers` memo in `ChatPageClient.tsx`. Both must add `x-malika-token` alongside the existing `x-malika-uid`. The transport reads the token synchronously at fetch time (freshest value, survives React state lag).

**Files:**
- Modify: `frontend/src/lib/chatTransport.ts:15` (import) and `:152-162` (fetch headers)
- Modify: `frontend/src/app/(admin)/chat/ChatPageClient.tsx` — import (`:62-73`), state (`:110`), mount effect (`:1075-1078`), headers memo (`:285-291`)

- [ ] **Step 1: Back up both files**

```bash
cd frontend && cp src/lib/chatTransport.ts src/lib/chatTransport.ts.backup && cp "src/app/(admin)/chat/ChatPageClient.tsx" "src/app/(admin)/chat/ChatPageClient.tsx.backup"
```

- [ ] **Step 2: `chatTransport.ts` — add the import**

After line 16 (`import type { ThinkingItem } from "@/types/chat";`), add:

```ts
import { getMalikaTokenSync } from "@/app/(admin)/chat/chatHelpers";
```

- [ ] **Step 3: `chatTransport.ts` — send the token header**

Replace the fetch headers block (currently lines 154–162):

```ts
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-malika-uid": malikaUid,
        },
        body: JSON.stringify({ text, model: options?.model || "claude-sonnet-4-6" }),
        signal: controller.signal,
      });
```

with:

```ts
      const reqHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "x-malika-uid": malikaUid,
      };
      const malikaToken = getMalikaTokenSync();
      if (malikaToken) reqHeaders["x-malika-token"] = malikaToken;
      const res = await fetch(url, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({ text, model: options?.model || "claude-sonnet-4-6" }),
        signal: controller.signal,
      });
```

- [ ] **Step 4: `ChatPageClient.tsx` — extend the chatHelpers import**

Change the import block (lines 70–73) from:

```tsx
  getOrCreateMalikaUid,
  getSearchHistory,
  addToSearchHistory,
} from "./chatHelpers";
```

to:

```tsx
  getOrCreateMalikaUid,
  getMalikaTokenSync,
  ensureMalikaToken,
  getSearchHistory,
  addToSearchHistory,
} from "./chatHelpers";
```

- [ ] **Step 5: `ChatPageClient.tsx` — add token state**

After line 110 (`const [malikaUid, setMalikaUid] = useState<string>("");`), add:

```tsx
  const [malikaToken, setMalikaToken] = useState<string>("");
```

- [ ] **Step 6: `ChatPageClient.tsx` — mint/renew the token on mount**

Replace the mount effect (lines 1075–1078):

```tsx
  useEffect(() => {
    const uid = getOrCreateMalikaUid();
    setMalikaUid(uid);
  }, []);
```

with:

```tsx
  useEffect(() => {
    const uid = getOrCreateMalikaUid();
    setMalikaUid(uid);
    setMalikaToken(getMalikaTokenSync());
    ensureMalikaToken(uid)
      .then((t) => { if (t) setMalikaToken(t); })
      .catch(() => { /* fail-soft: legacy uid still works while STRICT=off */ });
  }, []);
```

- [ ] **Step 7: `ChatPageClient.tsx` — add the token to the REST headers memo**

Replace the headers memo (lines 285–291):

```tsx
  const headers = useMemo(() => {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (malikaUid) h["x-malika-uid"] = malikaUid;
    return h;
  }, [malikaUid]);
```

with:

```tsx
  const headers = useMemo(() => {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (malikaUid) h["x-malika-uid"] = malikaUid;
    if (malikaToken) h["x-malika-token"] = malikaToken;
    return h;
  }, [malikaUid, malikaToken]);
```

- [ ] **Step 8: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
cd frontend && git add src/lib/chatTransport.ts "src/app/(admin)/chat/ChatPageClient.tsx" && git commit -m "feat(chat): send signed identity token from PWA chat client"
```

---

## Task 12: Full verification + no-downtime rollout

End-to-end proof and the staged production rollout. No new code — this is the gate before the IDOR is actually closed in prod.

**Files:** none (build + ops).

- [ ] **Step 1: Backend suite (green)**

Run: `cd backend && DB_NAME=testdb DB_USER=testuser DB_PASS=testpass DB_HOST=localhost JWT_SECRET=test-secret npm test -- --ci --passWithNoTests`
Expected: PASS — including the new `anonIdentity.service.test.js`, `malikaIdentity.middleware.test.js`, `chat.idor.test.js`, and `chat.identity.routing.test.js`.

- [ ] **Step 2: Frontend type-check + production build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: type-check clean; build succeeds. The deleted GET stream route must not be referenced anywhere (build would fail on a dangling import otherwise).

- [ ] **Step 3: Deploy backend in dual-mode (`STRICT=off`)**

Confirm `backend/.env` has `MALIKA_ANON_SECRET=<hex>` and `MALIKA_IDENTITY_STRICT=false` (Task 7), then:
Run: `pm2 reload pds-backend --update-env`
Run: `pm2 logs pds-backend --lines 30 --nostream`
Expected: clean boot, no `MALIKA_ANON_SECRET` fail-closed error.

- [ ] **Step 4: Deploy frontend (build already done in Step 2)**

Run: `cd frontend && pm2 reload pds-frontend --update-env`
Expected: `pds-frontend` re-execs the fresh `.next` bundle.

- [ ] **Step 5: Manual browser smoke (golden path + IDOR probe)**

Open `https://malika.bpsmalut.com` chat (or `http://localhost:6060`). Verify:
1. **Golden path:** send a message → SSE streams a reply; reload → thread + messages persist.
2. **Token minted:** DevTools → Application → Local Storage → a `malika_token` entry with `{uid, token, exp}`; Network tab shows requests carry both `x-malika-uid` and `x-malika-token`.
3. **IDOR probe (the proof):** copy your `x-malika-token`, then try to read another uid's thread by id with only a forged bare uid — backend returns `404` (scoped to the token's `sub`, not the forged header). With `STRICT=off` a bare-uid-only request still works (legacy); confirm `req.malikaLegacy` telemetry appears for it.

If you cannot exercise the browser, say so explicitly — type-check and unit tests prove code correctness, not feature correctness.

- [ ] **Step 6: Monitor the legacy rate, then flip to strict**

Watch the `req.malikaLegacy` rate (the share of requests still arriving without a valid token). Over the ~45-day adoption window it should fall toward ~0 as clients mint tokens. When it is ~0:
1. Set `MALIKA_IDENTITY_STRICT=true` in `backend/.env`.
2. Run: `pm2 reload pds-backend --update-env`.
3. Re-run the Step 5 IDOR probe: a forged bare uid with **no** token now returns `401 { ok:false, error:"identity_required" }`.

At that point the IDOR is fully closed: only server-signed tokens are trusted, the `?text=` URL leak vector is gone, and residual risk is bounded by the 180-day token expiry.

---

## Self-review (completed by plan author)

- **Spec coverage:** Components a–g of the design map to tasks — a→Task 2, b→Task 3, c→Task 4, d→Tasks 5 & 6, e→Task 6, f→Tasks 8/9/10/11, g→Tasks 6 (backend GET delete) & 10 (frontend GET delete). Env/rollout → Tasks 7 & 12. Test matrix → Tasks 2, 3, 5, 6 + Task 12.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; every command shows expected output.
- **Type consistency:** `verifyToken` returns the full JWT payload (used as `.sub` in middleware, `.exp` in `shouldRenew`); `issueToken(uid)`/`verifyToken(token)`/`shouldRenew(payload)` signatures are consistent across Tasks 2–6; `getMalikaTokenSync()`/`ensureMalikaToken(uid)` signatures are consistent across Tasks 8 & 11; `getMalikaToken(req)` (added Task 10 Step 1) is imported by Tasks 9 & 10 — note the ordering caveat called out in Task 9.
