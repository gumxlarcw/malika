/**
 * Request Context (AsyncLocalStorage)
 *
 * Provides per-request context to deeply nested sub-agents without
 * threading parameters through every function signature.
 *
 * Usage in pipeline:
 *   const reqCtx = require('./requestContext');
 *   await reqCtx.run({ modelOverride: 'gpt-5-mini' }, async () => {
 *     const model = reqCtx.getModelOverride(); // => 'gpt-5-mini'
 *   });
 *
 * Usage in sub-agents:
 *   const reqCtx = require('./requestContext');
 *   const model = reqCtx.getModelOverride() || DEFAULT_MODEL;
 *
 * The user picks gpt-4.1 or gpt-5-mini on the frontend.
 * ALL sub-agents inherit that choice via getModelOverride().
 *
 * @module requestContext
 * @created 2026-02-16
 */

'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();

module.exports = {
  /**
   * Run a function within a request context.
   * All async operations inside `fn` will inherit this context.
   * @param {object} store - Context data (e.g. { modelOverride: 'gpt-5-mini' })
   * @param {Function} fn - Async function to run within context
   * @returns {Promise<*>} Result of fn
   */
  run: (store, fn) => asyncLocalStorage.run(store, fn),

  /**
   * Get the model override for the current request, if any.
   * Returns null when called outside a request context (e.g. batch jobs).
   * @returns {string|null}
   */
  getModelOverride: () => asyncLocalStorage.getStore()?.modelOverride || null,

  /**
   * Get the full request context store.
   * @returns {object}
   */
  getStore: () => asyncLocalStorage.getStore() || {},
};
