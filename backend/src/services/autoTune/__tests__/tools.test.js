const ChatMessageFlag = require('../../../models/ChatMessageFlag.model');
const ChatMessage = require('../../../models/ChatMessage.model');
const ChatErrorPattern = require('../../../models/ChatErrorPattern.model');
const KnowledgeBase = require('../../../models/KnowledgeBase.model');
const sequelize = require('../../../config/db');
const regression = require('../regression.service');

jest.mock('../../../models/ChatMessageFlag.model', () => ({ findByPk: jest.fn(), findAll: jest.fn() }));
jest.mock('../../../models/ChatMessage.model', () => ({ findByPk: jest.fn(), findAll: jest.fn() }));
jest.mock('../../../models/ChatErrorPattern.model', () => ({
  findAll: jest.fn(), create: jest.fn(), destroy: jest.fn(),
}));
jest.mock('../../../models/KnowledgeBase.model', () => ({
  findAll: jest.fn(), create: jest.fn(), destroy: jest.fn(),
}));
jest.mock('../../../config/db', () => ({
  query: jest.fn(),
}));
jest.mock('../regression.service', () => ({ runRegression: jest.fn() }));

const { createToolset } = require('../tools');

describe('Auto Tune tools', () => {
  let jobContext;

  beforeEach(() => {
    jest.clearAllMocks();
    jobContext = { jobId: 'test-job', flagId: 99, stagedPatternIds: [], stagedKbIds: [], log: [] };
  });

  it('read_flag returns flag + recent thread messages', async () => {
    ChatMessageFlag.findByPk = jest.fn().mockResolvedValue({
      id: 99, flag_type: 'hallucination', severity: 'high',
      user_query: 'Q', assistant_response: 'A',
      thread_id: 5, context_snapshot: { foo: 'bar' },
    });
    ChatMessage.findAll = jest.fn().mockResolvedValue([
      { role: 'user', content: 'hi', id: 1, created_at: new Date() },
    ]);
    const tools = createToolset(jobContext);
    const out = await tools.read_flag({});
    expect(out.flag).toEqual(expect.objectContaining({ id: 99, flag_type: 'hallucination' }));
    expect(out.thread_messages).toBeInstanceOf(Array);
    expect(jobContext.log).toHaveLength(1);
  });

  it('propose_pattern stages with is_active=true and tracks id', async () => {
    ChatErrorPattern.create = jest.fn().mockResolvedValue({ id: 555 });
    const tools = createToolset(jobContext);
    const out = await tools.propose_pattern({
      name: 'T', type: 'query_pattern', keywords: ['x'],
      fix_type: 'add_to_prompt', fix_content: 'FIX', canonical_query: 'cq',
    });
    expect(out.ok).toBe(true);
    expect(out.patternId).toBe(555);
    expect(jobContext.stagedPatternIds).toEqual([555]);
    expect(ChatErrorPattern.create).toHaveBeenCalledWith(expect.objectContaining({ is_active: true, canonical_query: 'cq' }));
  });

  it('run_regression_and_commit rolls back staged patterns on regression failure', async () => {
    jobContext.stagedPatternIds = [101, 102];
    ChatErrorPattern.destroy = jest.fn().mockResolvedValue(1);
    sequelize.query.mockResolvedValue([[]]);   // for KB rollback queries (no KB staged here)
    KnowledgeBase.destroy = jest.fn().mockResolvedValue(0);
    regression.runRegression = jest.fn().mockResolvedValue({
      ok: false,
      patternChecks: [{ patternId: 7, passed: false, reason: 'broke' }],
      kbChecks: [],
    });

    const tools = createToolset(jobContext);
    const out = await tools.run_regression_and_commit({});

    expect(out.ok).toBe(false);
    expect(out.committed).toBe(false);
    expect(ChatErrorPattern.destroy).toHaveBeenCalledWith({ where: { id: 101 } });
    expect(ChatErrorPattern.destroy).toHaveBeenCalledWith({ where: { id: 102 } });
    expect(jobContext.stagedPatternIds).toEqual([]);
  });

  it('run_regression_and_commit returns committed=true on pass and leaves stagings in place', async () => {
    jobContext.stagedPatternIds = [201];
    ChatErrorPattern.destroy = jest.fn();
    regression.runRegression = jest.fn().mockResolvedValue({
      ok: true,
      patternChecks: [{ passed: true }],
      kbChecks: [],
    });

    const tools = createToolset(jobContext);
    const out = await tools.run_regression_and_commit({});

    expect(out.ok).toBe(true);
    expect(out.committed).toBe(true);
    expect(ChatErrorPattern.destroy).not.toHaveBeenCalled();
    expect(jobContext.stagedPatternIds).toEqual([201]);   // NOT cleared on commit
  });

  it('abandon rolls back all staged changes and logs reason', async () => {
    jobContext.stagedPatternIds = [301];
    jobContext.stagedKbIds = [401];
    ChatErrorPattern.destroy = jest.fn().mockResolvedValue(1);
    KnowledgeBase.destroy = jest.fn().mockResolvedValue(1);
    sequelize.query.mockResolvedValue([[]]);

    const tools = createToolset(jobContext);
    const out = await tools.abandon({ reason: 'no clean fix' });

    expect(out.abandoned).toBe(true);
    expect(out.reason).toBe('no clean fix');
    expect(ChatErrorPattern.destroy).toHaveBeenCalledWith({ where: { id: 301 } });
    expect(KnowledgeBase.destroy).toHaveBeenCalledWith({ where: { id: 401 } });
    expect(jobContext.stagedPatternIds).toEqual([]);
    expect(jobContext.stagedKbIds).toEqual([]);
  });
});
