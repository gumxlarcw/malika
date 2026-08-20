jest.mock('../../../models/ChatThread.model', () => ({
  findOne: jest.fn(),
  destroy: jest.fn(),
  sequelize: { transaction: jest.fn(async (cb) => cb('TX')) },
}));
jest.mock('../../../models/ChatMessage.model', () => ({ destroy: jest.fn() }));
jest.mock('../../../models/ChatMessageFlag.model', () => ({ destroy: jest.fn() }));
jest.mock('../../../models/ChatFeedback.model', () => ({ destroy: jest.fn() }));

// chat.service pulls in a large dependency graph; stub the heavy ones so the
// unit under test (deleteThread) loads in isolation.
jest.mock('../../search/intent.service', () => ({ resolveSearchIntent: jest.fn(), buildDatasourceCandidates: jest.fn() }));
jest.mock('../streaming/openaiClient', () => ({ chat: jest.fn() }));

const ChatThread = require('../../../models/ChatThread.model');
const ChatMessage = require('../../../models/ChatMessage.model');
const ChatMessageFlag = require('../../../models/ChatMessageFlag.model');
const ChatFeedback = require('../../../models/ChatFeedback.model');
const { deleteThread } = require('../chat.service');

describe('chat.service deleteThread', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cascades messages, flags and feedback then deletes the owned thread', async () => {
    ChatThread.findOne.mockResolvedValue({ id: 42, owner_id: 'owner-1' });

    const result = await deleteThread('owner-1', 42);

    expect(result).toEqual({ ok: true, id: 42 });
    // Ownership was checked with both id AND owner_id (no cross-user delete).
    expect(ChatThread.findOne).toHaveBeenCalledWith({ where: { id: 42, owner_id: 'owner-1' } });
    expect(ChatMessageFlag.destroy).toHaveBeenCalledWith({ where: { thread_id: 42 }, transaction: 'TX' });
    expect(ChatFeedback.destroy).toHaveBeenCalledWith({ where: { thread_id: 42 }, transaction: 'TX' });
    expect(ChatMessage.destroy).toHaveBeenCalledWith({ where: { thread_id: 42 }, transaction: 'TX' });
    expect(ChatThread.destroy).toHaveBeenCalledWith({ where: { id: 42, owner_id: 'owner-1' }, transaction: 'TX' });
  });

  it('refuses to delete a thread the caller does not own (404, no destroys)', async () => {
    ChatThread.findOne.mockResolvedValue(null); // not owned / missing

    await expect(deleteThread('attacker', 42)).rejects.toMatchObject({ code: 'thread_not_found', status: 404 });

    expect(ChatThread.destroy).not.toHaveBeenCalled();
    expect(ChatMessage.destroy).not.toHaveBeenCalled();
    expect(ChatMessageFlag.destroy).not.toHaveBeenCalled();
    expect(ChatFeedback.destroy).not.toHaveBeenCalled();
  });
});
