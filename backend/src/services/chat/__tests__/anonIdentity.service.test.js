// MALIKA_ANON_SECRET is provided by jest.setup.env.js.
const jwt = require('jsonwebtoken');
const { issueToken, verifyToken, shouldRenew } = require('../anonIdentity.service');

const SECRET = process.env.MALIKA_ANON_SECRET;

describe('anonIdentity.service', () => {
  it('round-trips a valid token back to its uid', () => {
    const token = issueToken('uid-abc');
    const payload = verifyToken(token);
    expect(payload).toMatchObject({ sub: 'uid-abc', typ: 'anon' });
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('rejects a tampered signature', () => {
    const token = issueToken('uid-abc');
    const tampered = token.slice(0, -2) + (token.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(verifyToken(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const foreign = jwt.sign({ sub: 'uid-x', typ: 'anon' }, 'some-other-secret', { algorithm: 'HS256', expiresIn: 3600 });
    expect(verifyToken(foreign)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ sub: 'uid-x', typ: 'anon' }, SECRET, { algorithm: 'HS256', expiresIn: -10 });
    expect(verifyToken(expired)).toBeNull();
  });

  it('rejects a token whose typ is not "anon" (no admin-token crossover)', () => {
    const wrongType = jwt.sign({ sub: 'uid-x', typ: 'admin' }, SECRET, { algorithm: 'HS256', expiresIn: 3600 });
    expect(verifyToken(wrongType)).toBeNull();
  });

  it('returns null for empty / garbage input instead of throwing', () => {
    expect(verifyToken('')).toBeNull();
    expect(verifyToken(null)).toBeNull();
    expect(verifyToken('not.a.jwt')).toBeNull();
  });

  it('shouldRenew is true near expiry, false when fresh', () => {
    const fresh = verifyToken(issueToken('uid-abc'));
    expect(shouldRenew(fresh)).toBe(false);
    const nearExpiry = { exp: Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60 }; // 5 days left
    expect(shouldRenew(nearExpiry)).toBe(true);
  });
});
