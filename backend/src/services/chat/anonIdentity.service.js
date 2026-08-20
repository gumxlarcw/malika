/**
 * Anonymous Identity Service
 * ==========================
 * Issues and verifies HMAC-signed tokens that wrap the existing anonymous
 * `x-malika-uid` (a localStorage UUIDv4) so the backend can trust a uid only
 * when it arrives with a server-issued signature the client cannot forge.
 *
 * Design: docs/superpowers/specs/2026-05-29-chat-idor-auth-design.md (Approach A).
 *
 * Token: JWT (HS256), payload { sub: <uid>, typ: "anon", iat, exp }, 180d TTL.
 * Secret: dedicated MALIKA_ANON_SECRET — deliberately SEPARATE from the admin
 * JWT_SECRET so an anon token can never be accepted by authMiddleware (and an
 * admin token can never pass here).
 *
 * Fail-closed: throws at module load when MALIKA_ANON_SECRET is unset, mirroring
 * the utils/requireProxyUrl.js pattern — a missing secret must stop the process,
 * not silently sign with a weak/empty key.
 */

const jwt = require('jsonwebtoken');

const SECRET = process.env.MALIKA_ANON_SECRET;
if (!SECRET) {
  throw new Error(
    'MALIKA_ANON_SECRET is not set — anonymous identity tokens cannot be signed. ' +
    'Set it in backend/.env (a long random string, separate from JWT_SECRET).'
  );
}
// Defense-in-depth: the whole point of a dedicated secret is that an anon token
// can NEVER be valid under the admin secret (and vice-versa). Reusing JWT_SECRET
// would silently collapse that separation, so refuse to start.
if (process.env.JWT_SECRET && SECRET === process.env.JWT_SECRET) {
  throw new Error(
    'MALIKA_ANON_SECRET must differ from JWT_SECRET — anon and admin tokens must ' +
    'never be cross-valid. Set a separate random value.'
  );
}

const TTL_DAYS = 180;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;
const RENEW_THRESHOLD_SECONDS = 30 * 24 * 60 * 60; // renew when < 30 days remain

/**
 * Sign a token for the given uid.
 * @param {string} uid
 * @returns {string} signed JWT
 */
function issueToken(uid) {
  if (!uid || typeof uid !== 'string') {
    throw new Error('issueToken requires a non-empty uid string');
  }
  return jwt.sign({ sub: uid, typ: 'anon' }, SECRET, {
    algorithm: 'HS256',
    expiresIn: TTL_SECONDS,
  });
}

/**
 * Verify a token. Returns the decoded payload on a valid signature, unexpired,
 * with typ === "anon"; otherwise null (never throws).
 * @param {string} token
 * @returns {{ sub: string, typ: string, iat: number, exp: number } | null}
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    if (!payload || payload.typ !== 'anon' || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * True when the token is within the sliding-renewal window (< 30 days to exp).
 * @param {{ exp?: number }} payload
 * @returns {boolean}
 */
function shouldRenew(payload) {
  if (!payload || !payload.exp) return false;
  const secondsLeft = payload.exp - Math.floor(Date.now() / 1000);
  return secondsLeft < RENEW_THRESHOLD_SECONDS;
}

module.exports = { issueToken, verifyToken, shouldRenew, TTL_DAYS };
