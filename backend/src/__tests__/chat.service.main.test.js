jest.mock('../models/ChatThread.model', () => ({
  findAll: jest.fn(),
}));

const ChatThread = require('../models/ChatThread.model');
const { getOwnerIdFromReq, listThreads } = require('../services/chat/chat.service');

function createReq(headers = {}) {
  return {
    get: (key) => headers[key],
  };
}

describe('chat.service main functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extracts owner id from request headers', () => {
    const req = createReq({ 'x-malika-uid': 'user-123' });
    expect(getOwnerIdFromReq(req)).toBe('user-123');
  });

  it('throws when owner id is missing', () => {
    const req = createReq({});
    expect(() => getOwnerIdFromReq(req)).toThrow('Missing x-malika-uid header');
  });

  it('lists threads for owner', async () => {
    ChatThread.findAll.mockResolvedValue([{ toJSON: () => ({ id: 1 }) }]);

    const result = await listThreads('owner-1');

    expect(result).toEqual([{ id: 1 }]);
    expect(ChatThread.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { owner_id: 'owner-1' },
      })
    );
  });
});
