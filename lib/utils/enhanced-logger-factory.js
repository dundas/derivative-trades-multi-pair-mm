/**
 * Enhanced Market Maker Logger Factory
 * 
 * Creates customized loggers for different components of the Market Maker service
 * with configurable log levels, filtering, and optional Cloudflare R1 storage.
 */

import { TradingLogger } from './trading-logger.js';
import CloudflareR1Logger from './cloudflare-r1-logger.js';

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
 * Enhanced TradingLogger with log level filtering and optional R1 storage
 */
class EnhancedMarketMakerLogger extends TradingLogger {
  /**
   * Create a new EnhancedMarketMakerLogger
   * @param {Object} options - Logger options
   * @param {string} options.component - Component name
   * @param {string} options.sessionId - Session ID for organizing logs
   * @param {boolean} options.enableR1 - Whether to enable R1 logging
   * @param {Object} options.r1Options - Options for R1 logger
   */
  constructor(options = {}) {
    super(options);
    this.minLevel = getLogLevel();
    this.sessionId = options.sessionId || null;
    this.enableR1 = options.enableR1 || false;
    
    // Initialize R1 logger if enabled
    if (this.enableR1) {
      this.r1Logger = new CloudflareR1Logger({
        component: options.component,
        sessionId: this.sessionId,
        enabled: true,
        ...options.r1Options
      });
    }
  }
  
  // Check if the log level is high enough to be logged
  _shouldLog(level) {
    return LOG_LEVELS[level] >= this.minLevel;
  }
  
  // Override raw logging methods to add R1 logging
  _rawLog(...args) {
    console.log(...args);
    this._logToR1('INFO', args[0]);
  }
  
  _rawError(...args) {
    console.error(...args);
    this._logToR1('ERROR', args[0]);
  }
  
  _rawWarn(...args) {
    console.warn(...args);
    this._logToR1('WARN', args[0]);
  }
  
  _rawInfo(...args) {
    console.info(...args);
    this._logToR1('INFO', args[0]);
  }
  
  _rawDebug(...args) {
    console.debug(...args);
    this._logToR1('DEBUG', args[0]);
  }
  
  // Helper to log to R1 if enabled
  _logToR1(level, message, data) {
    if (this.enableR1 && this.r1Logger) {
      this.r1Logger.log(level, message, data);
    }
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
  
  // Override category methods with level filtering
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
  
  // Add settlement-specific logging
  logSettlement(level, message, data) {
    if (!this._shouldLog(level)) return;
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${this.options.component}][SETTLEMENT]`;
    if (data) {
      this._rawLog(`${prefix} ${message}`, data);
      this._logToR1(level, message, data);
    } else {
      this._rawLog(`${prefix} ${message}`);
      this._logToR1(level, message);
    }
  }
  
  // Dynamic log level update (for API endpoint)
  setLogLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      this.minLevel = LOG_LEVELS[level];
      return true;
    }
    return false;
  }
  
  getLogLevel() {
    return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === this.minLevel);
  }
  
  // Toggle R1 logging
  enableR1Logging(enable = true, options = {}) {
    if (enable && !this.r1Logger) {
      this.r1Logger = new CloudflareR1Logger({
        component: this.options.component,
        sessionId: this.sessionId,
        enabled: true,
        ...options
      });
      this.enableR1 = true;
    } else if (this.r1Logger) {
      this.r1Logger.setEnabled(enable);
      this.enableR1 = enable;
    }
    
    return this.enableR1;
  }
  
  // Flush R1 logs
  async flushR1Logs() {
    if (this.r1Logger) {
      return this.r1Logger.flush();
    }
    return false;
  }
  
  // Override close method to flush R1 logs
  async close() {
    if (this.r1Logger) {
      await this.r1Logger.close();
    }
    super.close();
  }
}

// Create loggers for different components
export const createEnhancedLogger = (options = {}) => {
  return new EnhancedMarketMakerLogger(options);
};

// Default service logger
export const enhancedServiceLogger = createEnhancedLogger({ component: 'market-maker-service' });

export default createEnhancedLogger;
