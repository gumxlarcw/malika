const crypto = require('crypto');
const chatService = require('../services/chat/chat.service');
const streamingService = require('../services/chat/streaming.service');
const threadSuggestionsService = require('../services/chat/threadSuggestions.service');
const anonIdentity = require('../services/chat/anonIdentity.service');

/** UUIDv4 or legacy `uid_*` (≤100 chars) — the only shapes we will sign. */
function isWellFormedUid(uid) {
  if (typeof uid !== 'string') return false;
  const u = uid.trim();
  if (!u || u.length > 100) return false;
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const legacy = /^uid_[A-Za-z0-9_.]+$/;
  return uuidV4.test(u) || legacy.test(u);
}

/**
 * POST /chat/identity — mint or renew a signed anonymous identity token.
 * Public, bootstrap-exempt from the identity guard (it is what issues tokens).
 *   1. valid x-malika-token presented → re-issue (sliding renewal)
 *   2. well-formed uid in body → sign that uid (legacy adoption)
 *   3. otherwise → generate a fresh uid + token
 * Returns { ok, uid, token, exp }.
 */
async function createIdentity(req, res, next) {
  try {
    const presented = req.get('x-malika-token') || '';
    const existing = presented ? anonIdentity.verifyToken(presented) : null;

    let uid;
    if (existing && existing.sub) {
      uid = existing.sub; // renew
    } else {
      const bodyUid = req.body && typeof req.body.uid === 'string' ? req.body.uid.trim() : '';
      uid = isWellFormedUid(bodyUid) ? bodyUid : crypto.randomUUID();
    }

    const token = anonIdentity.issueToken(uid);
    const payload = anonIdentity.verifyToken(token);
    return res.json({ ok: true, uid, token, exp: payload ? payload.exp : null });
  } catch (e) {
    next(e);
  }
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

async function deleteThread(req, res, next) {
  try {
    const ownerId = chatService.getOwnerIdFromReq(req);
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_thread_id' });
    }

    const result = await chatService.deleteThread(ownerId, threadId);
    res.json(result);
  } catch (e) {
    // Not-owned / missing thread → 404 (don't reveal existence to non-owners).
    if (e && e.code === 'thread_not_found') {
      return res.status(404).json({ ok: false, error: 'thread_not_found' });
    }
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

module.exports = {
  createIdentity,
  listThreads,
  createThread,
  listMessages,
  sendMessage,
  deleteThread,
  streamMessage,
  getThreadSuggestions,
};
