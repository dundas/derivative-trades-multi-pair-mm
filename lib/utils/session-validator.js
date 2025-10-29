/**
 * Session Validator
 * 
 * Utility functions to validate session data and prevent inconsistent trading pair usage.
 * This helps avoid issues where the same session ID is used with different trading pairs,
 * which can cause data retrieval problems and analysis errors.
 */

/**
 * Validate that a session ID doesn't already exist with a different trading pair
 * 
 * @param {Object} redis - Redis client instance
 * @param {string} sessionId - Session ID to validate
 * @param {string} tradingPair - Trading pair to validate (e.g., 'ETH/USD')
 * @param {Object} logger - Logger instance (optional)
 * @returns {Promise<Object>} - Validation result with valid status and conflict details if any
 */
export async function validateSessionTradingPair(redis, sessionId, tradingPair, logger = console) {
  try {
    if (!redis) {
      logger.warn('[SESSION VALIDATOR] Redis not available, skipping validation');
      return { valid: true };
    }
    
    if (!sessionId) {
      logger.warn('[SESSION VALIDATOR] No session ID provided, skipping validation');
      return { valid: true };
    }
    
    // Normalize the trading pair for comparison with Redis keys
    const normalizedTradingPair = tradingPair.replace('/', '-').toLowerCase();
    
    // Find all keys that might be associated with this session ID
    const sessionKeys = await redis.keys(`*:${sessionId}*`);
    
    if (!sessionKeys || sessionKeys.length === 0) {
      // No existing keys found, safe to create a new session
      logger.debug(`[SESSION VALIDATOR] No existing keys found for session ID ${sessionId}`);
      return { valid: true };
    }
    
    logger.debug(`[SESSION VALIDATOR] Found ${sessionKeys.length} existing keys for session ID ${sessionId}`);
    
    // Check if any key contains a different trading pair than the current one
    for (const key of sessionKeys) {
      // Extract trading pair from the key
      // Keys typically have format: traditional:kraken:TRADING-PAIR:SESSION-ID:...
      const parts = key.split(':');
      if (parts.length >= 3) {
        const keyTradingPair = parts[2];
        
        if (keyTradingPair !== normalizedTradingPair) {
          logger.warn(`[SESSION VALIDATOR] Found existing session with ID ${sessionId} using a different trading pair: ${keyTradingPair} (current: ${normalizedTradingPair})`);
          logger.warn(`[SESSION VALIDATOR] This can lead to data inconsistency and retrieval problems`);
          
          // Return the conflicting key so the caller can decide what to do
          return { 
            valid: false, 
            conflictingPair: keyTradingPair,
            currentPair: normalizedTradingPair,
            conflictingKey: key
          };
        }
      }
    }
    
    // No conflicts found
    logger.debug(`[SESSION VALIDATOR] No trading pair conflicts found for session ID ${sessionId}`);
    return { valid: true };
  } catch (error) {
    logger.error(`[SESSION VALIDATOR] Error validating session trading pair: ${error.message}`);
    return { valid: true }; // Proceed anyway on error
  }
}

/**
 * Generate a unique session ID that doesn't conflict with existing trading pairs
 * 
 * @param {Function} idGenerator - Function to generate a session ID (e.g., uuid)
 * @param {Object} redis - Redis client instance
 * @param {string} tradingPair - Trading pair (e.g., 'ETH/USD')
 * @param {number} maxAttempts - Maximum number of attempts to generate a unique ID (default: 5)
 * @param {Object} logger - Logger instance (optional)
 * @returns {Promise<string>} - A unique session ID
 */
export async function generateUniqueSessionId(idGenerator, redis, tradingPair, maxAttempts = 5, logger = console) {
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    const sessionId = idGenerator();
    logger.debug(`[SESSION VALIDATOR] Checking session ID: ${sessionId}`);
    
    // Validate this session ID doesn't have trading pair conflicts
    const validationResult = await validateSessionTradingPair(redis, sessionId, tradingPair, logger);
    
    if (validationResult.valid) {
      logger.debug(`[SESSION VALIDATOR] Generated unique session ID: ${sessionId}`);
      return sessionId;
    }
    
    logger.warn(`[SESSION VALIDATOR] Session ID ${sessionId} has conflicts, trying again (attempt ${attempts + 1}/${maxAttempts})`);
    attempts++;
  }
  
  // If we couldn't generate a unique ID after maxAttempts, generate one final ID and add a suffix
  const fallbackId = `${idGenerator()}-${tradingPair.replace('/', '-').toLowerCase()}`;
  logger.warn(`[SESSION VALIDATOR] Could not generate a conflict-free session ID after ${maxAttempts} attempts`);
  logger.warn(`[SESSION VALIDATOR] Using fallback ID with trading pair suffix: ${fallbackId}`);
  
  return fallbackId;
}

export default {
  validateSessionTradingPair,
  generateUniqueSessionId
};
