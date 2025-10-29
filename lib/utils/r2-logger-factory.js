/**
 * R2-Enhanced Market Maker Logger Factory
 * 
 * Creates customized loggers for different components of the Market Maker service
 * with R2 storage integration for durable logging and analytics.
 */

import { R2TradingLogger, createR2TradingLogger } from './r2-trading-logger.js';

// Define log levels
const LOG_LEVELS = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4
};

// Map environment LOG_LEVEL to numeric value
const getLogLevel = () => {
  const configuredLevel = process.env.LOG_LEVEL?.toUpperCase();
  return configuredLevel && LOG_LEVELS[configuredLevel] !== undefined 
    ? LOG_LEVELS[configuredLevel] 
    : LOG_LEVELS.INFO; // Default to INFO
};

/**
 * Extended R2TradingLogger with log level filtering
 */
class MarketMakerR2Logger extends R2TradingLogger {
  constructor(options = {}) {
    super(options);
    this.minLevel = getLogLevel();
  }
  
  // Check if the log level is high enough to be logged
  _shouldLog(level) {
    return LOG_LEVELS[level] >= this.minLevel;
  }
  
  // Override standard log methods to add level filtering
  debug(message, data) {
    if (!this._shouldLog('DEBUG')) return;
    super.debug(message, data);
  }
  
  info(message, data) {
    if (!this._shouldLog('INFO')) return;
    super.info(message, data);
  }
  
  warn(message, data) {
    if (!this._shouldLog('WARN')) return;
    super.warn(message, data);
  }
  
  error(message, data) {
    if (!this._shouldLog('ERROR')) return;
    super.error(message, data);
  }
  
  // Override category-specific log methods to add level filtering
  logOrder(level, message, data) {
    if (!this._shouldLog(level)) return;
    super.logOrder(level, message, data);
  }
  
  logTrade(level, message, data) {
    if (!this._shouldLog(level)) return;
    super.logTrade(level, message, data);
  }
  
  logCycle(level, message, data) {
    if (!this._shouldLog(level)) return;
    super.logCycle(level, message, data);
  }
  
  logPosition(level, message, data) {
    if (!this._shouldLog(level)) return;
    super.logPosition(level, message, data);
  }
  
  logMarket(level, message, data) {
    if (!this._shouldLog(level)) return;
    super.logMarket(level, message, data);
  }
  
  logStrategy(level, message, data) {
    if (!this._shouldLog(level)) return;
    super.logStrategy(level, message, data);
  }
  
  logExecution(level, message, data) {
    if (!this._shouldLog(level)) return;
    super.logExecution(level, message, data);
  }
  
  logDecision(level, message, data) {
    if (!this._shouldLog(level)) return;
    super.logDecision(level, message, data);
  }
  
  logData(level, message, data) {
    if (!this._shouldLog(level)) return;
    super.logData(level, message, data);
  }
}

/**
 * Create an R2-enabled logger for a specific component
 * @param {Object} options - Logger options
 * @param {string} options.component - Component name
 * @param {string} options.sessionId - Session ID for grouping logs
 * @param {string} options.symbol - Trading symbol for context (e.g., BTC/USD)
 * @param {string} options.exchange - Exchange name for context
 * @param {boolean} options.displayEnabled - Whether to output logs to console (default: true)
 * @param {boolean} options.r2Enabled - Whether to store logs in R2 (default: from environment)
 * @returns {MarketMakerR2Logger} - New logger instance
 */
export function createR2Logger(options = {}) {
  const component = options.component || 'unknown';
  
  // Create logger with component name and any additional options
  return new MarketMakerR2Logger({
    component,
    // Apply environment variables for R2 configuration
    loggingServiceUrl: process.env.LOGGING_SERVICE_URL,
    loggingServiceApiKey: process.env.LOGGING_SERVICE_API_KEY,
    r2Enabled: process.env.R2_LOGGING_ENABLED === 'true',
    ...options
  });
}

/**
 * Create an R2-enabled logger for a specific trading pair/strategy
 * @param {Object} options - Logger options 
 * @param {string} options.component - Component name
 * @param {string} options.sessionId - Session ID for grouping logs
 * @param {string} options.symbol - Trading symbol (e.g., BTC/USD)
 * @param {string} options.exchange - Exchange name
 * @param {string} options.strategy - Strategy name
 * @returns {MarketMakerR2Logger} - New logger instance
 */
export function createTradingR2Logger(options) {
  const requiredFields = ['component', 'sessionId', 'symbol'];
  
  for (const field of requiredFields) {
    if (!options[field]) {
      console.warn(`[R2LoggerFactory] Missing required field: ${field}`);
    }
  }
  
  return createR2Logger(options);
}

// Default service logger
export const serviceR2Logger = createR2Logger({ component: 'market-maker-service' });

export default createR2Logger;
