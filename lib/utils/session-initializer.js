/**
 * Session Initializer
 * 
 * Centralized module for initializing trading sessions.
 * This ensures consistent session creation and prevents duplicate keys across different parts of the application.
 */

import { generateSessionKeys } from './session-key-manager.js';
import { ensureSessionSchema } from '../../../lib/schemas/session-schema.js';

/**
 * Initialize a new trading session with consistent key generation
 * 
 * @param {Object} options - Session initialization options
 * @param {string} options.sessionId - Unique session ID
 * @param {string} options.tradingPair - Trading pair (e.g., 'BTC/USD')
 * @param {string} options.exchange - Exchange name (default: 'kraken')
 * @param {string} options.strategy - Strategy name (default: 'traditional')
 * @param {number} options.budget - Starting budget for the session
 * @param {Object} options.stateManager - The state manager to use for session persistence
 * @param {Object} options.settings - Additional session settings
 * @param {Object} options.pricingStrategyConfig - Pricing strategy configuration
 * @param {string} options.pricingStrategyName - Name of the pricing strategy template used
 * @returns {Promise<Object>} Created session object
 */
export async function initializeSession(options) {
  const {
    sessionId,
    tradingPair,
    exchange = 'kraken',
    strategy = 'traditional', // Default to 'traditional' if not specified
    budget,
    stateManager,
    settings = {},
    pricingStrategyConfig,
    pricingStrategyName
  } = options;
  
  // Validate required parameters
  if (!sessionId || !tradingPair || !stateManager) {
    console.error('Missing required parameters for session initialization');
    throw new Error('Missing required parameters: sessionId, tradingPair, stateManager');
  }
  
  console.log('=== INITIALIZING TRADING SESSION - CENTRALIZED APPROACH ===');
  console.log(`Session ID: ${sessionId}`);
  console.log(`Trading Pair: ${tradingPair}`);
  console.log(`Strategy: ${strategy}`);
  console.log(`Exchange: ${exchange}`);
  console.log(`Budget: $${budget}`);
  
  try {
    // Important: We use the exact strategy name provided in the command line
    // This ensures consistent key generation across the application
    console.log(`Using strategy '${strategy}' for key generation`);
    
    // Generate all session keys using our centralized key manager
    const sessionKeys = generateSessionKeys({
      strategy, // Preserve exact strategy name (e.g., 'traditional-v2')
      exchange,
      symbol: tradingPair,
      sessionId
    });
    
    // Log the keys being used (useful for debugging)
    console.log('\nUsing the following Redis keys:');
    console.log(`  Session Key: ${sessionKeys.sessionKey}`);
    
    // Create a standardized session object
    const timestamp = Date.now();
    const sessionData = {
      id: sessionId,
      symbol: tradingPair,
      exchange,
      strategy,
      startedAt: timestamp,  // Use consistent field name for D1 compatibility
      startTime: timestamp,  // Keep for backward compatibility
      status: 'active',
      budget,
      settings,
      tradingMode: 'paper',  // Add required field for D1 compatibility
      // Store normalized information for consistent access
      normalizedInfo: {
        symbol: sessionKeys.formattedSymbol,
        exchange: sessionKeys.formattedExchange,
        keyPrefix: sessionKeys.keyPrefix
      },
      // Store pricing strategy configuration
      pricingStrategyConfig: pricingStrategyConfig || null,
      pricingStrategyName: pricingStrategyName || null
    };
    
    // If session has a duration, add end time
    if (settings.duration) {
      sessionData.duration = settings.duration;
      sessionData.endTime = Date.now() + settings.duration;
      console.log(`Session will end at: ${new Date(sessionData.endTime).toLocaleString()}`);
    }
    
    // Validate session data against schema before saving
    // Will throw an error if critical fields are missing
    console.log('Validating session data against schema...');
    const validatedSessionData = ensureSessionSchema(sessionData, {
      logger: console,
      strict: true // Exit if validation fails
    });
    
    // Log session data integrity check
    console.log(`[SESSION_INTEGRITY] Session initialization - startedAt present: ${validatedSessionData.startedAt ? 'YES' : 'NO'}, value: ${validatedSessionData.startedAt}`);
    console.log(`[SESSION_INTEGRITY] Session initialization - startTime present: ${validatedSessionData.startTime ? 'YES' : 'NO'}, value: ${validatedSessionData.startTime}`);
    
    // Save the validated session using the provided state manager
    const result = await stateManager.saveSession(validatedSessionData);
    
    // Double-check after serialization
    const serialized = JSON.stringify(validatedSessionData);
    const sessionObj = JSON.parse(serialized);
    console.log(`[SESSION_INTEGRITY] After serialization - startedAt present: ${sessionObj.startedAt ? 'YES' : 'NO'}, value: ${sessionObj.startedAt}`);
    console.log(`[SESSION_INTEGRITY] Session key being written: ${sessionKeys.sessionKey}`);
    
    if (result) {
      console.log('Session successfully validated, initialized and saved to Redis');
      return { success: true, session: validatedSessionData, keys: sessionKeys };
    } else {
      console.error('Failed to save session');
      return { success: false, error: 'Failed to save session' };
    }
  } catch (error) {
    console.error('Error initializing session:', error);
    return { success: false, error: error.message };
  }
}
