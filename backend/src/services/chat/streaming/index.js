/**
 * Streaming Service Modules Index
 * 
 * Re-exports all streaming submodules for easier importing.
 * 
 * Phase 4 modules:
 * - config.js - Configuration constants
 * - eximHandler.js - EXIM query detection
 * - mergeBundles.js - Multi-source merge bundles
 * - chatHelpers.js - Greeting, formatting, suggestions
 * 
 * Phase 4+ modules:
 * - queryContext.service.js - Context detection, fragment handling
 * - previewBuilder.service.js - Data preview building
 * - uiMetadata.service.js - UI metadata construction
 */

const config = require('./config');
const eximHandler = require('./eximHandler');
const mergeBundles = require('./mergeBundles');
const chatHelpers = require('./chatHelpers');
const queryContext = require('./queryContext.service');
const previewBuilder = require('./previewBuilder.service');
const uiMetadata = require('./uiMetadata.service');
const sseService = require('./sse.service');
const openaiClient = require('./openaiClient');
const brsPreview = require('./brsPreview.service');
const multiSource = require('./multiSource.service');
const dataPreview = require('./dataPreview.service');
const topicService = require('./topic.service');
const knowledgeContext = require('./knowledgeContext.service');
const provinsiService = require('./provinsi.service');
const promptService = require('./prompt.service');
const greetingService = require('./greeting.service');
const assistantMessageService = require('./assistantMessage.service');
const modelRouter = require('./modelRouter.service');
const pipeline = require('./pipeline.service');

// M19: Detect export name collisions from spread re-exports
const _modules = [
  ['config', config], ['eximHandler', eximHandler], ['mergeBundles', mergeBundles],
  ['chatHelpers', chatHelpers], ['queryContext', queryContext], ['previewBuilder', previewBuilder],
  ['uiMetadata', uiMetadata], ['sse', sseService], ['openaiClient', openaiClient],
  ['brsPreview', brsPreview], ['multiSource', multiSource], ['dataPreview', dataPreview],
  ['topic', topicService], ['knowledgeContext', knowledgeContext], ['provinsi', provinsiService],
  ['prompt', promptService], ['greeting', greetingService], ['assistantMessage', assistantMessageService],
  ['modelRouter', modelRouter], ['pipeline', pipeline],
];
const _seen = new Map();
for (const [modName, mod] of _modules) {
  for (const key of Object.keys(mod)) {
    if (_seen.has(key)) {
      console.warn(`[streaming/index.js] Export collision: "${key}" in ${modName} overwrites ${_seen.get(key)}`);
    }
    _seen.set(key, modName);
  }
}

module.exports = {
  // Configuration
  ...config,
  
  // EXIM Handler
  ...eximHandler,
  
  // Merge Bundles
  ...mergeBundles,
  
  // Chat Helpers
  ...chatHelpers,
  
  // Query Context (Phase 4+)
  ...queryContext,
  
  // Preview Builder (Phase 4+)
  ...previewBuilder,
  
  // UI Metadata (Phase 4+)
  ...uiMetadata,

  // SSE Service
  ...sseService,

  // OpenAI Client
  ...openaiClient,

  // BRS Preview
  ...brsPreview,

  // Multi-source Merge
  ...multiSource,

  // Data Preview Bundle Merge
  ...dataPreview,

  // Topic Helpers
  ...topicService,

  // Knowledge Context
  ...knowledgeContext,

  // Provinsi Helpers
  ...provinsiService,

  // Prompt Helpers
  ...promptService,

  // Greeting Helper
  ...greetingService,

  // Assistant Message Helper
  ...assistantMessageService,

  // Model Router (v2)
  ...modelRouter,

  // Pipeline Orchestrator (v2)
  ...pipeline,
};
