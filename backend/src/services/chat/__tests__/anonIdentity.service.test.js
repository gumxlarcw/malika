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

  it('shouldRenew is true inside the 30-day window and false outside it', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(svc.shouldRenew({ exp: nowSec + 29 * 24 * 3600 })).toBe(true);
    expect(svc.shouldRenew({ exp: nowSec + 31 * 24 * 3600 })).toBe(false);
    expect(svc.shouldRenew({})).toBe(false);
    expect(svc.shouldRenew(null)).toBe(false);
  });
});
