/**
 * Greeting response helper for streaming chat
 */

'use strict';

const ChatMessage = require('../../../models/ChatMessage.model');
const logger = require('../../../utils/logger').child({ service: 'GreetingResponse' });
const { OPENAI } = require('./config');
const { fetchOpenAIWithRetry } = require('./openaiClient');
const { stripMalikaUiBlock } = require('./chatHelpers');
const { saveAssistantMessage } = require('./assistantMessage.service');

/**
 * Stream greeting response without data lookup
 */
async function streamGreetingResponse({
  sendEvent,
  threadId,
  userMessage,
  model,
  apiKey,
  suggestions,
}) {
  // Build simple greeting context for LLM
  const messages = [
    { role: 'system', content: 'Kamu adalah MALIKA, asisten virtual customer service BPS Maluku Utara. Balas greeting user dengan ramah dan singkat. Tawarkan bantuan untuk mencari data statistik. JANGAN tampilkan tabel atau data apapun untuk greeting.' },
    { role: 'user', content: userMessage },
  ];

  // Stream response from OpenAI with retry
  let fullText = '';
  try {
    const response = await fetchOpenAIWithRetry({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: OPENAI.MAX_TOKENS.GREETING,
        temperature: OPENAI.TEMPERATURE.GREETING,
      }),
    }, OPENAI.RETRIES, OPENAI.GREETING_TIMEOUT_MS);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.trim().startsWith('data:'));

      for (const line of lines) {
        const jsonStr = line.replace(/^data:\s*/, '').trim();
        if (jsonStr === '[DONE]') break;

        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            sendEvent('chunk', { text: delta });
          }
        } catch {
          // Skip malformed JSON chunks (expected during SSE streaming)
        }
      }
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Greeting generation failed, using fallback');
    fullText = 'Halo! Ada yang bisa saya bantu terkait data statistik BPS Maluku Utara?';
    sendEvent('chunk', { text: fullText });
  }

  // Build UI metadata WITHOUT table/candidates
  const uiMeta = {
    v: 1,
    query: userMessage,
    preview_mode: 'none',
    candidates: [],
    period_fallback: null,
    table: null,
    suggestions,
  };

  // Emit malika_ui event for frontend
  sendEvent('malika_ui', uiMeta);

  // Then emit done event
  sendEvent('done', { fullText });

  // Save assistant message using shared helper (M22: deduplicated)
  await saveAssistantMessage({
    threadId,
    text: fullText,
    model,
    rawUiMeta: uiMeta,
    updateThread: true,
    userMessage,
  });
}

module.exports = {
  streamGreetingResponse,
};
