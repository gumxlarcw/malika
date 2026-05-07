/**
 * Custom error types for Chat services
 * Provides structured error handling with codes for client-side handling
 */

class ChatError extends Error {
  constructor(message, code, status = 500, details = {}) {
    super(message);
    this.name = 'ChatError';
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      status: this.status,
      details: this.details,
    };
  }
}

class ThreadNotFoundError extends ChatError {
  constructor(threadId) {
    super('Thread not found', 'THREAD_NOT_FOUND', 404, { threadId });
    this.name = 'ThreadNotFoundError';
  }
}

class QuotaExceededError extends ChatError {
  constructor(quotaType, remaining = 0) {
    super('Quota exceeded', 'QUOTA_EXCEEDED', 429, { quotaType, remaining });
    this.name = 'QuotaExceededError';
  }
}

class InvalidInputError extends ChatError {
  constructor(field, reason) {
    super('Invalid input', 'INVALID_INPUT', 400, { field, reason });
    this.name = 'InvalidInputError';
  }
}

class ServiceUnavailableError extends ChatError {
  constructor(service, retryAfterMs = null) {
    super(`Service unavailable: ${service}`, 'SERVICE_UNAVAILABLE', 503, { 
      service, 
      retryAfter: retryAfterMs ? Math.ceil(retryAfterMs / 1000) : null 
    });
    this.name = 'ServiceUnavailableError';
  }
}

class OpenAIError extends ChatError {
  constructor(message, originalError = null) {
    super(message, 'OPENAI_ERROR', 502, { 
      originalMessage: originalError?.message 
    });
    this.name = 'OpenAIError';
  }
}

class RateLimitError extends ChatError {
  constructor(retryAfterMs = 60000) {
    super('Too many requests', 'RATE_LIMITED', 429, { 
      retryAfter: Math.ceil(retryAfterMs / 1000) 
    });
    this.name = 'RateLimitError';
  }
}

/**
 * Format error for SSE response
 * @param {Error} error - The error to format
 * @param {object} context - Additional context (requestId, etc.)
 * @returns {object} Formatted error object
 */
function formatErrorResponse(error, context = {}) {
  if (error instanceof ChatError) {
    return {
      ...error.toJSON(),
      timestamp: new Date().toISOString(),
      requestId: context.requestId || null,
    };
  }

  // Generic error
  return {
    error: error.message || 'An error occurred',
    code: error.code || 'UNKNOWN_ERROR',
    status: error.status || 500,
    timestamp: new Date().toISOString(),
    requestId: context.requestId || null,
  };
}

module.exports = {
  ChatError,
  ThreadNotFoundError,
  QuotaExceededError,
  InvalidInputError,
  ServiceUnavailableError,
  OpenAIError,
  RateLimitError,
  formatErrorResponse,
};
