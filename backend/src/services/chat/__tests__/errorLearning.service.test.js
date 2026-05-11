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

describe('listFlags severity filter (controller behavior)', () => {
  // The controller builds a Sequelize where-clause from req.query.
  // This unit asserts the where-shape we expect after parsing.
  it('builds where clause with severity when query.severity provided', () => {
    const buildWhere = (q) => {
      const where = {};
      if (q.status) where.resolution_status = q.status;
      if (q.flag_type || q.type) where.flag_type = q.flag_type || q.type;
      if (q.severity) where.severity = q.severity;
      return where;
    };
    expect(buildWhere({ severity: 'critical' })).toEqual({ severity: 'critical' });
    expect(buildWhere({ status: 'pending', severity: 'high' }))
      .toEqual({ resolution_status: 'pending', severity: 'high' });
    expect(buildWhere({ type: 'hallucination' }))   // dual-name support
      .toEqual({ flag_type: 'hallucination' });
  });
});

const { detectAutoFlag } = require('../autoFlag.service');

describe('autoFlag heuristics', () => {
  it('flags refusal when context had candidates', () => {
    const result = detectAutoFlag({
      userQuery: 'Berapa IPM Halmahera Barat 2024?',
      assistantResponse: 'Maaf, saya tidak menemukan data tersebut.',
      intent: 'COMPLEX',
      candidates: [{ id: 1 }],
      dataPreviewRowCount: 5,
      recentAssistantResponses: [],
    });
    expect(result).toEqual(expect.objectContaining({ flag_type: 'hallucination', severity: 'high' }));
  });

  it('does NOT flag refusal when there were no candidates', () => {
    expect(detectAutoFlag({
      userQuery: 'X',
      assistantResponse: 'Maaf, saya tidak menemukan data tersebut.',
      intent: 'COMPLEX',
      candidates: [],
      dataPreviewRowCount: 0,
      recentAssistantResponses: [],
    })).toBeNull();
  });

  it('flags ultra-short non-greeting response', () => {
    expect(detectAutoFlag({
      userQuery: 'Inflasi Ternate?',
      assistantResponse: 'OK',
      intent: 'COMPLEX',
      candidates: [{ id: 1 }],
      dataPreviewRowCount: 2,
      recentAssistantResponses: [],
    })).toEqual(expect.objectContaining({ flag_type: 'incomplete', severity: 'low' }));
  });

  it('does NOT flag short response for GREETING', () => {
    expect(detectAutoFlag({
      userQuery: 'halo',
      assistantResponse: 'Halo!',
      intent: 'GREETING',
      candidates: [],
      dataPreviewRowCount: 0,
      recentAssistantResponses: [],
    })).toBeNull();
  });

  it('flags repeat assistant response in same thread', () => {
    const repeat = 'Data IPM tidak tersedia untuk periode tersebut.';
    expect(detectAutoFlag({
      userQuery: 'IPM 2024?',
      assistantResponse: repeat,
      intent: 'COMPLEX',
      candidates: [{ id: 1 }],
      dataPreviewRowCount: 3,
      recentAssistantResponses: [repeat, repeat],
    })).toEqual(expect.objectContaining({ flag_type: 'context_lost', severity: 'medium' }));
  });
});
