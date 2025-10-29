/**
 * BarrierConfig
 *
 * Configuration and data types for Triple Barrier Risk Management
 *
 * Based on Hummingbot's position executor triple barrier implementation
 * Reference: hummingbot/strategy_v2/executors/position_executor/data_types.py
 */

/**
 * Trailing Stop Configuration
 */
class TrailingStop {
  constructor({
    activationPrice,  // Decimal: profit % to activate trailing stop (e.g., 0.03 = 3%)
    trailingDelta     // Decimal: distance to trail behind peak (e.g., 0.01 = 1%)
  }) {
    this.activationPrice = activationPrice;
    this.trailingDelta = trailingDelta;
    this.highestPrice = null;      // Track highest price reached
    this.lowestPrice = null;       // Track lowest price reached (for shorts)
    this.activated = false;        // Whether trailing has activated
  }

  /**
   * Update trailing stop with new price
   * @param {number} currentPrice - Current market price
   * @param {number} entryPrice - Entry price of position
   * @param {string} side - 'LONG' or 'SHORT'
   * @returns {boolean} True if trailing stop should trigger
   */
  update(currentPrice, entryPrice, side) {
    const pnlPercent = side === 'LONG'
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;

    // Check if we should activate trailing
    if (!this.activated && pnlPercent >= this.activationPrice) {
      this.activated = true;
      this.highestPrice = side === 'LONG' ? currentPrice : null;
      this.lowestPrice = side === 'SHORT' ? currentPrice : null;
    }

    if (!this.activated) {
      return false;
    }

    // Update peak price
    if (side === 'LONG') {
      if (this.highestPrice === null || currentPrice > this.highestPrice) {
        this.highestPrice = currentPrice;
      }

      // Check if price fell below trailing threshold
      const trailingStopPrice = this.highestPrice * (1 - this.trailingDelta);
      return currentPrice <= trailingStopPrice;
    } else {
      // SHORT position
      if (this.lowestPrice === null || currentPrice < this.lowestPrice) {
        this.lowestPrice = currentPrice;
      }

      // Check if price rose above trailing threshold
      const trailingStopPrice = this.lowestPrice * (1 + this.trailingDelta);
      return currentPrice >= trailingStopPrice;
    }
  }

  /**
   * Get current trailing stop price
   * @param {string} side - 'LONG' or 'SHORT'
   * @returns {number|null}
   */
  getStopPrice(side) {
    if (!this.activated) {
      return null;
    }

    if (side === 'LONG') {
      return this.highestPrice ? this.highestPrice * (1 - this.trailingDelta) : null;
    } else {
      return this.lowestPrice ? this.lowestPrice * (1 + this.trailingDelta) : null;
    }
  }

  reset() {
    this.highestPrice = null;
    this.lowestPrice = null;
    this.activated = false;
  }
}

/**
 * Triple Barrier Configuration
 */
class TripleBarrierConfig {
  constructor({
    stopLoss = null,          // Decimal: max loss % (e.g., 0.02 = 2% loss)
    takeProfit = null,        // Decimal: target profit % (e.g., 0.05 = 5% profit)
    timeLimit = null,         // Seconds: max time in position (e.g., 300 = 5 minutes)
    trailingStop = null,      // TrailingStop object
    enabled = true            // Whether barriers are enabled
  } = {}) {
    this.stopLoss = stopLoss;
    this.takeProfit = takeProfit;
    this.timeLimit = timeLimit;
    this.trailingStop = trailingStop;
    this.enabled = enabled;

    // Validate configuration
    this.validate();
  }

  validate() {
    if (this.stopLoss !== null && this.stopLoss <= 0) {
      throw new Error('Stop loss must be positive');
    }

    if (this.takeProfit !== null && this.takeProfit <= 0) {
      throw new Error('Take profit must be positive');
    }

    if (this.timeLimit !== null && this.timeLimit <= 0) {
      throw new Error('Time limit must be positive');
    }

    if (this.stopLoss !== null && this.takeProfit !== null) {
      if (this.stopLoss >= this.takeProfit) {
        throw new Error('Stop loss should be less than take profit');
      }
    }
  }

  /**
   * Create adjusted config based on volatility factor
   * @param {number} volatilityFactor - Multiplier for barriers (e.g., 1.5 for 50% higher volatility)
   * @returns {TripleBarrierConfig}
   */
  adjustForVolatility(volatilityFactor) {
    return new TripleBarrierConfig({
      stopLoss: this.stopLoss ? this.stopLoss * volatilityFactor : null,
      takeProfit: this.takeProfit ? this.takeProfit * volatilityFactor : null,
      timeLimit: this.timeLimit,
      trailingStop: this.trailingStop ? new TrailingStop({
        activationPrice: this.trailingStop.activationPrice * volatilityFactor,
        trailingDelta: this.trailingStop.trailingDelta * volatilityFactor
      }) : null,
      enabled: this.enabled
    });
  }

  /**
   * Check if config has any barriers configured
   * @returns {boolean}
   */
  hasBarriers() {
    return this.enabled && (
      this.stopLoss !== null ||
      this.takeProfit !== null ||
      this.timeLimit !== null ||
      this.trailingStop !== null
    );
  }

  toJSON() {
    return {
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
      timeLimit: this.timeLimit,
      trailingStop: this.trailingStop ? {
        activationPrice: this.trailingStop.activationPrice,
        trailingDelta: this.trailingStop.trailingDelta
      } : null,
      enabled: this.enabled
    };
  }

  static fromJSON(json) {
    return new TripleBarrierConfig({
      stopLoss: json.stopLoss,
      takeProfit: json.takeProfit,
      timeLimit: json.timeLimit,
      trailingStop: json.trailingStop ? new TrailingStop(json.trailingStop) : null,
      enabled: json.enabled !== undefined ? json.enabled : true
    });
  }
}

/**
 * Barrier Status for a Position
 */
class BarrierStatus {
  constructor(position) {
    this.position = position;
    this.stopLossPrice = null;
    this.takeProfitPrice = null;
    this.expirationTime = null;
    this.trailingStopPrice = null;
    this.currentPrice = null;
    this.currentPnL = 0;
    this.currentPnLPercent = 0;
    this.hitStopLoss = false;
    this.hitTakeProfit = false;
    this.hitTimeLimit = false;
    this.hitTrailingStop = false;
  }

  /**
   * Get the triggered barrier (if any)
   * @returns {string|null} 'STOP_LOSS', 'TAKE_PROFIT', 'TIME_LIMIT', 'TRAILING_STOP', or null
   */
  getTriggeredBarrier() {
    if (this.hitStopLoss) return 'STOP_LOSS';
    if (this.hitTakeProfit) return 'TAKE_PROFIT';
    if (this.hitTrailingStop) return 'TRAILING_STOP';
    if (this.hitTimeLimit) return 'TIME_LIMIT';
    return null;
  }

  /**
   * Check if any barrier is hit
   * @returns {boolean}
   */
  isTriggered() {
    return this.hitStopLoss || this.hitTakeProfit || this.hitTimeLimit || this.hitTrailingStop;
  }

  toJSON() {
    return {
      position: this.position,
      stopLossPrice: this.stopLossPrice,
      takeProfitPrice: this.takeProfitPrice,
      expirationTime: this.expirationTime,
      trailingStopPrice: this.trailingStopPrice,
      currentPrice: this.currentPrice,
      currentPnL: this.currentPnL,
      currentPnLPercent: this.currentPnLPercent,
      hitStopLoss: this.hitStopLoss,
      hitTakeProfit: this.hitTakeProfit,
      hitTimeLimit: this.hitTimeLimit,
      hitTrailingStop: this.hitTrailingStop,
      triggeredBarrier: this.getTriggeredBarrier()
    };
  }
}

/**
 * Default barrier configurations for different pairs
 */
const DEFAULT_BARRIER_CONFIGS = {
  'BTC/USD': new TripleBarrierConfig({
    stopLoss: 0.02,        // 2% stop loss (low volatility)
    takeProfit: 0.05,      // 5% take profit
    timeLimit: 300,        // 5 minutes
    trailingStop: new TrailingStop({
      activationPrice: 0.03,  // Activate at 3% profit
      trailingDelta: 0.01     // Trail by 1%
    })
  }),

  'ETH/USD': new TripleBarrierConfig({
    stopLoss: 0.03,        // 3% stop loss (moderate volatility)
    takeProfit: 0.08,      // 8% take profit
    timeLimit: 600,        // 10 minutes
    trailingStop: new TrailingStop({
      activationPrice: 0.05,
      trailingDelta: 0.02
    })
  }),

  'XRP/USD': new TripleBarrierConfig({
    stopLoss: 0.025,       // 2.5% stop loss
    takeProfit: 0.06,      // 6% take profit
    timeLimit: 400,
    trailingStop: new TrailingStop({
      activationPrice: 0.04,
      trailingDelta: 0.015
    })
  }),

  'ADA/USD': new TripleBarrierConfig({
    stopLoss: 0.03,        // 3% stop loss (high volatility)
    takeProfit: 0.10,      // 10% take profit
    timeLimit: 600,
    trailingStop: new TrailingStop({
      activationPrice: 0.06,
      trailingDelta: 0.02
    })
  }),

  'LINK/USD': new TripleBarrierConfig({
    stopLoss: 0.03,        // 3% stop loss (high volatility)
    takeProfit: 0.10,      // 10% take profit
    timeLimit: 600,
    trailingStop: new TrailingStop({
      activationPrice: 0.06,
      trailingDelta: 0.02
    })
  }),

  // Default for unknown pairs
  'DEFAULT': new TripleBarrierConfig({
    stopLoss: 0.03,
    takeProfit: 0.07,
    timeLimit: 450,
    trailingStop: new TrailingStop({
      activationPrice: 0.04,
      trailingDelta: 0.015
    })
  })
};

export {
  TrailingStop,
  TripleBarrierConfig,
  BarrierStatus,
  DEFAULT_BARRIER_CONFIGS
};
