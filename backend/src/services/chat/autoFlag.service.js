'use strict';
/**
 * Conservative heuristics for auto-flagging bad chat responses.
 *
 * Called fire-and-forget by streaming.service.js after a response completes.
 * Returns null if no heuristic matches; otherwise returns the row to insert
 * into chat_message_flags. Caller persists.
 *
 * False positives create noise on /backend/malika-analysis, so we only fire
 * when we're confident the response is wrong:
 *   1. Refusal-with-data: model said "tidak ada" but context had candidates+rows
 *   2. Ultra-short non-greeting: < 30 chars when intent is COMPLEX/DEEP
 *   3. Repeat-in-thread: same response back-to-back implies context_lost
 */

const REFUSAL_PATTERNS = [
  /tidak\s+(ada|tersedia|menemukan)/i,
  /maaf,?\s+saya\s+tidak/i,
  /belum\s+memiliki\s+data/i,
  /data\s+(tersebut|tersebut)?\s+tidak/i,
];

const NON_FLAGGED_INTENTS = new Set(['GREETING', 'CHITCHAT', 'OUT_OF_SCOPE']);

function detectAutoFlag({
  userQuery,
  assistantResponse,
  intent,
  candidates = [],
  dataPreviewRowCount = 0,
  recentAssistantResponses = [],
}) {
  const text = String(assistantResponse || '').trim();
  if (!text) return null;
  if (NON_FLAGGED_INTENTS.has(intent)) return null;

  // Repeat-in-thread takes priority — same text back-to-back is a stronger
  // pipeline signal than any single-response heuristic, even if the text
  // also matches refusal patterns.
  if (recentAssistantResponses.length >= 2 &&
      recentAssistantResponses[0] === text &&
      recentAssistantResponses[1] === text) {
    return {
      flag_type: 'context_lost',
      severity: 'medium',
      flagged_by: 'system',
      user_query: userQuery,
      assistant_response: text,
      context_snapshot: { repeatCount: 2, intent },
    };
  }

  // Refusal-with-data
  const isRefusal = REFUSAL_PATTERNS.some((rx) => rx.test(text));
  if (isRefusal && candidates.length > 0 && dataPreviewRowCount > 0) {
    return {
      flag_type: 'hallucination',
      severity: 'high',
      flagged_by: 'system',
      user_query: userQuery,
      assistant_response: text,
      context_snapshot: { candidateCount: candidates.length, rowCount: dataPreviewRowCount, intent },
    };
  }

  // Ultra-short non-greeting
  if (text.length < 30) {
    return {
      flag_type: 'incomplete',
      severity: 'low',
      flagged_by: 'system',
      user_query: userQuery,
      assistant_response: text,
      context_snapshot: { responseLength: text.length, intent },
    };
  }

  return null;
}

module.exports = { detectAutoFlag };
