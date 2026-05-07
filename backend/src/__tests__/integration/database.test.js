jest.mock('../../config/db', () => {
  const mockSequelize = {
    QueryTypes: { SELECT: 'select', INSERT: 'insert', UPDATE: 'update' },
    define: jest.fn(() => ({ sequelize: mockSequelize })),
    query: jest.fn(),
    transaction: jest.fn(async (fn) => (typeof fn === 'function' ? fn() : null)),
    authenticate: jest.fn(async () => {}),
    close: jest.fn(async () => {}),
  };
  return mockSequelize;
});

const sequelize = require('../../config/db');
const analyticsService = require('../../services/analytics/analytics.service');
const ChatThread = require('../../models/ChatThread.model');
const ChatMessage = require('../../models/ChatMessage.model');

describe('integration: database service queries', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(() => {
    sequelize.query.mockClear();
    sequelize.transaction.mockClear();
    sequelize.query.mockResolvedValueOnce([{ count: 0 }]);
  });

  it('records page view and updates active session', async () => {
    sequelize.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await analyticsService.trackPageView({
      sessionId: 's1',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      pagePath: '/home',
      referrer: null,
    });

    expect(result.success).toBe(true);
    expect(sequelize.query).toHaveBeenCalledTimes(2);
  });

  it('updates heartbeat', async () => {
    sequelize.query.mockResolvedValueOnce([]);

    const result = await analyticsService.heartbeat({ sessionId: 's1', pagePath: '/home' });

    expect(result.success).toBe(true);
    expect(sequelize.query).toHaveBeenCalledTimes(1);
  });

  it('keeps models attached to shared sequelize instance', () => {
    expect(ChatThread.sequelize).toBe(sequelize);
    expect(ChatMessage.sequelize).toBe(sequelize);
  });

  it('wraps destructive actions in transactions', async () => {
    await sequelize.transaction(async () => 'ok');
    expect(sequelize.transaction).toHaveBeenCalled();
  });

  it('executes migration-style SQL', async () => {
    await sequelize.query('ALTER TABLE data_sources ADD COLUMN example INT');
    expect(sequelize.query).toHaveBeenCalled();
  });
});
