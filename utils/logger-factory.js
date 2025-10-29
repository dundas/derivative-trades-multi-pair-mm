/**
 * Market Maker Logger Factory
 * 
 * Creates customized loggers for different components of the Market Maker service
 * with configurable log levels and filtering.
 * 
 * Features:
 * - Configurable log levels (TRACE, DEBUG, INFO, WARN, ERROR)
 * - Local console logging during execution
 * - File-based logging to session-specific directories
 * - Production-optimized settings to minimize costs
 * - Categorized logs (orders, trades, etc.)
 */

import { TradingLogger } from '../lib/utils/trading-logger.js';
import fs from 'fs';
import path from 'path';


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
 * Dynamic logger that supports console and file logging
 * with configurable settings to optimize for production use.
 */
class MarketMakerLogger extends TradingLogger {
  constructor(options = {}) {
    super(options);
    
    // Store session and component info for structured logging
    this.sessionId = options.sessionId || null;
    this.symbol = options.symbol || null;
    
    // Configure log levels
    this.minLevel = options.logLevel ? LOG_LEVELS[options.logLevel.toUpperCase()] : getLogLevel();
    
    // Configure output destinations
    this.consoleEnabled = options.consoleEnabled !== undefined ? options.consoleEnabled : true;
    this.fileLogging = options.fileLogging !== undefined ? options.fileLogging : false;
    
    // Production settings
    this.productionMinimal = options.productionMinimal || false;
    
    // Initialize file logging if enabled
    this.fileOptions = options.fileOptions || {};
    this.fileLogBuffer = [];
    this.fileLogFlushInterval = null;
    
    if (this.fileLogging) {
      this._initFileLogging(this.fileOptions);
    }
  }
  
  
  /**
   * Check if the log level is high enough to be logged
   * @param {string} level - Log level
   * @returns {boolean} - Whether this log should be output
   * @private
   */
  _shouldLog(level) {
    // In production minimal mode, only log ERROR and WARN
    if (this.productionMinimal && 
        LOG_LEVELS[level] < LOG_LEVELS.WARN && 
        process.env.NODE_ENV === 'production') {
      return false;
    }
    return LOG_LEVELS[level] >= this.minLevel;
  }
  
  /**
   * Initialize file logging
   * @private
   * @param {Object} options File logging options
   */
  _initFileLogging(options = {}) {
    try {
      // Set up file logging options
      this.fileLogDir = options.logDir || path.join(process.cwd(), 'session-logs', this.sessionId || 'default');
      this.fileLogPath = options.logFile ? path.join(this.fileLogDir, options.logFile) : path.join(this.fileLogDir, 'market-maker.log');
      this.fileMaxBufferSize = options.maxBufferSize || 100;
      this.fileFlushIntervalMs = options.flushInterval || 5000;
      
      // Use rotating file transport if enabled
      if (process.env.USE_ROTATING_LOGS === 'true') {
        this.rotatingTransport = new RotatingFileTransport({
          filename: path.basename(this.fileLogPath),
          dirname: path.dirname(this.fileLogPath),
          maxSize: parseInt(process.env.MAX_LOG_SIZE_MB || '100') * 1024 * 1024,
          maxFiles: parseInt(process.env.MAX_LOG_FILES || '5'),
          zippedArchive: process.env.LOG_COMPRESSION_ENABLED !== 'false'
        });
      }
      
      // Debug log the file paths
      console.log(`[${this.options.component}] Initializing file logging with directory: ${this.fileLogDir}`);
      console.log(`[${this.options.component}] Log file path: ${this.fileLogPath}`);
      
      // Ensure log directory exists
      if (!fs.existsSync(this.fileLogDir)) {
        console.log(`[${this.options.component}] Creating log directory: ${this.fileLogDir}`);
        try {
          fs.mkdirSync(this.fileLogDir, { recursive: true });
          console.log(`[${this.options.component}] Successfully created log directory`);
        } catch (dirError) {
          console.error(`[${this.options.component}] Failed to create log directory: ${dirError.message}\n${dirError.stack}`);
          throw dirError;
        }
      } else {
        console.log(`[${this.options.component}] Log directory already exists`);
      }
      
      // Initialize empty log file
      if (!fs.existsSync(this.fileLogPath)) {
        console.log(`[${this.options.component}] Creating new log file: ${this.fileLogPath}`);
        const timestamp = new Date().toISOString();
        try {
          fs.writeFileSync(this.fileLogPath, `[${timestamp}] [INIT] Market Maker logging initialized for session ${this.sessionId}\n`);
          console.log(`[${this.options.component}] Successfully created log file`);
        } catch (fileError) {
          console.error(`[${this.options.component}] Failed to create log file: ${fileError.message}\n${fileError.stack}`);
          throw fileError;
        }
      } else {
        console.log(`[${this.options.component}] Log file already exists`);
      }
      
      // Set up flush interval
      this.fileLogFlushInterval = setInterval(() => {
        this._flushFileLogBuffer();
      }, this.fileFlushIntervalMs);
      
      if (this.consoleEnabled) {
        console.log(`[${this.options.component}] File logging initialized at ${this.fileLogPath}`);
      }
    } catch (error) {
      console.error(`[${this.options.component}] Failed to initialize file logging: ${error.message}`);
      console.error(`[${this.options.component}] Error stack: ${error.stack}`);
      this.fileLogging = false;
    }
  }
  
  /**
   * Flush the file log buffer to disk
   * @private
   */
  _flushFileLogBuffer() {
    if (!this.fileLogging || this.fileLogBuffer.length === 0) return;
    
    try {
      // Debug log the flush operation
      console.log(`[${this.options.component}] Flushing ${this.fileLogBuffer.length} log entries to ${this.fileLogPath}`);
      
      // Join all log entries with newlines
      const logContent = this.fileLogBuffer.join('\n') + '\n';
      
      // Append to log file
      try {
        fs.appendFileSync(this.fileLogPath, logContent);
        console.log(`[${this.options.component}] Successfully flushed logs to file`);
      } catch (appendError) {
        console.error(`[${this.options.component}] Failed to append to log file: ${appendError.message}\n${appendError.stack}`);
        throw appendError;
      }
      
      // Clear the buffer
      this.fileLogBuffer = [];
    } catch (error) {
      console.error(`[${this.options.component}] Error flushing file log buffer: ${error.message}`);
      console.error(`[${this.options.component}] Error stack: ${error.stack}`);
      
      // Try to recover by checking if the directory and file still exist
      try {
        if (!fs.existsSync(this.fileLogDir)) {
          console.error(`[${this.options.component}] Log directory no longer exists, attempting to recreate`);
          fs.mkdirSync(this.fileLogDir, { recursive: true });
        }
        
        // If file doesn't exist, recreate it
        if (!fs.existsSync(this.fileLogPath)) {
          console.error(`[${this.options.component}] Log file no longer exists, attempting to recreate`);
          const timestamp = new Date().toISOString();
          fs.writeFileSync(this.fileLogPath, `[${timestamp}] [RECOVERY] Market Maker logging recovered for session ${this.sessionId}\n`);
        }
      } catch (recoveryError) {
        console.error(`[${this.options.component}] Failed to recover logging: ${recoveryError.message}`);
      }
    }
  }
  
  /**
   * Send a log entry to the file log
   * @private
   * @param {string} level Log level
   * @param {string} message Log message
   * @param {Object} data Additional data
   */
  _sendToFileLog(level, message, data) {
    if (!this.fileLogging) return;
    
    try {
      // Format timestamp
      const timestamp = new Date().toISOString();
      
      // Clean the message
      let cleanMessage = message;
      if (typeof message === 'string') {
        // Remove timestamp and component prefixes if present
        cleanMessage = message.replace(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[.*?\]\s*/, '');
      }
      
      // Format data if present
      let dataStr = '';
      if (data) {
        try {
          dataStr = ' ' + JSON.stringify(data);
        } catch (e) {
          dataStr = ' [Object]';
        }
      }
      
      // Create log entry
      const logEntry = `[${timestamp}] [${this.options.component}] [${level}] ${cleanMessage}${dataStr}`;
      
      // Add to buffer
      this.fileLogBuffer.push(logEntry);
      
      // Flush if buffer exceeds max size
      if (this.fileLogBuffer.length >= this.fileMaxBufferSize) {
        this._flushFileLogBuffer();
      }
    } catch (error) {
      if (this.consoleEnabled) {
        console.error(`[${this.options.component}] Error sending log to file: ${error.message}`);
      }
    }
  }
  
  /**
   * Override the raw log methods to support multiple outputs
   * @private
   */
  _rawLog(...args) {
    if (this.consoleEnabled) {
      console.log(...args);
    }
    this._sendToFileLog('INFO', args[0], args[1]);
  }
  
  _rawError(...args) {
    if (this.consoleEnabled) {
      console.error(...args);
    }
    this._sendToFileLog('ERROR', args[0], args[1]);
  }
  
  _rawWarn(...args) {
    if (this.consoleEnabled) {
      console.warn(...args);
    }
    this._sendToFileLog('WARN', args[0], args[1]);
  }
  
  _rawInfo(...args) {
    if (this.consoleEnabled) {
      console.info(...args);
    }
    this._sendToFileLog('INFO', args[0], args[1]);
  }
  
  _rawDebug(...args) {
    if (this.consoleEnabled) {
      console.debug(...args);
    }
    this._sendToFileLog('DEBUG', args[0], args[1]);
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
  
  /**
   * Flush any pending logs (e.g., before shutdown)
   * @returns {Promise<void>}
   */
  async flush() {
    // Flush file logs
    if (this.fileLogging) {
      this._flushFileLogBuffer();
    }
  }
  
  
  /**
   * Close the logger and release resources
   * @returns {Promise<void>}
   */
  async close() {
    await this.flush();
    
    // Clean up file logging
    if (this.fileLogging && this.fileLogFlushInterval) {
      clearInterval(this.fileLogFlushInterval);
      this._flushFileLogBuffer();
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
  
  /**
   * Enable or disable console logging
   * @param {boolean} enabled - Whether console logging should be enabled
   */
  setConsoleLogging(enabled) {
    this.consoleEnabled = !!enabled;
  }
  
  
  /**
   * Create a child logger with the same settings but a different prefix
   * @param {string} childComponent Name of the child component
   * @returns {MarketMakerLogger} A new logger instance
   */
  createChild(childComponent) {
    return LoggerFactory.createLogger({
      ...this.options,
      component: `${this.options.component}:${childComponent}`,
      // Inherit parent settings
      logLevel: this.getLogLevel(),
      consoleEnabled: this.consoleEnabled,
      productionMinimal: this.productionMinimal,
      // Inherit file logging settings
      fileLogging: this.fileLogging,
      fileOptions: this.fileOptions
    });
  }
}


/**
 * LoggerFactory class for creating and managing loggers
 */
export class LoggerFactory {
  /**
   * Create a new logger instance
   * @param {Object} options - Logger options
   * @param {string} options.component - Component name (required)
   * @param {string} options.sessionId - Session ID for grouped logs
   * @param {string} options.symbol - Trading symbol
   * @param {string} options.logLevel - Log level (debug, info, warn, error)
   * @param {boolean} options.consoleEnabled - Whether to enable console logging
   * @param {boolean} options.productionMinimal - Use minimal logging in production
   * @param {number} options.maxBufferSize - Maximum number of logs to keep in memory
   * @returns {MarketMakerLogger} - Configured logger instance
   */
  static createLogger(options = {}) {
    if (!options.component) {
      throw new Error('Component name is required for logger');
    }
    
    // Create a new logger instance
    return new MarketMakerLogger(options);
  }
  
  /**
   * Get the default log level
   * @returns {string} - Current default log level
   */
  static getDefaultLogLevel() {
    return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === getLogLevel());
  }
  
  /**
   * Set the environment log level
   * @param {string} level - Log level
   * @returns {boolean} - Whether the operation succeeded
   */
  static setEnvironmentLogLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      process.env.LOG_LEVEL = level;
      return true;
    }
    return false;
  }
}

// Default service logger
export const serviceLogger = LoggerFactory.createLogger({ 
  component: 'market-maker-service',
  // In production, default to minimal logging
  productionMinimal: process.env.NODE_ENV === 'production'
});

// For backwards compatibility
export const createLogger = (component) => {
  console.warn('[DEPRECATED] Using createLogger function directly is deprecated. Use LoggerFactory.createLogger() instead.');
  return LoggerFactory.createLogger({ component });
};
