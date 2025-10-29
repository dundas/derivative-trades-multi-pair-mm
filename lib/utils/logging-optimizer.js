/**
 * Market Maker Logging Optimizer
 * 
 * Provides utilities and configuration for optimizing market maker logging
 * to focus on essential information and reduce disk usage.
 * 
 * Key Principles:
 * 1. Real errors only in error logs
 * 2. Essential business data: balances, trades, decisions, settings
 * 3. Minimal raw data logging
 * 4. Performance-sensitive operations use debug level
 */

import { LoggerFactory } from './logger-factory.js';

/**
 * Essential logging configuration for production market maker
 * 
 * Automatically detects production environment and applies optimizations.
 * Single control: NODE_ENV=production enables all optimizations.
 */
export class EssentialLoggingConfig {
  constructor() {
    // Auto-detect production mode
    this.isProduction = process.env.NODE_ENV === 'production';
    this.logLevel = this.isProduction ? 'INFO' : (process.env.LOG_LEVEL || 'DEBUG');
    
    // Define what should be logged at each level in production
    this.config = {
      // ERROR: Only actual errors and critical failures
      error: {
        enabled: true,
        categories: [
          'actual_exceptions',      // Real JavaScript errors
          'connection_failures',    // WebSocket/API failures
          'order_failures',         // Failed trades
          'insufficient_funds',     // Trading blocked by funds
          'critical_business_logic' // Logic errors that affect trading
        ],
        excludePatterns: [
          '_DEBUG]',
          'Constructor',
          'OBBM_CONSTRUCTOR',
          'KWSA Constructor',
          'ORDERBOOK_DEBUG',
          'START_DEBUG'
        ]
      },
      
      // WARN: Recoverable issues that need attention
      warn: {
        enabled: true,
        categories: [
          'reconnection_events',    // WebSocket reconnects
          'rate_limiting',          // API rate limits
          'balance_warnings',       // Low balances
          'order_adjustments',      // Price/size adjustments
          'session_warnings'        // Session-level concerns
        ]
      },
      
      // INFO: Essential business events
      info: {
        enabled: true,
        categories: [
          'session_lifecycle',      // Session start/stop
          'trade_executions',       // Actual buy/sell orders
          'balance_changes',        // Balance updates from trades
          'trading_decisions',      // Final buy/sell/hold decisions
          'settings_changes',       // Configuration updates
          'connection_status',      // Initial connections only
          'position_changes'        // Position updates
        ],
        maxFrequency: this.isProduction ? {
          'balance_updates': 30000,     // Max once per 30 seconds in production
          'heartbeat_logs': 300000,     // Max once per 5 minutes in production
          'orderbook_stats': 60000      // Max once per minute in production
        } : {} // No throttling in development
      },
      
      // DEBUG: Detailed operational info (disabled in production automatically)
      debug: {
        enabled: !this.isProduction, // Automatically disabled in production
        categories: [
          'constructor_steps',      // Object initialization
          'orderbook_processing',   // Order book updates
          'memory_management',      // Memory operations
          'trading_loop_details',   // Trading loop internals
          'raw_api_responses'       // API response details
        ]
      }
    };
    
    // Frequency throttling to prevent log spam
    this.lastLogTime = new Map();
  }
  
  /**
   * Check if a log message should be allowed based on configuration
   * @param {string} level - Log level (error, warn, info, debug)
   * @param {string} message - Log message
   * @param {string} category - Log category (optional)
   * @returns {boolean} - Whether the log should be written
   */
  shouldLog(level, message, category = null) {
    const levelConfig = this.config[level.toLowerCase()];
    if (!levelConfig || !levelConfig.enabled) {
      return false;
    }
    
    // Check exclude patterns for error level
    if (level.toLowerCase() === 'error' && levelConfig.excludePatterns) {
      for (const pattern of levelConfig.excludePatterns) {
        if (message.includes(pattern)) {
          return false;
        }
      }
    }
    
    // Check frequency throttling
    if (category && levelConfig.maxFrequency && levelConfig.maxFrequency[category]) {
      const now = Date.now();
      const lastTime = this.lastLogTime.get(category) || 0;
      const minInterval = levelConfig.maxFrequency[category];
      
      if (now - lastTime < minInterval) {
        return false; // Too frequent, skip this log
      }
      
      this.lastLogTime.set(category, now);
    }
    
    return true;
  }
  
  /**
   * Create an optimized logger for market maker components
   * @param {string} component - Component name
   * @param {string} sessionId - Session ID
   * @returns {OptimizedLogger} - Wrapped logger with filtering
   */
  createOptimizedLogger(component, sessionId) {
    const baseLogger = LoggerFactory.createLogger({
      component,
      sessionId,
      // Use production minimal mode automatically
      productionMinimal: this.isProduction,
      // Set appropriate log level automatically
      logLevel: this.logLevel,
      fileLogging: true,
      fileOptions: {
        maxBufferSize: this.isProduction ? 25 : 100, // Smaller buffer in production
        flushInterval: this.isProduction ? 15000 : 5000, // Less frequent flushing in production
        // Auto-enable log rotation in production
        ...(this.isProduction && {
          useRotatingLogs: true,
          maxLogSize: 50 * 1024 * 1024, // 50MB
          maxLogFiles: 3,
          compression: true
        })
      }
    });
    
    return new OptimizedLogger(baseLogger, this);
  }
}

/**
 * Wrapper logger that applies essential logging configuration
 */
export class OptimizedLogger {
  constructor(baseLogger, config) {
    this.baseLogger = baseLogger;
    this.config = config;
    this.component = baseLogger.options?.component || 'unknown';
  }
  
  // Override error to filter out debug messages
  error(message, data) {
    if (!this.config.shouldLog('error', message)) {
      return; // Skip this log
    }
    this.baseLogger.error(message, data);
  }
  
  // Override warn with throttling
  warn(message, data, category = null) {
    if (!this.config.shouldLog('warn', message, category)) {
      return;
    }
    this.baseLogger.warn(message, data);
  }
  
  // Override info with throttling
  info(message, data, category = null) {
    if (!this.config.shouldLog('info', message, category)) {
      return;
    }
    this.baseLogger.info(message, data);
  }
  
  // Override debug (mostly disabled in production)
  debug(message, data, category = null) {
    if (!this.config.shouldLog('debug', message, category)) {
      return;
    }
    this.baseLogger.debug(message, data);
  }
  
  // Essential business event methods
  logTrade(order, result) {
    this.info(`[TRADE] ${order.side.toUpperCase()} ${order.amount} ${order.symbol} at ${order.price}`, {
      orderId: order.id,
      status: result.status,
      executedAmount: result.amount,
      executedPrice: result.price,
      fee: result.fee
    });
  }
  
  logBalanceChange(before, after, reason) {
    const changes = [];
    for (const [currency, afterBalance] of Object.entries(after)) {
      const beforeBalance = before[currency] || { free: 0, used: 0, total: 0 };
      if (Math.abs(afterBalance.total - beforeBalance.total) > 0.001) {
        changes.push({
          currency,
          before: beforeBalance.total,
          after: afterBalance.total,
          change: afterBalance.total - beforeBalance.total
        });
      }
    }
    
    if (changes.length > 0) {
      this.info(`[BALANCE] Balance changed: ${reason}`, { changes });
    }
  }
  
  logTradingDecision(decision, market, factors) {
    // Only log actual trading decisions, not intermediate calculations
    if (decision !== 'hold') {
      this.info(`[DECISION] ${decision.toUpperCase()}`, {
        symbol: market.symbol,
        price: market.price,
        signal: factors.signal,
        confidence: factors.confidence,
        reason: factors.primaryReason
      });
    }
  }
  
  logSessionStart(config) {
    this.info('[SESSION] Market maker session started', {
      symbol: config.tradingPair,
      mode: config.mode,
      budget: config.budget,
      duration: `${config.sessionLength/60000}min`,
      strategy: config.strategy
    });
  }
  
  logSessionEnd(stats) {
    this.info('[SESSION] Market maker session ended', {
      duration: stats.duration,
      totalTrades: stats.totalTrades,
      profitLoss: stats.profitLoss,
      finalBalance: stats.finalBalance,
      successRate: stats.successRate
    });
  }
  
  logActualError(error, context = {}) {
    // For real JavaScript errors and exceptions
    this.baseLogger.error(`[ACTUAL_ERROR] ${error.message}`, {
      stack: error.stack,
      name: error.name,
      context,
      timestamp: new Date().toISOString()
    });
  }
  
  // Pass through other base logger methods
  flush() { return this.baseLogger.flush(); }
  close() { return this.baseLogger.close(); }
  setLogLevel(level) { return this.baseLogger.setLogLevel(level); }
  createChild(childComponent) {
    const childLogger = this.baseLogger.createChild(childComponent);
    return new OptimizedLogger(childLogger, this.config);
  }
}

// Global instance for consistent configuration
export const essentialLoggingConfig = new EssentialLoggingConfig();

/**
 * Create an optimized logger for market maker components
 * @param {string} component - Component name
 * @param {string} sessionId - Session ID (optional)
 * @returns {OptimizedLogger} - Optimized logger instance
 */
export function createOptimizedLogger(component, sessionId = null) {
  return essentialLoggingConfig.createOptimizedLogger(component, sessionId);
}

/**
 * Helper to convert existing debug error logs to appropriate levels
 * @param {Object} logger - Existing logger
 * @param {string} message - Log message
 * @param {Object} data - Log data
 */
export function logDebugAsDebug(logger, message, data) {
  // Check if this is a debug message incorrectly logged as error
  const debugPatterns = ['_DEBUG]', 'Constructor', 'OBBM_CONSTRUCTOR', 'KWSA Constructor', 'ORDERBOOK_DEBUG'];
  
  for (const pattern of debugPatterns) {
    if (message.includes(pattern)) {
      // Convert to debug level
      logger.debug(message, data);
      return;
    }
  }
  
  // If not a debug message, log as error
  logger.error(message, data);
}

export default {
  EssentialLoggingConfig,
  OptimizedLogger,
  essentialLoggingConfig,
  createOptimizedLogger,
  logDebugAsDebug
};