/**
 * Essential Market Maker Wrapper
 * 
 * Wraps the AdaptiveMarketMakerV2 with optimized logging configuration
 * to reduce log file sizes and focus on essential business information.
 */

import { AdaptiveMarketMakerV2 } from '../AdaptiveMarketMakerV2.js';
import { createOptimizedLogger } from './logging-optimizer.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load essential logging configuration
const essentialConfigPath = path.join(__dirname, '..', 'config', 'essential-logging.env');
dotenv.config({ path: essentialConfigPath });

/**
 * Enhanced Market Maker with Essential Logging
 */
export class EssentialMarketMaker extends AdaptiveMarketMakerV2 {
  constructor(config) {
    // Create optimized logger for the session
    const optimizedLogger = createOptimizedLogger('MarketMaker', config.sessionId);
    
    // Replace the logger in config
    const enhancedConfig = {
      ...config,
      logger: optimizedLogger
    };
    
    super(enhancedConfig);
    
    // Store essential logging state
    this.essentialLogging = {
      lastBalanceLog: 0,
      lastDecisionLog: 0,
      tradeCount: 0,
      sessionStartTime: Date.now(),
      lastTradeTime: null
    };
    
    // Override high-frequency logging methods
    this._setupEssentialLogging();
  }
  
  /**
   * Set up essential logging overrides
   * @private
   */
  _setupEssentialLogging() {
    // Override the orderbook update handler to reduce logging
    const originalHandleOrderBookUpdate = this._handleOrderBookUpdate.bind(this);
    this._handleOrderBookUpdate = (orderBook) => {
      // Only log orderbook updates if they result in trading decisions
      const result = originalHandleOrderBookUpdate(orderBook);
      
      // Log orderbook stats periodically (every 60 seconds max)
      const now = Date.now();
      const throttle = parseInt(process.env.MM_ORDERBOOK_LOG_THROTTLE || '60') * 1000;
      
      if (!this._lastOrderbookLog || (now - this._lastOrderbookLog > throttle)) {
        this.logger.info('[ORDERBOOK] Update processed', {
          symbol: orderBook?.symbol,
          bestBid: orderBook?.bids?.[0]?.price,
          bestAsk: orderBook?.asks?.[0]?.price,
          spread: this._calculateSpread(orderBook),
          timestamp: orderBook?.timestamp
        });
        this._lastOrderbookLog = now;
      }
      
      return result;
    };
  }
  
  /**
   * Log essential trade information
   * @param {Object} order - Order details
   * @param {Object} result - Execution result
   */
  logEssentialTrade(order, result) {
    this.essentialLogging.tradeCount++;
    this.essentialLogging.lastTradeTime = Date.now();
    
    this.logger.info('[TRADE_EXECUTION]', {
      tradeNumber: this.essentialLogging.tradeCount,
      side: order.side.toUpperCase(),
      amount: order.amount,
      symbol: order.symbol,
      price: result.price || order.price,
      status: result.status,
      fee: result.fee,
      executedAmount: result.amount,
      orderId: order.id,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Log essential balance changes
   * @param {Object} balanceChange - Balance change details
   */
  logEssentialBalance(balanceChange) {
    const now = Date.now();
    const throttle = parseInt(process.env.MM_BALANCE_LOG_THROTTLE || '30') * 1000;
    
    // Throttle balance logging
    if (now - this.essentialLogging.lastBalanceLog < throttle) {
      return;
    }
    
    this.logger.info('[BALANCE_UPDATE]', {
      reason: balanceChange.reason,
      changes: balanceChange.changes,
      totalValue: balanceChange.totalValue,
      availableBalance: balanceChange.availableBalance,
      timestamp: new Date().toISOString()
    });
    
    this.essentialLogging.lastBalanceLog = now;
  }
  
  /**
   * Log trading decisions (only final decisions, not analysis)
   * @param {Object} decision - Trading decision
   */
  logEssentialDecision(decision) {
    // Only log non-hold decisions to reduce noise
    if (decision.action !== 'hold') {
      this.logger.info('[TRADING_DECISION]', {
        action: decision.action.toUpperCase(),
        symbol: decision.symbol,
        price: decision.price,
        amount: decision.amount,
        confidence: decision.confidence,
        reason: decision.reason,
        marketConditions: {
          spread: decision.spread,
          volume: decision.volume,
          trend: decision.trend
        },
        timestamp: new Date().toISOString()
      });
    }
    
    this.essentialLogging.lastDecisionLog = Date.now();
  }
  
  /**
   * Log session summary at the end
   */
  logSessionSummary() {
    const sessionDuration = Date.now() - this.essentialLogging.sessionStartTime;
    
    this.logger.info('[SESSION_SUMMARY]', {
      sessionId: this.sessionId,
      duration: `${Math.round(sessionDuration / 60000)}min`,
      totalTrades: this.essentialLogging.tradeCount,
      lastTradeTime: this.essentialLogging.lastTradeTime,
      symbol: this.tradingPair,
      finalBalance: this.balances,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Calculate spread for logging
   * @private
   */
  _calculateSpread(orderBook) {
    if (!orderBook?.bids?.[0] || !orderBook?.asks?.[0]) {
      return null;
    }
    
    const bestBid = orderBook.bids[0].price;
    const bestAsk = orderBook.asks[0].price;
    const spread = ((bestAsk - bestBid) / bestBid * 100).toFixed(4);
    
    return `${spread}%`;
  }
  
  /**
   * Override stop method to log session summary
   */
  async stop() {
    try {
      this.logSessionSummary();
      await super.stop();
      
      // Flush logs before shutdown
      await this.logger.flush();
    } catch (error) {
      this.logger.error('[SESSION_STOP_ERROR]', {
        error: error.message,
        stack: error.stack
      });
    }
  }
}

/**
 * Factory function to create an essential market maker
 * @param {Object} config - Market maker configuration
 * @returns {EssentialMarketMaker} - Enhanced market maker instance
 */
export function createEssentialMarketMaker(config) {
  // Log the creation with essential config only
  const logger = createOptimizedLogger('MarketMaker-Factory', config.sessionId);
  
  logger.info('[MARKET_MAKER_CREATION]', {
    sessionId: config.sessionId,
    symbol: config.tradingPair,
    budget: config.budget,
    mode: config.mode || 'live',
    sessionLength: `${config.sessionLength/60000}min`,
    essentialLoggingEnabled: true,
    timestamp: new Date().toISOString()
  });
  
  return new EssentialMarketMaker(config);
}

export default {
  EssentialMarketMaker,
  createEssentialMarketMaker
};