/**
 * Rolling Session Handler
 * 
 * Handles the logic for rolling trading sessions when they complete.
 * This is used by the unified market maker to automatically create
 * follow-up sessions based on configuration.
 */

import { RollingSessionManager } from '../../../lib/redis-backend-api/index.js';
import { createLogger } from './logger-factory.js';

const defaultLogger = createLogger('rolling-session-handler');

/**
 * Handles rolling a completed session to a new session
 * @param {string} sessionId - The ID of the completed session
 * @param {Object} redis - Redis client instance
 * @param {Object} sessionManager - Session manager instance for the completed session
 * @param {Object} [logger] - Logger instance (optional)
 * @returns {Promise<Object>} Result of the rolling operation
 */
export async function handleSessionRolling(sessionId, redis, sessionManager, logger = defaultLogger) {
  try {
    logger.info(`[RollingSessionHandler] Checking if session ${sessionId} should be rolled`);
    
    // Get the session data
    const sessionData = await sessionManager.get();
    
    if (!sessionData) {
      logger.error(`[RollingSessionHandler] Session ${sessionId} not found`);
      return { success: false, error: 'Session not found' };
    }
    
    // Check if session is in a valid state for rolling
    if (sessionData.status !== 'complete') {
      logger.info(`[RollingSessionHandler] Session ${sessionId} is not complete (status: ${sessionData.status}), skipping roll`);
      return { success: false, error: 'Session not complete' };
    }
    
    // Check if rolling is enabled for this session
    // CRITICAL FIX: Check rollingFlag first - if it's explicitly false, don't roll regardless of maxRollingChainLength
    const rollingFlag = sessionData.rollingFlag || sessionData.rolling || sessionData.settings?.rolling;
    
    if (rollingFlag === false) {
      logger.info(`[RollingSessionHandler] Rolling explicitly disabled for session ${sessionId} (rollingFlag: ${rollingFlag})`);
      return { success: false, error: 'Rolling explicitly disabled by rollingFlag' };
    }
    
    const maxRollingChainLength = sessionData.maxRollingChainLength || 
                                  sessionData.settings?.maxRollingChainLength || 
                                  0;
    
    if (!maxRollingChainLength || maxRollingChainLength <= 0) {
      logger.info(`[RollingSessionHandler] Rolling not enabled for session ${sessionId} (maxRollingChainLength: ${maxRollingChainLength})`);
      return { success: false, error: 'Rolling not enabled' };
    }
    
    // Check current chain length
    const currentChainLength = sessionData.chainLength || 1;
    
    if (currentChainLength >= maxRollingChainLength) {
      logger.info(`[RollingSessionHandler] Max chain length reached for session ${sessionId} (${currentChainLength}/${maxRollingChainLength})`);
      return { success: false, error: 'Max chain length reached' };
    }
    
    // Create rolling session manager
    const rollingSessionManager = new RollingSessionManager({
      sessionManager,
      redis,
      logger,
      alwaysRoll: true, // We've already checked conditions above
      maxChainLength: maxRollingChainLength
    });
    
    logger.info(`[RollingSessionHandler] Rolling session ${sessionId} (chain: ${currentChainLength}/${maxRollingChainLength})`);
    
    // Roll the session
    const rollResult = await rollingSessionManager.rollSession(sessionId, {
      reason: 'Session completed - automatic rolling',
      keepSettings: true,
      preserveState: true // Preserve budget and other state
    });
    
    if (rollResult.success) {
      logger.info(`[RollingSessionHandler] Successfully rolled session ${sessionId} -> ${rollResult.newSessionId}`);
      logger.info(`[RollingSessionHandler] New session queued for processing`);
      
      return {
        success: true,
        newSessionId: rollResult.newSessionId,
        newSession: rollResult.newSession,
        chainLength: currentChainLength + 1,
        maxChainLength: maxRollingChainLength
      };
    } else {
      logger.error(`[RollingSessionHandler] Failed to roll session ${sessionId}: ${rollResult.error}`);
      return {
        success: false,
        error: rollResult.error
      };
    }
    
  } catch (error) {
    logger.error(`[RollingSessionHandler] Error handling session rolling:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Checks if a session is eligible for rolling without actually rolling it
 * @param {Object} sessionData - The session data
 * @returns {Object} Eligibility check result
 */
export function isSessionEligibleForRolling(sessionData) {
  // Session must be complete
  if (sessionData.status !== 'complete') {
    return { eligible: false, reason: 'Session not complete' };
  }
  
  // Check if rolling is enabled
  // CRITICAL FIX: Check rollingFlag first - if it's explicitly false, don't roll regardless of maxRollingChainLength
  const rollingFlag = sessionData.rollingFlag || sessionData.rolling || sessionData.settings?.rolling;
  
  if (rollingFlag === false) {
    return { eligible: false, reason: 'Rolling explicitly disabled by rollingFlag' };
  }
  
  const maxRollingChainLength = sessionData.maxRollingChainLength || 
                                sessionData.settings?.maxRollingChainLength || 
                                0;
  
  if (!maxRollingChainLength || maxRollingChainLength <= 0) {
    return { eligible: false, reason: 'Rolling not enabled' };
  }
  
  // Check chain length
  const currentChainLength = sessionData.chainLength || 1;
  
  if (currentChainLength >= maxRollingChainLength) {
    return { eligible: false, reason: 'Max chain length reached' };
  }
  
  return {
    eligible: true,
    currentChainLength,
    maxChainLength: maxRollingChainLength,
    remainingRolls: maxRollingChainLength - currentChainLength
  };
}

export default {
  handleSessionRolling,
  isSessionEligibleForRolling
};