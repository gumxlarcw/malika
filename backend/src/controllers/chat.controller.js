const chatService = require('../services/chat/chat.service');
const streamingService = require('../services/chat/streaming.service');
const threadSuggestionsService = require('../services/chat/threadSuggestions.service');

const DEFAULT_SUGGESTIONS = [
  'Data penduduk',
  'Data kemiskinan',
  'Data inflasi',
  'Data pengangguran',
  'Data PDRB',
];

async function listThreads(req, res, next) {
  try {
    const ownerId = chatService.getOwnerIdFromReq(req);
    const threads = await chatService.listThreads(ownerId);
    res.json({ ok: true, threads });
  } catch (e) {
    next(e);
  }
}

async function createThread(req, res, next) {
  try {
    const ownerId = chatService.getOwnerIdFromReq(req);
    const thread = await chatService.createThread(ownerId, req.body?.title);
    res.status(201).json({ ok: true, thread });
  } catch (e) {
    next(e);
  }
}

async function listMessages(req, res, next) {
  try {
    const ownerId = chatService.getOwnerIdFromReq(req);
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_thread_id' });
    }

    const messages = await chatService.listMessages(ownerId, threadId);
    res.json({ ok: true, messages });
  } catch (e) {
    next(e);
  }
}

async function sendMessage(req, res, next) {
  try {
    const ownerId = chatService.getOwnerIdFromReq(req);
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_thread_id' });
    }

    const payload = await chatService.sendMessage(ownerId, threadId, req.body?.text);
    res.status(201).json({ ok: true, ...payload });
  } catch (e) {
    next(e);
  }
}

/**
 * Stream chat response using Server-Sent Events (SSE)
 * GET /threads/:id/stream?text=...
 */
async function streamMessage(req, res, next) {
  try {
    const ownerId = chatService.getOwnerIdFromReq(req);
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_thread_id' });
    }

    const userMessage = String(req.query.text || req.body?.text || '').trim();
    if (!userMessage) {
      return res.status(400).json({ ok: false, error: 'missing_text' });
    }

    // Frontend may send `{ text, model }`. Validate against the models the proxy
    // advertises; anything else is dropped so the downstream tier policy picks.
    // (The running proxy ignores body.model today — this is still wired in so
    // callers with their own policy can override per request.)
    const ALLOWED_OVERRIDES = new Set([
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'gemini-3-flash-preview',
      'gemini-3-pro-preview',
    ]);
    const rawModel = req.body?.model;
    const modelOverride = (typeof rawModel === 'string' && ALLOWED_OVERRIDES.has(rawModel))
      ? rawModel
      : undefined;

    // Use streaming service
    await streamingService.streamChatResponse({
      res,
      threadId,
      userMessage,
      ownerId,
      modelOverride,
    });
  } catch (e) {
    // If headers already sent, just end the response
    if (res.headersSent) {
      res.end();
    } else {
      next(e);
    }
  }
}

/**
 * Get context-aware suggestion chips for a thread.
 * GET /chat/threads/:id/suggestions
 *
 * Always returns 200 with `{ ok: true, suggestions: [...] }` — falls back
 * to default chips when LLM generation fails or is disabled, so the UI
 * never has to handle errors.
 */
async function getThreadSuggestions(req, res, next) {
  try {
    const ownerId = chatService.getOwnerIdFromReq(req);
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_thread_id' });
    }

    const generated = await threadSuggestionsService.generateForThread(threadId, ownerId);
    const suggestions = Array.isArray(generated) && generated.length > 0
      ? generated
      : DEFAULT_SUGGESTIONS;

    res.json({ ok: true, suggestions });
  } catch (e) {
    // Never propagate — endpoint is best-effort
    res.json({ ok: true, suggestions: DEFAULT_SUGGESTIONS });
  }
}

module.exports = {
  listThreads,
  createThread,
  listMessages,
  sendMessage,
  streamMessage,
  getThreadSuggestions,
};
