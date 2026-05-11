const errorLearningService = require('../errorLearning.service');
const ChatMessageFlag = require('../../../models/ChatMessageFlag.model');
const ChatErrorPattern = require('../../../models/ChatErrorPattern.model');

jest.mock('../../../models/ChatMessageFlag.model');
jest.mock('../../../models/ChatErrorPattern.model');

describe('getStats payload shape (frontend contract)', () => {
  beforeEach(() => {
    // Distinguish the three count calls by their where-clause:
    // - total (no where)
    // - pending (resolution_status='pending')
    // - 7-day window (created_at >= ...)
    ChatMessageFlag.count.mockImplementation((opts) => {
      if (!opts?.where) return Promise.resolve(30);
      if (opts.where.resolution_status === 'pending') return Promise.resolve(25);
      if (opts.where.created_at) return Promise.resolve(7);
      return Promise.resolve(0);
    });

    // Distinguish the three findAll group-by calls by their attribute column:
    ChatMessageFlag.findAll.mockImplementation((opts) => {
      const col = opts?.attributes?.[0];
      if (col === 'flag_type') {
        return Promise.resolve([
          { flag_type: 'hallucination', get: () => '10' },
          { flag_type: 'incomplete', get: () => '17' },
        ]);
      }
      if (col === 'resolution_status') {
        return Promise.resolve([
          { resolution_status: 'pending', get: () => '25' },
          { resolution_status: 'fixed', get: () => '5' },
        ]);
      }
      if (col === 'severity') {
        return Promise.resolve([
          { severity: 'low', get: () => '15' },
          { severity: 'medium', get: () => '12' },
          { severity: 'high', get: () => '3' },
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
    expect(res.pendingFlags).toBe(25);
    expect(res.recentFlags).toBe(7);                  // proves the 7-day where-clause fired
    expect(res.totalPatterns).toBe(8);
    expect(res.activePatterns).toBe(5);
    expect(res.byType).toEqual({ hallucination: 10, incomplete: 17 });
    expect(res.byStatus).toEqual({ pending: 25, fixed: 5 });    // proves grouped by resolution_status
    expect(res.bySeverity).toEqual({ low: 15, medium: 12, high: 3 }); // proves grouped by severity
  });

  it('does not return the legacy {ok, stats:{}} wrapper', async () => {
    const res = await errorLearningService.getStats();
    expect(res.ok).toBeUndefined();
    expect(res.stats).toBeUndefined();
  });
});
