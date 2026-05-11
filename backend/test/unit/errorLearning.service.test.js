const errorLearningService = require('../../src/services/chat/errorLearning.service');
const ChatMessageFlag = require('../../src/models/ChatMessageFlag.model');
const ChatErrorPattern = require('../../src/models/ChatErrorPattern.model');

jest.mock('../../src/models/ChatMessageFlag.model');
jest.mock('../../src/models/ChatErrorPattern.model');

describe('getStats payload shape (frontend contract)', () => {
  beforeEach(() => {
    ChatMessageFlag.count.mockResolvedValue(30);
    ChatMessageFlag.findAll.mockImplementation((opts) => {
      if (opts?.attributes) {
        // group-by query
        return Promise.resolve([
          { flag_type: 'hallucination', get: () => '10' },
          { flag_type: 'incomplete', get: () => '17' },
        ]);
      }
      return Promise.resolve([]);
    });
    ChatErrorPattern.count.mockImplementation((opts) =>
      Promise.resolve(opts?.where?.is_active ? 5 : 8)
    );
  });

  it('returns flat fields the frontend reads (no nested .stats wrapper)', async () => {
    const res = await errorLearningService.getStats();
    expect(res.totalFlags).toBe(30);
    expect(res.byType).toEqual(expect.objectContaining({ hallucination: 10 }));
    expect(res.byStatus).toBeDefined();
    expect(typeof res.activePatterns).toBe('number');
    expect(typeof res.totalPatterns).toBe('number');
    expect(typeof res.recentFlags).toBe('number');
  });
});
