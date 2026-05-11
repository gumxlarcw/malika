const { Op } = require('sequelize');
const ChatErrorPattern = require('../../../models/ChatErrorPattern.model');

jest.mock('../../../models/ChatErrorPattern.model');

const { retireStalePatterns } = require('../patternRetirement.service');

describe('retireStalePatterns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('finds patterns with last_occurrence older than 90 days AND count<5 AND is_active', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([
      { id: 1, pattern_name: 'old-cold', occurrence_count: 2, update: jest.fn().mockResolvedValue(true) },
      { id: 2, pattern_name: 'never-matched', occurrence_count: 0, update: jest.fn().mockResolvedValue(true) },
    ]);

    const result = await retireStalePatterns();

    expect(ChatErrorPattern.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        is_active: true,
        occurrence_count: expect.objectContaining({ [Op.lt]: 5 }),
      }),
    }));
    expect(result.retired).toBe(2);
    expect(result.names).toEqual(['old-cold', 'never-matched']);
  });

  it('returns zero retired when no stale patterns', async () => {
    ChatErrorPattern.findAll = jest.fn().mockResolvedValue([]);
    const result = await retireStalePatterns();
    expect(result.retired).toBe(0);
    expect(result.names).toEqual([]);
  });
});
