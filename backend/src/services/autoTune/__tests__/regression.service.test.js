const ChatErrorPattern = require('../../../models/ChatErrorPattern.model');
const KnowledgeBase = require('../../../models/KnowledgeBase.model');
const errorLearning = require('../../chat/errorLearning.service');

jest.mock('../../../models/ChatErrorPattern.model');
jest.mock('../../../models/KnowledgeBase.model');
jest.mock('../../chat/errorLearning.service');

const { runRegression } = require('../regression.service');

describe('runRegression', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns ok=true when every active pattern fires on its canonical_query', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([
      { id: 1, pattern_name: 'P1', canonical_query: 'tpt 2024 halmahera', fix_type: 'add_to_prompt', fix_content: 'FIX_ONE_TEXT' },
      { id: 2, pattern_name: 'P2', canonical_query: 'inflasi ternate', fix_type: 'add_to_prompt', fix_content: 'FIX_TWO_TEXT' },
    ]);
    KnowledgeBase.findAll = jest.fn().mockResolvedValue([]);
    errorLearning.getPromptFixes = jest.fn().mockImplementation((q) => {
      if (q === 'tpt 2024 halmahera') return Promise.resolve(['FIX_ONE_TEXT']);
      if (q === 'inflasi ternate') return Promise.resolve(['FIX_TWO_TEXT']);
      return Promise.resolve([]);
    });
    errorLearning.checkQueryPattern = jest.fn().mockResolvedValue(null);

    const r = await runRegression();
    expect(r.ok).toBe(true);
    expect(r.patternChecks).toHaveLength(2);
    expect(r.patternChecks.every(c => c.passed)).toBe(true);
  });

  it('returns ok=false when a pattern no longer fires on its canonical_query', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([
      { id: 1, pattern_name: 'P_broken', canonical_query: 'q1', fix_type: 'add_to_prompt', fix_content: 'BROKEN_FIX' },
    ]);
    KnowledgeBase.findAll = jest.fn().mockResolvedValue([]);
    errorLearning.getPromptFixes = jest.fn().mockResolvedValue([]);   // empty — broken
    errorLearning.checkQueryPattern = jest.fn().mockResolvedValue(null);

    const r = await runRegression();
    expect(r.ok).toBe(false);
    expect(r.patternChecks[0].passed).toBe(false);
    expect(r.patternChecks[0].reason).toBeTruthy();
  });

  it('skips patterns without canonical_query and marks them passed with a warning reason', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([
      { id: 1, pattern_name: 'P_legacy', canonical_query: null, fix_content: 'X' },
    ]);
    KnowledgeBase.findAll = jest.fn().mockResolvedValue([]);
    errorLearning.getPromptFixes = jest.fn();
    errorLearning.checkQueryPattern = jest.fn();

    const r = await runRegression();
    expect(r.patternChecks[0].passed).toBe(true);
    expect(r.patternChecks[0].reason).toMatch(/no canonical_query/i);
    expect(errorLearning.getPromptFixes).not.toHaveBeenCalled();
  });

  it('returns ok=true when special_handling pattern surfaces via [SPECIAL HANDLING] marker', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([
      { id: 3, pattern_name: 'P_special', canonical_query: 'irrelevant query', fix_type: 'special_handling', fix_content: 'redirect text' },
    ]);
    KnowledgeBase.findAll = jest.fn().mockResolvedValue([]);
    errorLearning.getPromptFixes = jest.fn().mockResolvedValue(['[SPECIAL HANDLING — P_special]\nredirect text']);
    errorLearning.checkQueryPattern = jest.fn().mockResolvedValue(null);

    const r = await runRegression();
    expect(r.ok).toBe(true);
    expect(r.patternChecks[0].passed).toBe(true);
  });
});
