jest.mock('../models/AdminAuditLog.model', () => ({
  create: jest.fn().mockResolvedValue({}),
}));

const AdminAuditLog = require('../models/AdminAuditLog.model');
const { createAuditLogMiddleware } = require('../middleware/auditLog.middleware');

function fakeReqRes({ method = 'GET' } = {}) {
  const handlers = {};
  const req = {
    method,
    user: { id: 1, email: 'admin@bps.go.id', role: 'admin' },
    body: {},
    query: {},
    params: {},
    originalUrl: '/x',
    ip: '127.0.0.1',
    get: () => null,
  };
  const res = {
    statusCode: 200,
    on: (evt, fn) => { handlers[evt] = fn; },
  };
  return { req, res, fire: async () => handlers.finish && handlers.finish() };
}

describe('createAuditLogMiddleware', () => {
  beforeEach(() => AdminAuditLog.create.mockClear());

  test('default: skips GET/HEAD/OPTIONS', async () => {
    const mw = createAuditLogMiddleware({ resource: 'r' });
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const { req, res, fire } = fakeReqRes({ method });
      mw(req, res, () => {});
      await fire();
    }
    expect(AdminAuditLog.create).not.toHaveBeenCalled();
  });

  test('default: logs POST/PUT/PATCH/DELETE', async () => {
    const mw = createAuditLogMiddleware({ resource: 'r' });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const { req, res, fire } = fakeReqRes({ method });
      mw(req, res, () => {});
      await fire();
    }
    expect(AdminAuditLog.create).toHaveBeenCalledTimes(4);
  });

  test('logReads=true opt-in: logs GET too', async () => {
    const mw = createAuditLogMiddleware({ resource: 'r', logReads: true });
    const { req, res, fire } = fakeReqRes({ method: 'GET' });
    mw(req, res, () => {});
    await fire();
    expect(AdminAuditLog.create).toHaveBeenCalledTimes(1);
  });

  test('no req.user: never logs regardless of method', async () => {
    const mw = createAuditLogMiddleware({ resource: 'r', logReads: true });
    const { req, res, fire } = fakeReqRes({ method: 'POST' });
    req.user = null;
    mw(req, res, () => {});
    await fire();
    expect(AdminAuditLog.create).not.toHaveBeenCalled();
  });
});
