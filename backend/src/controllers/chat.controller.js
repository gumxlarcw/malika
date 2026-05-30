const chatService = require('../services/chat/chat.service');
const streamingService = require('../services/chat/streaming.service');
const threadSuggestionsService = require('../services/chat/threadSuggestions.service');
const anonIdentity = require('../services/chat/anonIdentity.service');
const { randomUUID } = require('crypto');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isWellFormedUid(uid) {
  const s = String(uid || '').trim();
  if (!s || s.length > 100) return false;
  return UUID_V4.test(s) || /^uid_/.test(s);
}

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
 * POST /threads/:id/stream
 */
async function streamMessage(req, res, next) {
  try {
    const ownerId = chatService.getOwnerIdFromReq(req);
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_thread_id' });
    }

    const userMessage = String(req.body?.text || '').trim();
    if (!userMessage) {
      return res.status(400).json({ ok: false, error: 'missing_text' });
    }

    // Frontend may send `{ text, model }`. Validate against the models the proxy
    // advertises; anything else is dropped so the downstream tier policy picks.
    // (The running proxy ignores body.model today — this is still wired in so
    // callers with their own policy can override per request.)
    // Single-lane (2026-05-16): only Sonnet via the proxy. Out-of-set strings
    // (e.g., stale PWA tabs sending 'claude-haiku-4-5') silently fall through
    // to the tier-router default — no 4xx, no surprise.
    const ALLOWED_OVERRIDES = new Set(['claude-sonnet-4-6']);
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
 * Returns 200 with `{ ok: true, suggestions: [...] }` only when the LLM
 * generated real chips. On LLM failure / empty / not ready, returns 503
 * with `{ ok: false, error: 'suggestions_unavailable' }` so the UI can
 * retry or stay in loading state — no hardcoded fallback chips.
 */
async function getThreadSuggestions(req, res, next) {
  try {
    const ownerId = chatService.getOwnerIdFromReq(req);
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_thread_id' });
    }

    const generated = await threadSuggestionsService.generateForThread(threadId, ownerId);
    if (Array.isArray(generated) && generated.length > 0) {
      return res.json({ ok: true, suggestions: generated });
    }
    return res.status(503).json({ ok: false, error: 'suggestions_unavailable' });
  } catch (e) {
    return res.status(503).json({ ok: false, error: 'suggestions_unavailable' });
  }
}

/**
 * Mint / renew a signed anonymous identity token.
 * POST /chat/identity  (public; MUST stay outside the identity guard).
 */
async function createIdentity(req, res, next) {
  try {
    const presented = req.get('x-malika-token') || '';
    const payload = presented ? anonIdentity.verifyToken(presented) : null;

    let uid;
    if (payload && payload.sub) {
      uid = payload.sub;                       // 1) sliding renewal
    } else if (isWellFormedUid(req.body?.uid)) {
      uid = String(req.body.uid).trim();        // 2) legacy adoption
    } else {
      uid = randomUUID();                        // 3) fresh identity
    }

    const token = anonIdentity.issueToken(uid);
    const verified = anonIdentity.verifyToken(token);
    return res.json({ ok: true, uid, token, exp: verified?.exp });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listThreads,
  createThread,
  listMessages,
  sendMessage,
  streamMessage,
  getThreadSuggestions,
  createIdentity,
};
