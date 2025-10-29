/**
 * OrderBookAnalyzer
 *
 * Advanced order book analysis for optimal trade execution.
 * Provides VWAP calculation, depth analysis, slippage estimation, and more.
 *
 * Based on Hummingbot's order_book.pyx implementation
 * Reference: hummingbot/core/data_type/order_book.pyx
 */

class OrderBookLevel {
  constructor(price, volume) {
    this.price = Number(price);
    this.volume = Number(volume);
  }
}

class OrderBookSnapshot {
  constructor(bids, asks, timestamp = Date.now()) {
    // Bids sorted descending (highest price first)
    this.bids = bids.sort((a, b) => b.price - a.price);
    // Asks sorted ascending (lowest price first)
    this.asks = asks.sort((a, b) => a.price - b.price);
    this.timestamp = timestamp;
  }

  get bestBid() {
    return this.bids.length > 0 ? this.bids[0].price : null;
  }

  get bestAsk() {
    return this.asks.length > 0 ? this.asks[0].price : null;
  }

  get midPrice() {
    const bb = this.bestBid;
    const ba = this.bestAsk;
    return (bb && ba) ? (bb + ba) / 2 : null;
  }

  get spread() {
    const bb = this.bestBid;
    const ba = this.bestAsk;
    return (bb && ba) ? ba - bb : null;
  }

  get spreadBps() {
    const spread = this.spread;
    const mid = this.midPrice;
    return (spread && mid) ? (spread / mid) * 10000 : null;
  }
}

class OrderBookAnalysisResult {
  constructor({
    vwap = null,
    totalVolume = 0,
    averagePrice = 0,
    priceImpact = 0,
    slippage = 0,
    worstPrice = null,
    levels = 0
  } = {}) {
    this.vwap = vwap;
    this.totalVolume = totalVolume;
    this.averagePrice = averagePrice;
    this.priceImpact = priceImpact;
    this.slippage = slippage;
    this.worstPrice = worstPrice;
    this.levels = levels;
  }
}

class OrderBookAnalyzer {
  /**
   * Calculate Volume-Weighted Average Price for target volume
   *
   * @param {OrderBookSnapshot} orderBook - Order book snapshot
   * @param {boolean} isBuy - True for buy (consume asks), false for sell (consume bids)
   * @param {number} targetVolume - Target volume to execute
   * @returns {OrderBookAnalysisResult} Analysis result with VWAP and metrics
   */
  static calculateVWAP(orderBook, isBuy, targetVolume) {
    if (targetVolume <= 0) {
      throw new Error('Target volume must be positive');
    }

    const levels = isBuy ? orderBook.asks : orderBook.bids;

    if (levels.length === 0) {
      return new OrderBookAnalysisResult();
    }

    let remainingVolume = targetVolume;
    let totalCost = 0;
    let totalVolume = 0;
    let levelsUsed = 0;
    let worstPrice = null;

    for (const level of levels) {
      if (remainingVolume <= 0) break;

      const volumeAtLevel = Math.min(remainingVolume, level.volume);
      totalCost += volumeAtLevel * level.price;
      totalVolume += volumeAtLevel;
      remainingVolume -= volumeAtLevel;
      levelsUsed++;
      worstPrice = level.price;
    }

    if (totalVolume === 0) {
      return new OrderBookAnalysisResult();
    }

    const vwap = totalCost / totalVolume;
    const referencePrice = isBuy ? orderBook.bestAsk : orderBook.bestBid;
    const priceImpact = referencePrice ? Math.abs((vwap - referencePrice) / referencePrice) : 0;
    const slippage = priceImpact * 100; // As percentage

    return new OrderBookAnalysisResult({
      vwap,
      totalVolume,
      averagePrice: vwap,
      priceImpact,
      slippage,
      worstPrice,
      levels: levelsUsed
    });
  }

  /**
   * Get the price at which target volume would execute
   *
   * @param {OrderBookSnapshot} orderBook - Order book snapshot
   * @param {boolean} isBuy - True for buy, false for sell
   * @param {number} targetVolume - Target volume
   * @returns {number|null} Execution price (last price needed to fill volume)
   */
  static getPriceForVolume(orderBook, isBuy, targetVolume) {
    const result = this.calculateVWAP(orderBook, isBuy, targetVolume);
    return result.worstPrice;
  }

  /**
   * Get the volume available at or better than target price
   *
   * @param {OrderBookSnapshot} orderBook - Order book snapshot
   * @param {boolean} isBuy - True for buy, false for sell
   * @param {number} targetPrice - Target price
   * @returns {number} Total volume available
   */
  static getVolumeForPrice(orderBook, isBuy, targetPrice) {
    const levels = isBuy ? orderBook.asks : orderBook.bids;

    let totalVolume = 0;

    for (const level of levels) {
      if (isBuy && level.price > targetPrice) break;
      if (!isBuy && level.price < targetPrice) break;

      totalVolume += level.volume;
    }

    return totalVolume;
  }

  /**
   * Calculate order book depth (volume) within price range
   *
   * @param {OrderBookSnapshot} orderBook - Order book snapshot
   * @param {boolean} isBuy - True for buy side (bids), false for sell side (asks)
   * @param {number} priceRange - Price range as percentage (e.g., 0.01 = 1%)
   * @returns {Object} Depth metrics
   */
  static calculateDepth(orderBook, isBuy, priceRange = 0.01) {
    const referencePrice = orderBook.midPrice;
    if (!referencePrice) {
      return { volume: 0, levels: 0, averagePrice: 0 };
    }

    const levels = isBuy ? orderBook.bids : orderBook.asks;
    const maxPrice = isBuy
      ? referencePrice * (1 - priceRange)
      : referencePrice * (1 + priceRange);

    let totalVolume = 0;
    let levelsInRange = 0;
    let weightedPriceSum = 0;

    for (const level of levels) {
      if (isBuy && level.price < maxPrice) break;
      if (!isBuy && level.price > maxPrice) break;

      totalVolume += level.volume;
      weightedPriceSum += level.price * level.volume;
      levelsInRange++;
    }

    const averagePrice = totalVolume > 0 ? weightedPriceSum / totalVolume : 0;

    return {
      volume: totalVolume,
      levels: levelsInRange,
      averagePrice,
      referencePrice,
      priceRange
    };
  }

  /**
   * Estimate slippage for target volume
   *
   * @param {OrderBookSnapshot} orderBook - Order book snapshot
   * @param {boolean} isBuy - True for buy, false for sell
   * @param {number} targetVolume - Target volume
   * @returns {Object} Slippage metrics
   */
  static estimateSlippage(orderBook, isBuy, targetVolume) {
    const result = this.calculateVWAP(orderBook, isBuy, targetVolume);
    const referencePrice = isBuy ? orderBook.bestAsk : orderBook.bestBid;

    if (!referencePrice || !result.vwap) {
      return {
        slippageBps: null,
        slippagePercent: null,
        priceImpact: null,
        executable: false
      };
    }

    const slippageAmount = isBuy
      ? result.vwap - referencePrice
      : referencePrice - result.vwap;

    const slippagePercent = (slippageAmount / referencePrice) * 100;
    const slippageBps = slippagePercent * 100;

    return {
      slippageBps,
      slippagePercent,
      priceImpact: result.priceImpact,
      expectedPrice: result.vwap,
      referencePrice,
      executable: result.totalVolume >= targetVolume
    };
  }

  /**
   * Calculate comprehensive order book metrics
   *
   * @param {OrderBookSnapshot} orderBook - Order book snapshot
   * @returns {Object} Comprehensive metrics
   */
  static calculateMetrics(orderBook) {
    const bidDepth1pct = this.calculateDepth(orderBook, true, 0.01);
    const askDepth1pct = this.calculateDepth(orderBook, false, 0.01);
    const bidDepth5pct = this.calculateDepth(orderBook, true, 0.05);
    const askDepth5pct = this.calculateDepth(orderBook, false, 0.05);

    return {
      bestBid: orderBook.bestBid,
      bestAsk: orderBook.bestAsk,
      midPrice: orderBook.midPrice,
      spread: orderBook.spread,
      spreadBps: orderBook.spreadBps,
      bidDepth1pct: bidDepth1pct.volume,
      askDepth1pct: askDepth1pct.volume,
      bidDepth5pct: bidDepth5pct.volume,
      askDepth5pct: askDepth5pct.volume,
      totalBidLevels: orderBook.bids.length,
      totalAskLevels: orderBook.asks.length,
      imbalance: this.calculateImbalance(orderBook),
      timestamp: orderBook.timestamp
    };
  }

  /**
   * Calculate order book imbalance
   *
   * @param {OrderBookSnapshot} orderBook - Order book snapshot
   * @param {number} depth - Number of levels to consider
   * @returns {number} Imbalance ratio (-1 to 1, positive = bullish)
   */
  static calculateImbalance(orderBook, depth = 10) {
    const bids = orderBook.bids.slice(0, depth);
    const asks = orderBook.asks.slice(0, depth);

    const bidVolume = bids.reduce((sum, level) => sum + level.volume, 0);
    const askVolume = asks.reduce((sum, level) => sum + level.volume, 0);

    const totalVolume = bidVolume + askVolume;
    if (totalVolume === 0) return 0;

    return (bidVolume - askVolume) / totalVolume;
  }

  /**
   * Find optimal order size given slippage tolerance
   *
   * @param {OrderBookSnapshot} orderBook - Order book snapshot
   * @param {boolean} isBuy - True for buy, false for sell
   * @param {number} maxSlippageBps - Maximum acceptable slippage in basis points
   * @returns {Object} Optimal order size and metrics
   */
  static findOptimalSize(orderBook, isBuy, maxSlippageBps) {
    const levels = isBuy ? orderBook.asks : orderBook.bids;
    const referencePrice = isBuy ? orderBook.bestAsk : orderBook.bestBid;

    if (!referencePrice || levels.length === 0) {
      return { volume: 0, price: null, slippageBps: null };
    }

    let cumulativeVolume = 0;
    let cumulativeCost = 0;

    for (const level of levels) {
      const volumeAtLevel = level.volume;
      const testVolume = cumulativeVolume + volumeAtLevel;
      const testCost = cumulativeCost + (volumeAtLevel * level.price);
      const vwap = testCost / testVolume;

      const slippage = Math.abs((vwap - referencePrice) / referencePrice) * 10000;

      if (slippage > maxSlippageBps) {
        // Return previous volume (before exceeding slippage)
        return {
          volume: cumulativeVolume,
          price: cumulativeVolume > 0 ? cumulativeCost / cumulativeVolume : referencePrice,
          slippageBps: cumulativeVolume > 0
            ? Math.abs(((cumulativeCost / cumulativeVolume) - referencePrice) / referencePrice) * 10000
            : 0
        };
      }

      cumulativeVolume = testVolume;
      cumulativeCost = testCost;
    }

    // All levels within tolerance
    return {
      volume: cumulativeVolume,
      price: cumulativeVolume > 0 ? cumulativeCost / cumulativeVolume : referencePrice,
      slippageBps: cumulativeVolume > 0
        ? Math.abs(((cumulativeCost / cumulativeVolume) - referencePrice) / referencePrice) * 10000
        : 0
    };
  }

  /**
   * Create OrderBookSnapshot from raw order book data
   *
   * @param {Array} bidsRaw - Array of [price, volume] arrays
   * @param {Array} asksRaw - Array of [price, volume] arrays
   * @param {number} timestamp - Timestamp
   * @returns {OrderBookSnapshot}
   */
  static createSnapshot(bidsRaw, asksRaw, timestamp = Date.now()) {
    const bids = bidsRaw.map(([price, volume]) => new OrderBookLevel(price, volume));
    const asks = asksRaw.map(([price, volume]) => new OrderBookLevel(price, volume));
    return new OrderBookSnapshot(bids, asks, timestamp);
  }
}

export {
  OrderBookAnalyzer,
  OrderBookSnapshot,
  OrderBookLevel,
  OrderBookAnalysisResult
};
