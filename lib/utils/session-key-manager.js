/**
 * Session Key Manager
 * 
 * Centralized module for managing trading session keys in Redis.
 * This ensures consistent key formatting and prevents duplicate keys
 * across different trading pairs.
 */

import { formatSymbol, formatExchange, generateRedisKey } from '../../../lib/utils/redis-key-formatter.js';

/**
 * Generate all session-related keys for a specific session
 * 
 * @param {Object} config - Session configuration
 * @param {string} config.strategy - Strategy name (e.g., 'traditional')
 * @param {string} config.exchange - Exchange name (e.g., 'kraken')
 * @param {string} config.symbol - Trading pair (e.g., 'BTC/USD')
 * @param {string} config.sessionId - Unique session ID
 * @returns {Object} Object containing all session-related keys
 */
export function generateSessionKeys(config) {
  const { strategy, exchange, symbol, sessionId } = config;
  
  if (!strategy || !exchange || !symbol || !sessionId) {
    throw new Error('Missing required parameters for session key generation');
  }
  
  // Cache formatted values for reuse
  const formattedSymbol = formatSymbol(symbol);
  const formattedExchange = formatExchange(exchange);
  
  // Generate the base prefix for all keys related to this trading pair
  const keyPrefix = `${strategy}:${formattedExchange}:${formattedSymbol}:`;
  
  // Establish the key for the session itself
  const sessionKey = `${keyPrefix}${sessionId}:session`;
  
  // Generate additional session-related keys
  return {
    // Key prefix
    keyPrefix,
    
    // Session data keys
    sessionKey,
    
    // Session-specific data keys
    ordersKey: `${keyPrefix}${sessionId}:orders`,
    fillsKey: `${keyPrefix}${sessionId}:fills`,
    positionsKey: `${keyPrefix}${sessionId}:positions`,
    tradesKey: `${keyPrefix}${sessionId}:trades`,
    metricsKey: `${keyPrefix}${sessionId}:metrics`,
    
    // Global data keys for the trading pair
    globalPositionsKey: `${keyPrefix}positions`,
    recentSessionsKey: `${keyPrefix}recent-sessions`,
    sessionHistoryKey: `${keyPrefix}session-history`,
    
    // Formatted values for reuse
    formattedSymbol,
    formattedExchange,
    
    // Original values
    symbol,
    exchange,
    strategy,
    sessionId
  };
}

/**
 * Generate a unique session key for a specific data type
 * 
 * @param {Object} config - Session configuration
 * @param {string} config.strategy - Strategy name (e.g., 'traditional')
 * @param {string} config.exchange - Exchange name (e.g., 'kraken')
 * @param {string} config.symbol - Trading pair (e.g., 'BTC/USD')
 * @param {string} config.sessionId - Unique session ID
 * @param {string} config.keyName - Key name (e.g., 'orders', 'positions')
 * @returns {string} Formatted Redis key
 */
export function generateSessionDataKey(config) {
  return generateRedisKey(config);
}

/**
 * Get the session key pattern for finding sessions for a trading pair
 * 
 * @param {Object} config - Configuration object
 * @param {string} config.strategy - Strategy name (e.g., 'traditional')
 * @param {string} config.exchange - Exchange name (e.g., 'kraken')
 * @param {string} config.symbol - Trading pair (e.g., 'BTC/USD')
 * @param {string} [config.sessionId] - Optional specific session ID
 * @returns {string} Session key pattern for finding sessions
 */
export function getSessionKeyPattern(config) {
  const { strategy, exchange, symbol, sessionId } = config;
  
  if (!strategy || !exchange || !symbol) {
    throw new Error('Missing required parameters for session key pattern generation');
  }
  
  const formattedExchange = formatExchange(exchange);
  const formattedSymbol = formatSymbol(symbol);
  const keyPrefix = `${strategy}:${formattedExchange}:${formattedSymbol}:`;
  
  // If a specific session ID is provided, return the exact key
  if (sessionId) {
    return `${keyPrefix}${sessionId}:session`;
  }
  
  // Otherwise return a pattern that matches all session keys for this trading pair
  return `${keyPrefix}*:session`;
}

/**
 * Get the session key for a specific session
 * 
 * @param {Object} config - Configuration object
 * @param {string} config.strategy - Strategy name (e.g., 'traditional')
 * @param {string} config.exchange - Exchange name (e.g., 'kraken')
 * @param {string} config.symbol - Trading pair (e.g., 'BTC/USD')
 * @param {string} config.sessionId - Session ID
 * @returns {string} Session key
 */
export function getSessionKey(config) {
  const { strategy, exchange, symbol, sessionId } = config;
  
  if (!strategy || !exchange || !symbol || !sessionId) {
    throw new Error('Missing required parameters for session key generation');
  }
  
  const formattedExchange = formatExchange(exchange);
  const formattedSymbol = formatSymbol(symbol);
  const keyPrefix = `${strategy}:${formattedExchange}:${formattedSymbol}:`;
  
  return `${keyPrefix}${sessionId}:session`;
}

/**
 * Format a trading pair for use in Redis keys
 * 
 * @param {string} tradingPair - Trading pair (e.g., 'BTC/USD')
 * @returns {string} Formatted trading pair (e.g., 'btc-usd')
 */
export function formatTradingPair(tradingPair) {
  return formatSymbol(tradingPair);
}
