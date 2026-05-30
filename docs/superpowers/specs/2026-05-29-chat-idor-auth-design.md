# Chat IDOR Fix — Unforgeable Anonymous Identity for PWA Chat

> Date: 2026-05-29
> Status: Approved design (pre-implementation)
> Scope: Close the `/chat/*` IDOR without breaking anonymous public chat.

## Problem

`/chat/*` is mounted with no authentication (`app.js:132` — only `chatLimiter`). Chat
ownership is derived purely from a client-supplied, unverified `x-malika-uid` header
(`chat.service.js:93-95`), and thread access is scoped by it (`getThreadOwned`,
`chat.service.js:149-150`). Any client can read/write any other user's threads by
spoofing the header:

```
curl -H 'x-malika-uid: <victim_uid>' https://api-malika.bpsmalut.com/chat/threads
```

This is a textbook IDOR over the entire chat corpus (which contains user PII and queries).

### Why not "just add authMiddleware"

PWA chat is **intentionally anonymous**. `csrf.middleware.js:27` documents `/chat` as
"Public chat with its own auth (x-malika-uid)". There is no login for chat users;
`auth.middleware.js` (JWT + `User` table + roles) is the **admin-only** system. The
identity is a `localStorage` UUIDv4 (`chatHelpers.tsx:28-32`, 122 bits via
`crypto.getRandomValues`), with a weaker fallback `uid_<ts>_<Math.random>` at `:37`.
Requiring login would gate a public-service tool behind accounts — wrong product
direction. The real defect is that the UID is a **bearer credential with no proof of
possession**: not brute-forceable online, but on leak (logs, `?text=` URLs, shared
device) it grants permanent impersonation with no client binding.

## Goal

Make the anonymous identity **unforgeable** — the backend trusts the uid only when it
arrives with a valid server-issued signature — while preserving anonymous access and
not orphaning existing threads.

## Approach (selected: A — HMAC-signed identity token)

Wrap the existing UUIDv4 in a server-signed token the client cannot forge. The uid is
unchanged; we add a signature the backend verifies before trusting it.

Rejected alternatives:
- **B — HttpOnly session cookie:** more robust (XSS can't read it; nothing in URLs),
  but threads `Set-Cookie`/cookies across the browser→Next→backend double hop on two
  subdomains (`malika.` vs `api-malika.bpsmalut.com`). Documented as **future
  hardening**, not built now. Client XSS surface is already low (chat render is
  XSS-safe: no `dangerouslySetInnerHTML`, `JSON.parse` in try/catch, `safeHref`).
- **C — Real login/accounts:** ends anonymous access; out of scope.

### Token

- **Format:** JWT (HS256) via the existing `jsonwebtoken` dependency.
- **Payload:** `{ sub: <uid>, typ: "anon", iat, exp }`.
- **Secret:** dedicated `MALIKA_ANON_SECRET` (env), **separate** from admin `JWT_SECRET`
  so an anon token can never be accepted by `authMiddleware` and vice-versa.
- **TTL:** 180 days. Renew silently when < 30 days remain.

## Components

Each unit is small and single-purpose.

### a) `backend/src/services/chat/anonIdentity.service.js` (new, ~40 lines)
- `issueToken(uid)` → signed JWT (`typ: "anon"`, 180d exp).
- `verifyToken(token)` → `{ uid }` on a valid signature + unexpired + `typ === "anon"`;
  otherwise `null`.
- `shouldRenew(payload)` → `true` when < 30 days to `exp`.
- Throws at **module load** if `MALIKA_ANON_SECRET` is unset (fail-closed; mirrors the
  `utils/requireProxyUrl.js` pattern).

### b) `backend/src/middleware/malikaIdentity.middleware.js` (new, ~30 lines)
- Reads `x-malika-token`. Valid → set `req.malikaUid = payload.sub`; `next()`.
- Controlled by env flag **`MALIKA_IDENTITY_STRICT`**:
  - **off** (rollout window): missing/invalid token → fall back to bare `x-malika-uid`
    (legacy) and set `req.malikaLegacy = true` for telemetry. No breakage.
  - **on** (post-migration): missing/invalid token → `401 { ok:false, error:"identity_required" }`.

### c) `POST /chat/identity` (new route, public, `chatLimiter`) — handler `createIdentity` in `chat.controller.js`
- Body `{ uid? }`. Behavior:
  1. Valid `x-malika-token` presented → re-issue a fresh token (sliding renewal).
  2. Else `uid` present + well-formed (UUIDv4 or legacy `uid_*`, ≤100 chars) → mint a
     token for **that** uid (legacy adoption; see Security Tradeoff).
  3. Else → generate a new uid + token.
- Returns `{ uid, token, exp }`.
- **Bootstrap exemption (critical):** this endpoint is what *mints* the token, so it must
  be reachable **without** a valid token even in strict mode. It must NOT sit behind
  `malikaIdentityMiddleware` enforcement — otherwise strict mode deadlocks (401s the very
  call that would issue a token). It does its own internal token/uid handling.
- CSRF-exempt (under `/chat`, already in the exempt list) — acceptable: it's a
  bearer-token mint, not a cookie operation.

### d) Owner derivation (edit)
- `getOwnerIdFromReq(req)` (`chat.service.js:93`) reads `req.malikaUid` (set by
  middleware) instead of the raw header. Keep the ≤100-char guard on the resulting uid.
- Same one-line swap for the two direct header reads:
  `chatFeedback.controller.js` (lines 10, 71, 122, 146) and
  `errorLearning.controller.js` (line 16) → read `req.malikaUid`.

### e) Mounting (edit)
- Apply `malikaIdentityMiddleware` **per-route inside the route files**, not at the
  `app.js` mount — so the bootstrap `/chat/identity` route (§c) can be excluded:
  - `chat.routes.js`: guard the data routes (`/threads`, `/threads/:id/messages`,
    `/threads/:id/suggestions`, `POST /threads/:id/stream`); **do not** guard
    `POST /identity`.
  - `chatFeedback.routes.js`: guard all (all endpoints are public anon).
  - error-learning **public flag** endpoint: guard that route specifically. Verify
    `errorLearning.routes.js` internal structure first — if it co-mounts admin
    pattern-management routes, those must retain their existing `authMiddleware +
    requireAdmin` and must NOT receive the anon middleware.
- `app.js` keeps its existing limiter mounts unchanged. **Do not** touch admin routes:
  `/chat/admin` (`:186`) and the autoTune routes under `/error-learning` (`:193`).

### f) Client (`frontend/`, edit)
- `chatHelpers.tsx`: add `getOrCreateMalikaToken()` — on app load ensure a signed token:
  use the stored token if present and not near expiry; otherwise `POST /api/chat/identity`
  with the existing bare uid (legacy adoption) and store `{ uid, token }`. Renew when near
  expiry.
- Header builders add `x-malika-token`: `chatTransport.ts:158`, `ChatPageClient.tsx:289`.
- The ~5 Next proxy routes under `frontend/src/app/api/chat/*` forward the new
  `x-malika-token` header (in addition to the existing `x-malika-uid` during the window).
- New Next proxy route `frontend/src/app/api/chat/identity/route.ts` → backend
  `POST /chat/identity`.

### g) Remove the leak vector (edit/delete)
- Delete the `GET …?text=` SSE handler (`frontend/src/app/api/chat/threads/[id]/stream/route.ts:105-159`)
  and the backend `router.get('/threads/:id/stream', …)` (`chat.routes.js:13`). The
  shipping client uses POST; this removes the path that puts questions/credentials in
  URLs and access logs (audit finding H11). Keep the `POST` stream route.

## Data flow (after rollout)

```
browser (localStorage: uid + token)
  → fetch /api/chat/...            [x-malika-token: <jwt>]
  → Next proxy forwards x-malika-token
  → backend malikaIdentity middleware: verifyToken → req.malikaUid
  → getThreadOwned(req.malikaUid, threadId)   ← a forged bare uid alone now fails
```

## Security tradeoff — legacy adoption (accepted)

An identifier that was historically a non-secret bearer value **cannot** be
retroactively protected for people who already hold it. During the rollout window,
`/chat/identity` will sign a *presented* bare uid, so a **uid that already leaked could
be adopted by whoever holds it during the window**. This is **no worse than the current
state** (the uid is already fully forgeable today) and avoids orphaning ~29K existing
threads.

Two-phase improvement:
- **Phase 1 — window open (~45 days), `STRICT=off`:** new identities fully protected;
  existing users migrate seamlessly; already-leaked uids remain adoptable (= status quo).
- **Phase 2 — `STRICT=on`:** bare uids rejected; only signed tokens accepted; residual
  risk = a leaked *signed* token, bounded by the 180d expiry — and the main leak vector
  (§g) is already removed.

Hard-cutover (fresh identity for everyone, old threads orphaned) was considered and
**rejected** as needlessly destructive.

## Confirmed parameters

| Parameter | Value |
|---|---|
| Token TTL | 180 days |
| Silent renewal threshold | < 30 days remaining |
| Adoption window before `STRICT=on` | ~45 days |
| Adoption tradeoff | Accepted (windowed, not hard cutover) |

## Rollout (no downtime, no thread loss)

1. Set `MALIKA_ANON_SECRET` in prod `backend/.env`. Ship backend in dual-mode
   (`MALIKA_IDENTITY_STRICT=off`) — accepts both token and legacy bare uid. Reload:
   `pm2 reload pds-backend --update-env`.
2. Build + deploy frontend (`cd frontend && npm run build && pm2 reload pds-frontend --update-env`)
   — clients begin minting/sending tokens.
3. Monitor the `req.malikaLegacy` rate. When it is ~0, set `MALIKA_IDENTITY_STRICT=on`
   and reload backend.

## Tests (Jest + Supertest; CI DB env per testing.md)

- **Unit — `anonIdentity.service`:** valid token round-trips; tampered signature →
  `null`; expired → `null`; wrong secret → `null`; `typ !== "anon"` → `null`;
  `shouldRenew` boundary.
- **Integration — IDOR regression (the core proof):**
  - token for user A cannot read user B's thread → `404`.
  - token for user A cannot write (stream/sendMessage) to B's thread → `404`.
  - forged bare uid, no token, `STRICT=on` → `401 identity_required`.
  - valid token → requests scoped to `payload.sub`.
  - `POST /chat/identity`: mint-new, legacy-adopt, and renew paths.
- **Dual-mode:** `STRICT=off` accepts legacy bare uid and sets `req.malikaLegacy`.

## Out of scope (deliberately)

- Approach B (HttpOnly cookie) — future hardening only.
- No changes to the chat pipeline, retrieval, or LLM proxy.
- Other audit findings (streaming buffering C3, Auto-Tune gate C2, etc.) are tracked
  separately.

## Files touched

**Backend (new):** `services/chat/anonIdentity.service.js`,
`middleware/malikaIdentity.middleware.js`,
`services/chat/__tests__/anonIdentity.service.test.js`, an integration test
(e.g. `__tests__/chat.idor.test.js`).
**Backend (edit):** `routes/chat.routes.js` (add `/identity` route + guard data routes),
`controllers/chat.controller.js` (add `createIdentity` handler),
`routes/chatFeedback.routes.js` + `routes/errorLearning.routes.js` (apply guard to public
routes), `services/chat/chat.service.js` (`getOwnerIdFromReq`),
`controllers/chatFeedback.controller.js`, `controllers/errorLearning.controller.js`,
`.env` (add `MALIKA_ANON_SECRET`, `MALIKA_IDENTITY_STRICT`) (+ `.env.example` if present).
`app.js` is unchanged unless the guard is mounted there instead.
**Frontend (new):** `app/api/chat/identity/route.ts`.
**Frontend (edit):** `app/(admin)/chat/chatHelpers.tsx`, `lib/chatTransport.ts`,
`app/(admin)/chat/ChatPageClient.tsx`, the `app/api/chat/*` proxy routes; **delete** the
`GET` handler in `app/api/chat/threads/[id]/stream/route.ts`.
