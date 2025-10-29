/**
 * TripleBarrierManager
 *
 * Manages triple barrier risk management for positions:
 * - Stop Loss: Exit if position loses X%
 * - Take Profit: Exit if position gains Y%
 * - Time Limit: Exit after Z seconds
 * - Trailing Stop: Lock in profits as price moves favorably
 *
 * Based on Hummingbot's position executor implementation
 * Reference: hummingbot/strategy_v2/executors/position_executor/position_executor.py
 */

import {
  TripleBarrierConfig,
  BarrierStatus,
  TrailingStop,
  DEFAULT_BARRIER_CONFIGS
} from './BarrierConfig.js';

// Simple console logger as fallback
const createDefaultLogger = () => ({
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
});

class TripleBarrierManager {
  constructor(options = {}) {
    this.logger = options.logger || createDefaultLogger();

    // Map of positionId -> { config, status, entryTime, trailingStop }
    this.monitoredPositions = new Map();

    // Default configuration
    this.defaultConfig = options.defaultConfig || DEFAULT_BARRIER_CONFIGS['DEFAULT'];

    // Pair-specific configurations
    this.pairConfigs = new Map(Object.entries(DEFAULT_BARRIER_CONFIGS));

    // Callbacks
    this.onBarrierHit = options.onBarrierHit || null;

    // Statistics
    this.stats = {
      stopLossCount: 0,
      takeProfitCount: 0,
      timeLimitCount: 0,
      trailingStopCount: 0,
      totalExits: 0
    };
  }

  /**
   * Add a position to monitor
   * @param {Object} position - Position object
   * @param {TripleBarrierConfig} config - Barrier configuration (optional)
   */
  addPosition(position, config = null) {
    if (!position.id) {
      throw new Error('Position must have an id');
    }

    if (!position.entryPrice || !position.side || !position.pair) {
      throw new Error('Position must have entryPrice, side, and pair');
    }

    // Get config for this pair (or default)
    const barrierConfig = config || this.getConfigForPair(position.pair);

    if (!barrierConfig.hasBarriers()) {
      this.logger.warn(`No barriers configured for position ${position.id}`);
      return;
    }

    // Create monitoring entry
    const monitorEntry = {
      position,
      config: barrierConfig,
      entryTime: position.entryTime || Date.now(),
      trailingStop: barrierConfig.trailingStop ? new TrailingStop({
        activationPrice: barrierConfig.trailingStop.activationPrice,
        trailingDelta: barrierConfig.trailingStop.trailingDelta
      }) : null
    };

    this.monitoredPositions.set(position.id, monitorEntry);

    this.logger.info(`Added position ${position.id} to barrier monitoring`, {
      positionId: position.id,
      pair: position.pair,
      side: position.side,
      entryPrice: position.entryPrice,
      config: barrierConfig.toJSON()
    });
  }

  /**
   * Remove a position from monitoring
   * @param {string} positionId - Position ID
   */
  removePosition(positionId) {
    if (this.monitoredPositions.has(positionId)) {
      this.monitoredPositions.delete(positionId);
      this.logger.info(`Removed position ${positionId} from barrier monitoring`);
    }
  }

  /**
   * Update price and check barriers for a position
   * @param {string} positionId - Position ID
   * @param {number} currentPrice - Current market price
   * @returns {BarrierStatus} Barrier status
   */
  checkPosition(positionId, currentPrice) {
    const entry = this.monitoredPositions.get(positionId);
    if (!entry) {
      throw new Error(`Position ${positionId} not found in monitoring`);
    }

    const { position, config, entryTime, trailingStop } = entry;
    const status = new BarrierStatus(position);

    // Calculate current P&L
    const pnl = this.calculatePnL(position.entryPrice, currentPrice, position.side, position.amount);
    const pnlPercent = this.calculatePnLPercent(position.entryPrice, currentPrice, position.side);

    status.currentPrice = currentPrice;
    status.currentPnL = pnl;
    status.currentPnLPercent = pnlPercent;

    // Check Stop Loss
    if (config.stopLoss !== null) {
      status.stopLossPrice = this.calculateStopLossPrice(position.entryPrice, position.side, config.stopLoss);

      if (position.side === 'LONG') {
        status.hitStopLoss = currentPrice <= status.stopLossPrice;
      } else {
        status.hitStopLoss = currentPrice >= status.stopLossPrice;
      }
    }

    // Check Take Profit
    if (config.takeProfit !== null) {
      status.takeProfitPrice = this.calculateTakeProfitPrice(position.entryPrice, position.side, config.takeProfit);

      if (position.side === 'LONG') {
        status.hitTakeProfit = currentPrice >= status.takeProfitPrice;
      } else {
        status.hitTakeProfit = currentPrice <= status.takeProfitPrice;
      }
    }

    // Check Time Limit
    if (config.timeLimit !== null) {
      const elapsedSeconds = (Date.now() - entryTime) / 1000;
      status.expirationTime = entryTime + (config.timeLimit * 1000);
      status.hitTimeLimit = elapsedSeconds >= config.timeLimit;
    }

    // Check Trailing Stop
    if (trailingStop) {
      status.hitTrailingStop = trailingStop.update(currentPrice, position.entryPrice, position.side);
      status.trailingStopPrice = trailingStop.getStopPrice(position.side);
    }

    // If any barrier is hit, trigger callback
    if (status.isTriggered()) {
      this.handleBarrierHit(positionId, status);
    }

    return status;
  }

  /**
   * Check all monitored positions
   * @param {Object} currentPrices - Map of pair -> current price
   * @returns {Array} Array of triggered barrier statuses
   */
  checkAllPositions(currentPrices) {
    const triggeredStatuses = [];

    for (const [positionId, entry] of this.monitoredPositions) {
      const { position } = entry;
      const currentPrice = currentPrices[position.pair];

      if (currentPrice === undefined) {
        this.logger.warn(`No price data for ${position.pair}`);
        continue;
      }

      try {
        const status = this.checkPosition(positionId, currentPrice);
        if (status.isTriggered()) {
          triggeredStatuses.push(status);
        }
      } catch (error) {
        this.logger.error(`Error checking position ${positionId}`, { error: error.message });
      }
    }

    return triggeredStatuses;
  }

  /**
   * Handle barrier hit
   * @param {string} positionId - Position ID
   * @param {BarrierStatus} status - Barrier status
   */
  handleBarrierHit(positionId, status) {
    const barrier = status.getTriggeredBarrier();

    this.logger.info(`Barrier hit for position ${positionId}`, {
      positionId,
      barrier,
      currentPrice: status.currentPrice,
      pnl: status.currentPnL,
      pnlPercent: (status.currentPnLPercent * 100).toFixed(2) + '%'
    });

    // Update statistics
    switch (barrier) {
      case 'STOP_LOSS':
        this.stats.stopLossCount++;
        break;
      case 'TAKE_PROFIT':
        this.stats.takeProfitCount++;
        break;
      case 'TIME_LIMIT':
        this.stats.timeLimitCount++;
        break;
      case 'TRAILING_STOP':
        this.stats.trailingStopCount++;
        break;
    }
    this.stats.totalExits++;

    // Call callback if provided
    if (this.onBarrierHit) {
      this.onBarrierHit(positionId, status);
    }
  }

  /**
   * Calculate P&L for a position
   * @param {number} entryPrice - Entry price
   * @param {number} currentPrice - Current price
   * @param {string} side - 'LONG' or 'SHORT'
   * @param {number} amount - Position size
   * @returns {number} P&L in quote currency
   */
  calculatePnL(entryPrice, currentPrice, side, amount) {
    if (side === 'LONG') {
      return (currentPrice - entryPrice) * amount;
    } else {
      return (entryPrice - currentPrice) * amount;
    }
  }

  /**
   * Calculate P&L percentage
   * @param {number} entryPrice - Entry price
   * @param {number} currentPrice - Current price
   * @param {string} side - 'LONG' or 'SHORT'
   * @returns {number} P&L as decimal (e.g., 0.05 = 5%)
   */
  calculatePnLPercent(entryPrice, currentPrice, side) {
    if (side === 'LONG') {
      return (currentPrice - entryPrice) / entryPrice;
    } else {
      return (entryPrice - currentPrice) / entryPrice;
    }
  }

  /**
   * Calculate stop loss price
   * @param {number} entryPrice - Entry price
   * @param {string} side - 'LONG' or 'SHORT'
   * @param {number} stopLossPercent - Stop loss as decimal (e.g., 0.02 = 2%)
   * @returns {number} Stop loss price
   */
  calculateStopLossPrice(entryPrice, side, stopLossPercent) {
    if (side === 'LONG') {
      return entryPrice * (1 - stopLossPercent);
    } else {
      return entryPrice * (1 + stopLossPercent);
    }
  }

  /**
   * Calculate take profit price
   * @param {number} entryPrice - Entry price
   * @param {string} side - 'LONG' or 'SHORT'
   * @param {number} takeProfitPercent - Take profit as decimal (e.g., 0.05 = 5%)
   * @returns {number} Take profit price
   */
  calculateTakeProfitPrice(entryPrice, side, takeProfitPercent) {
    if (side === 'LONG') {
      return entryPrice * (1 + takeProfitPercent);
    } else {
      return entryPrice * (1 - takeProfitPercent);
    }
  }

  /**
   * Get configuration for a pair
   * @param {string} pair - Trading pair
   * @returns {TripleBarrierConfig}
   */
  getConfigForPair(pair) {
    return this.pairConfigs.get(pair) || this.defaultConfig;
  }

  /**
   * Set configuration for a pair
   * @param {string} pair - Trading pair
   * @param {TripleBarrierConfig} config - Barrier configuration
   */
  setConfigForPair(pair, config) {
    this.pairConfigs.set(pair, config);
    this.logger.info(`Updated barrier config for ${pair}`, config.toJSON());
  }

  /**
   * Get status for all monitored positions
   * @param {Object} currentPrices - Map of pair -> current price
   * @returns {Array} Array of barrier statuses
   */
  getAllStatuses(currentPrices) {
    const statuses = [];

    for (const [positionId, entry] of this.monitoredPositions) {
      const { position } = entry;
      const currentPrice = currentPrices[position.pair];

      if (currentPrice !== undefined) {
        try {
          const status = this.checkPosition(positionId, currentPrice);
          statuses.push(status);
        } catch (error) {
          this.logger.error(`Error getting status for ${positionId}`, { error: error.message });
        }
      }
    }

    return statuses;
  }

  /**
   * Get statistics
   * @returns {Object} Statistics object
   */
  getStatistics() {
    return {
      ...this.stats,
      activePositions: this.monitoredPositions.size,
      stopLossRate: this.stats.totalExits > 0
        ? (this.stats.stopLossCount / this.stats.totalExits * 100).toFixed(2) + '%'
        : 'N/A',
      takeProfitRate: this.stats.totalExits > 0
        ? (this.stats.takeProfitCount / this.stats.totalExits * 100).toFixed(2) + '%'
        : 'N/A'
    };
  }

  /**
   * Reset statistics
   */
  resetStatistics() {
    this.stats = {
      stopLossCount: 0,
      takeProfitCount: 0,
      timeLimitCount: 0,
      trailingStopCount: 0,
      totalExits: 0
    };
  }

  /**
   * Get summary report
   * @returns {Object} Summary report
   */
  getSummary() {
    return {
      monitoredPositions: this.monitoredPositions.size,
      statistics: this.getStatistics(),
      positions: Array.from(this.monitoredPositions.entries()).map(([id, entry]) => ({
        id,
        pair: entry.position.pair,
        side: entry.position.side,
        entryPrice: entry.position.entryPrice,
        entryTime: entry.entryTime,
        config: entry.config.toJSON()
      }))
    };
  }
}

export default TripleBarrierManager;
