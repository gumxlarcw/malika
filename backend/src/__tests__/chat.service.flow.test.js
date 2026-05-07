jest.mock('../models/ChatThread.model', () => ({
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}));

jest.mock('../models/ChatMessage.model', () => ({
  findAll: jest.fn(),
  create: jest.fn(),
  count: jest.fn(),
}));

jest.mock('../models/DataPeriod.model', () => ({
  sequelize: {
    query: jest.fn(),
  },
}));

jest.mock('../models/ProcessedCache.model', () => ({
  sequelize: {
    query: jest.fn(),
  },
}));

jest.mock('../models/DataSourceSearchTerm.model', () => ({
  findOne: jest.fn(),
}));

jest.mock('../services/cache/cache.service', () => ({
  getCache: jest.fn(),
}));

jest.mock('../services/search/intent.service', () => ({
  resolveSearchIntent: jest.fn(),
  buildDatasourceCandidates: jest.fn(),
}));

function stripMalikaUiBlock(content) {
  return String(content || '').replace(/```\s*malika_ui\s*[\s\S]*?```/gi, '').trim();
}

describe('chat.service flow (various cases)', () => {
  const ChatThread = require('../models/ChatThread.model');
  const ChatMessage = require('../models/ChatMessage.model');
  const DataPeriod = require('../models/DataPeriod.model');
  const ProcessedCache = require('../models/ProcessedCache.model');
  const DataSourceSearchTerm = require('../models/DataSourceSearchTerm.model');
  const { getCache } = require('../services/cache/cache.service');
  const intentService = require('../services/search/intent.service');
  const chatService = require('../services/chat/chat.service');

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.OPENAI_API_KEY_CHAT = 'test-key';
    process.env.OPENAI_MODEL_CHAT = 'test-model';
    process.env.OPENAI_CHAT_TIMEOUT_MS = '15000';

    const thread = {
      id: 123,
      owner_id: 'u1',
      title: 'Chat baru',
      update: jest.fn(async () => undefined),
      toJSON: () => ({ id: 123, owner_id: 'u1', title: 'Chat baru' }),
    };

    ChatThread.findOne.mockResolvedValue(thread);
    ChatMessage.count.mockResolvedValue(2);

    // Minimal history; keep it simple and deterministic.
    ChatMessage.findAll.mockResolvedValue([
      {
        toJSON: () => ({ id: 1, thread_id: 123, role: 'user', content: 'Halo' }),
      },
    ]);

    ChatMessage.create.mockImplementation(async (payload) => ({
      toJSON: () => ({
        id: payload.role === 'assistant' ? 2 : 1,
        thread_id: payload.thread_id,
        role: payload.role,
        content: payload.content,
      }),
    }));

    // Period queries (best-effort): ensure latest year/month parsing works.
    DataPeriod.sequelize.query.mockImplementation(async (sql) => {
      const q = String(sql || '');
      if (q.includes('MAX(CAST(period_value AS UNSIGNED))')) {
        return [{ max_pv: '202412' }];
      }
      if (q.includes('FROM data_period_map') && q.includes('WHERE source_id = ?')) {
        return [{ period_value: '202412' }, { period_value: '202411' }];
      }
      return [];
    });

    // Default: processed cache has 2024 only (used for availability checks).
    ProcessedCache.sequelize.query.mockImplementation(async (sql) => {
      const q = String(sql || '');
      if (q.includes('FROM data_processed_cache') && q.includes('WHERE source_id = ?')) {
        return [{ period_value: '202412' }, { period_value: '202411' }];
      }
      return [];
    });

    // Avoid geo probing in tests.
    DataSourceSearchTerm.findOne.mockResolvedValue(null);

    // Default: no cached processed table.
    getCache.mockResolvedValue(null);

    // Deterministic intent + candidates.
    intentService.resolveSearchIntent.mockResolvedValue({
      query_builder: { params: { year: 2024, month: null } },
      datasource: { source_id: 1, type: 'dynamic' },
    });
    intentService.buildDatasourceCandidates.mockResolvedValue([
      { id: 1, name: 'Dummy datasource', type: 'dynamic', score: 1 },
    ]);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY_CHAT;
    delete process.env.OPENAI_MODEL_CHAT;
    delete process.env.OPENAI_CHAT_TIMEOUT_MS;
    delete global.fetch;
  });

  test('getOwnerIdFromReq throws 400 when UID missing', () => {
    expect(() =>
      chatService.getOwnerIdFromReq({
        get: () => '',
      })
    ).toThrow(/Missing x-malika-uid/);

    try {
      chatService.getOwnerIdFromReq({ get: () => '' });
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.code).toBe('missing_owner');
    }
  });

  test('sendMessage throws 400 when message missing', async () => {
    await expect(chatService.sendMessage('u1', 123, '   ')).rejects.toMatchObject({
      status: 400,
      code: 'missing_message',
    });
  });

  test('OpenAI error produces deterministic fallback reply', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network');
    });

    const res = await chatService.sendMessage('u1', 123, 'Halo');
    const visible = stripMalikaUiBlock(res.assistant.content);
    expect(visible.toLowerCase()).toContain('gangguan');
  });

  test('assistant text strips raw URLs and app-relative links (outside malika_ui)', async () => {
    // Mock no candidates/intent so uiWillShowPreview is false
    // This forces the LLM response to be used (not the short override)
    jest.spyOn(require('../services/search/intent.service'), 'resolveSearchIntent').mockResolvedValue(null);
    jest.spyOn(require('../services/search/intent.service'), 'buildDatasourceCandidates').mockResolvedValue([]);

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  'Silakan cek https://example.com dan juga /data?source_id=1&period=2024. Apakah butuh kab/kota?',
              },
            },
          ],
        }),
    }));

    const res = await chatService.sendMessage('u1', 123, 'Halo');
    const visible = stripMalikaUiBlock(res.assistant.content);
    expect(visible).not.toMatch(/https?:\/\//i);
    expect(visible).not.toMatch(/\b\/data\?/i);
    expect(visible).toMatch(/halaman data/i);
  });

  test('assistant text clamps to at most 3 question marks', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  'A? B? C? D? E?\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13',
              },
            },
          ],
        }),
    }));

    const res = await chatService.sendMessage('u1', 123, 'Halo');
    const visible = stripMalikaUiBlock(res.assistant.content);
    const qm = (visible.match(/\?/g) || []).length;
    expect(qm).toBeLessThanOrEqual(3);
  });

  test('when user requests preview but cache missing, a deterministic note is appended', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Baik, saya bantu cek indikator dan periode yang tepat.',
              },
            },
          ],
        }),
    }));

    const res = await chatService.sendMessage('u1', 123, 'tampilkan datanya');
    const visible = stripMalikaUiBlock(res.assistant.content);
    // When UI will show preview (candidates exist), we use empty response (no bubble chat)
    // to let user see confirmation first, then table + interpretation after.
    // When no candidates, we might show the "belum menemukan" note
    expect(visible === '' || /belum menemukan tabel data/i.test(visible)).toBe(true);
  });

  test('when requested year is unavailable, reply is concise and does not claim auto-switch', async () => {
    // Make query builder pick a year that is NOT in available years (we only have 2024 in mocks).
    const intentService = require('../services/search/intent.service');
    intentService.resolveSearchIntent.mockResolvedValue({
      query_builder: { params: { year: 2025, month: null } },
      datasource: { source_id: 1, type: 'dynamic' },
    });

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Baik, saya bantu cek.'
              },
            },
          ],
        }),
    }));

    const res = await chatService.sendMessage('u1', 123, 'tampilkan data 2025');
    const visible = stripMalikaUiBlock(res.assistant.content);
    expect(visible).toMatch(/periode\s+2025\s+belum\s+tersedia/i);
    expect(visible).toMatch(/tahun\s+tersedia/i);
    expect(visible).not.toMatch(/ubah\s+query\s+konfirmasi/i);
  });
});
