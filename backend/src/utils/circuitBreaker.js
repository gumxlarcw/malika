/**
 * Circuit Breaker for external API calls
 * Prevents hammering external services during outages
 */

const logger = require('./logger');

class CircuitBreaker {
  /**
   * @param {string} name - Name of the circuit (for logging)
   * @param {number} failureThreshold - Number of failures before opening
   * @param {number} resetTimeoutMs - Time before attempting recovery
   * @param {number} halfOpenMaxAttempts - Max attempts in half-open state
   */
  constructor(name, failureThreshold = 5, resetTimeoutMs = 60000, halfOpenMaxAttempts = 2) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.halfOpenMaxAttempts = halfOpenMaxAttempts;
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = 0;
    this.halfOpenAttempts = 0;
  }

  /**
   * Check if circuit allows request
   * @returns {boolean}
   */
  isOpen() {
    if (this.state === 'CLOSED') return false;
    
    if (this.state === 'OPEN') {
      // Check if we should transition to HALF_OPEN
      if (Date.now() >= this.nextAttemptTime) {
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
        logger.info({ circuit: this.name }, 'Circuit breaker transitioning to HALF_OPEN');
        return false;
      }
      return true;
    }
    
    // HALF_OPEN - allow limited attempts
    if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
      return true;
    }
    
    return false;
  }

  /**
   * Record a successful request
   */
  onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxAttempts) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        logger.info({ circuit: this.name }, 'Circuit breaker CLOSED after recovery');
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed request
   */
  onFailure() {
    this.lastFailureTime = Date.now();
    
    if (this.state === 'HALF_OPEN') {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.state = 'OPEN';
        this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
        logger.warn({ circuit: this.name, nextAttempt: this.nextAttemptTime }, 
          'Circuit breaker OPEN after half-open failure');
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
        logger.warn({ circuit: this.name, failures: this.failureCount }, 
          'Circuit breaker OPEN after threshold failures');
      }
    }
  }

  /**
   * Execute function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @returns {Promise<*>}
   */
  async execute(fn) {
    if (this.isOpen()) {
      const error = new Error(`Circuit breaker ${this.name} is OPEN`);
      error.code = 'CIRCUIT_OPEN';
      error.retryAfter = Math.max(0, this.nextAttemptTime - Date.now());
      throw error;
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get circuit breaker status
   * @returns {object}
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.state === 'OPEN' ? this.nextAttemptTime : null,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    logger.info({ circuit: this.name }, 'Circuit breaker manually reset');
  }
}

// Singleton circuit breakers for external services
const openAICircuit = new CircuitBreaker('OpenAI', 5, 60000, 2);
const bpsAPICircuit = new CircuitBreaker('BPS_API', 10, 30000, 3);
const braveSearchCircuit = new CircuitBreaker('BraveSearch', 5, 60000, 2);

module.exports = {
  CircuitBreaker,
  openAICircuit,
  bpsAPICircuit,
  braveSearchCircuit,
};
