/**
 * Assistant message persistence helper
 */

'use strict';

const ChatMessage = require('../../../models/ChatMessage.model');
const ChatThread = require('../../../models/ChatThread.model');
const dateHelper = require('../../../utils/dateHelper');
const { buildUIMetadata } = require('./uiMetadata.service');
const { stripMalikaUiBlock, linkifyWhatsAppNumber } = require('./chatHelpers');

/**
 * Save assistant message with UI metadata
 * 
 * @param {object} opts - All options as a single object
 * @param {number} opts.threadId - Chat thread ID
 * @param {string} opts.text - Assistant response text
 * @param {string} [opts.model] - OpenAI model used
 * @param {object} [opts.intentResult] - Intent resolution result
 * @param {Array} [opts.candidates] - Datasource candidates
 * @param {object} [opts.dataPreview] - Data preview object
 * @param {string} [opts.periodFallback] - Period fallback value
 * @param {Array} [opts.contextualSuggestions] - Contextual suggestions
 * @param {object} [opts.eximParams] - EXIM parameters
 * @param {boolean} [opts.isKnowledgeMode] - Whether in knowledge mode
 * @param {string} [opts.conversationTopic] - Conversation topic
 * @param {string} [opts.userMessage] - Original user message
 * @param {Array} [opts.brsContext] - BRS context documents
 * @param {Array} [opts.knowledgeContext] - Knowledge base context
 * @param {Array} [opts.externalLinks] - External web search results (display-only)
 * @param {boolean} [opts.aiFilterApplied] - Whether AI relevance filter was applied * @param {object} [opts.rawUiMeta] - Pre-built UI metadata (skips buildUIMetadata when provided)
 * @param {boolean} [opts.updateThread] - Whether to update thread timestamps (default: false) * @param {object} [opts.transaction] - Sequelize transaction for atomic writes
 */
async function saveAssistantMessage(opts) {
  const {
    threadId,
    text,
    model = null,
    intentResult = null,
    candidates = null,
    dataPreview = null,
    periodFallback = null,
    contextualSuggestions = null,
    eximParams = null,
    isKnowledgeMode = false,
    conversationTopic = null,
    userMessage = null,
    brsContext = null,
    knowledgeContext = null,
    externalLinks = null,
    aiFilterApplied = false,
    rawUiMeta = null,
    updateThread = false,
    latencyMs = null,
    transaction = null,
  } = opts;

  // Use pre-built UI metadata if provided, otherwise build from components
  const uiMeta = rawUiMeta || buildUIMetadata(
    intentResult,
    candidates,
    dataPreview,
    periodFallback,
    contextualSuggestions,
    eximParams,
    isKnowledgeMode,
    conversationTopic,
    brsContext,
    knowledgeContext,
    externalLinks,
    aiFilterApplied
  );

  const uiBlock = `\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\`\n`;

  // Post-process text: convert WhatsApp numbers to clickable links
  // IMPORTANT: Strip any existing malika_ui blocks from LLM output before adding our own
  const cleanedText = stripMalikaUiBlock(String(text || ''));

  // Build context for WhatsApp link pre-fill
  const waContext = {
    threadId,
    userMessage: userMessage || null,
    aiResponse: cleanedText.slice(0, 200),
  };
  const processedText = linkifyWhatsAppNumber(cleanedText.trim(), waContext);

  const assistantContent = `${processedText}${uiBlock}`.trim().slice(0, 100000);

  await ChatMessage.create({
    thread_id: threadId,
    role: 'assistant',
    content: assistantContent,
    model: model || null,
    latency_ms: latencyMs || null,
    created_at: dateHelper.now(),
  }, transaction ? { transaction } : undefined);

  // Optionally update thread timestamps (used by greeting flow)
  if (updateThread) {
    const thread = await ChatThread.findByPk(threadId);
    if (thread) {
      await thread.update({
        last_message_at: dateHelper.now(),
        updated_at: dateHelper.now(),
      }, transaction ? { transaction } : undefined);
    }
  }
}

module.exports = {
  saveAssistantMessage,
};
