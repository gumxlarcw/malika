'use strict';

/**
 * Proxy-only rule (2026-05-16): all LLM chat calls must terminate at the
 * local malika-llm-proxy. Modules that issue chat HTTP requests call this
 * at load-time so misconfig fails loud at boot instead of silently bypassing
 * the proxy at request time.
 *
 * @param {string} moduleName - tag for the error message, e.g. 'openaiChat.service'
 * @param {string} [envVarName='OPENAI_API_URL'] - env var to read
 * @returns {string} the trimmed env value
 * @throws {Error} when the env var is unset or whitespace-only
 */
module.exports = function requireProxyUrl(moduleName, envVarName = 'OPENAI_API_URL') {
  const v = process.env[envVarName];
  if (!v || !String(v).trim()) {
    throw new Error(
      `[${moduleName}] ${envVarName} env var must be set (must point at malika-llm-proxy)`
    );
  }
  return String(v).trim();
};
