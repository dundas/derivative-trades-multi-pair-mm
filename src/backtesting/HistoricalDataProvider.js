/**
 * HistoricalDataProvider
 *
 * Loads and provides historical market data for backtesting.
 * Supports loading from PostgreSQL, CSV files, and JSON.
 *
 * Based on Hummingbot's backtesting data provider
 * Reference: hummingbot/strategy_v2/backtesting/backtesting_data_provider.py
 */

import fs from 'fs';

// CSV parsing is optional - requires csv-parse package
let parse = null;
try {
  const csvParse = await import('csv-parse/sync');
  parse = csvParse.parse;
} catch (e) {
  // CSV parsing not available
}

/**
 * Historical tick data point
 */
class HistoricalTick {
  constructor({ timestamp, pair, orderBook, trades = [], fundingRate = null }) {
    this.timestamp = timestamp;
    this.pair = pair;
    this.orderBook = orderBook; // { bids: [[price, volume], ...], asks: [...] }
    this.trades = trades; // [{ price, volume, side, timestamp }, ...]
    this.fundingRate = fundingRate;
  }
}

/**
 * Historical data provider
 */
class HistoricalDataProvider {
  constructor() {
    this.data = new Map(); // pair -> sorted array of ticks
    this.currentIndices = new Map(); // pair -> current index
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Load data from JSON file
   * @param {string} filePath - Path to JSON file
   * @returns {Promise<number>} Number of ticks loaded
   */
  async loadFromJSON(filePath) {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    let tickCount = 0;

    for (const pair in data) {
      const ticks = data[pair].map(tickData => new HistoricalTick(tickData));

      // Sort by timestamp
      ticks.sort((a, b) => a.timestamp - b.timestamp);

      this.data.set(pair, ticks);
      this.currentIndices.set(pair, 0);
      tickCount += ticks.length;

      // Update time range
      if (ticks.length > 0) {
        const firstTime = ticks[0].timestamp;
        const lastTime = ticks[ticks.length - 1].timestamp;

        if (!this.startTime || firstTime < this.startTime) {
          this.startTime = firstTime;
        }
        if (!this.endTime || lastTime > this.endTime) {
          this.endTime = lastTime;
        }
      }
    }

    return tickCount;
  }

  /**
   * Load data from CSV file
   * @param {string} filePath - Path to CSV file
   * @param {string} pair - Trading pair
   * @returns {Promise<number>} Number of ticks loaded
   */
  async loadFromCSV(filePath, pair) {
    if (!parse) {
      throw new Error('CSV parsing not available. Install csv-parse package: npm install csv-parse');
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true
    });

    const ticks = records.map(record => {
      // Expected CSV format:
      // timestamp,bids,asks,trades,fundingRate
      // where bids/asks are JSON arrays
      return new HistoricalTick({
        timestamp: parseInt(record.timestamp),
        pair,
        orderBook: {
          bids: JSON.parse(record.bids || '[]'),
          asks: JSON.parse(record.asks || '[]')
        },
        trades: JSON.parse(record.trades || '[]'),
        fundingRate: record.fundingRate ? parseFloat(record.fundingRate) : null
      });
    });

    // Sort by timestamp
    ticks.sort((a, b) => a.timestamp - b.timestamp);

    this.data.set(pair, ticks);
    this.currentIndices.set(pair, 0);

    // Update time range
    if (ticks.length > 0) {
      const firstTime = ticks[0].timestamp;
      const lastTime = ticks[ticks.length - 1].timestamp;

      if (!this.startTime || firstTime < this.startTime) {
        this.startTime = firstTime;
      }
      if (!this.endTime || lastTime > this.endTime) {
        this.endTime = lastTime;
      }
    }

    return ticks.length;
  }

  /**
   * Load data directly from array
   * @param {string} pair - Trading pair
   * @param {Array} ticks - Array of tick data
   * @returns {number} Number of ticks loaded
   */
  loadFromArray(pair, ticks) {
    const historicalTicks = ticks.map(tickData => {
      if (tickData instanceof HistoricalTick) {
        return tickData;
      }
      return new HistoricalTick(tickData);
    });

    // Sort by timestamp
    historicalTicks.sort((a, b) => a.timestamp - b.timestamp);

    this.data.set(pair, historicalTicks);
    this.currentIndices.set(pair, 0);

    // Update time range
    if (historicalTicks.length > 0) {
      const firstTime = historicalTicks[0].timestamp;
      const lastTime = historicalTicks[historicalTicks.length - 1].timestamp;

      if (!this.startTime || firstTime < this.startTime) {
        this.startTime = firstTime;
      }
      if (!this.endTime || lastTime > this.endTime) {
        this.endTime = lastTime;
      }
    }

    return historicalTicks.length;
  }

  /**
   * Get tick at specific timestamp for a pair
   * @param {string} pair - Trading pair
   * @param {number} timestamp - Timestamp
   * @returns {HistoricalTick|null} Tick data or null
   */
  getTickAt(pair, timestamp) {
    const ticks = this.data.get(pair);
    if (!ticks) return null;

    // Binary search for closest tick at or before timestamp
    let left = 0;
    let right = ticks.length - 1;
    let result = null;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const tick = ticks[mid];

      if (tick.timestamp <= timestamp) {
        result = tick;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return result;
  }

  /**
   * Get next tick for a pair
   * @param {string} pair - Trading pair
   * @returns {HistoricalTick|null} Next tick or null if no more data
   */
  getNextTick(pair) {
    const ticks = this.data.get(pair);
    if (!ticks) return null;

    const index = this.currentIndices.get(pair) || 0;
    if (index >= ticks.length) return null;

    const tick = ticks[index];
    this.currentIndices.set(pair, index + 1);

    return tick;
  }

  /**
   * Get all ticks up to and including timestamp
   * @param {string} pair - Trading pair
   * @param {number} timestamp - Timestamp
   * @returns {Array<HistoricalTick>} Array of ticks
   */
  getTicksUpTo(pair, timestamp) {
    const ticks = this.data.get(pair);
    if (!ticks) return [];

    const result = [];
    const currentIndex = this.currentIndices.get(pair) || 0;

    for (let i = currentIndex; i < ticks.length; i++) {
      const tick = ticks[i];
      if (tick.timestamp > timestamp) break;

      result.push(tick);
      this.currentIndices.set(pair, i + 1);
    }

    return result;
  }

  /**
   * Get ticks for time range
   * @param {string} pair - Trading pair
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Array<HistoricalTick>} Array of ticks
   */
  getTicksInRange(pair, startTime, endTime) {
    const ticks = this.data.get(pair);
    if (!ticks) return [];

    return ticks.filter(tick =>
      tick.timestamp >= startTime && tick.timestamp <= endTime
    );
  }

  /**
   * Reset position in data stream
   * @param {string} pair - Trading pair (optional, resets all if not specified)
   */
  reset(pair = null) {
    if (pair) {
      this.currentIndices.set(pair, 0);
    } else {
      for (const p of this.data.keys()) {
        this.currentIndices.set(p, 0);
      }
    }
  }

  /**
   * Check if there is more data for a pair
   * @param {string} pair - Trading pair
   * @returns {boolean} True if more data available
   */
  hasMoreData(pair) {
    const ticks = this.data.get(pair);
    if (!ticks) return false;

    const index = this.currentIndices.get(pair) || 0;
    return index < ticks.length;
  }

  /**
   * Get pairs with data
   * @returns {Array<string>} Array of trading pairs
   */
  getPairs() {
    return Array.from(this.data.keys());
  }

  /**
   * Get data statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const stats = {
      pairs: this.getPairs().length,
      totalTicks: 0,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.endTime && this.startTime ? this.endTime - this.startTime : 0,
      pairStats: {}
    };

    for (const [pair, ticks] of this.data.entries()) {
      stats.totalTicks += ticks.length;
      stats.pairStats[pair] = {
        ticks: ticks.length,
        startTime: ticks[0]?.timestamp,
        endTime: ticks[ticks.length - 1]?.timestamp,
        currentIndex: this.currentIndices.get(pair) || 0
      };
    }

    return stats;
  }

  /**
   * Get progress percentage for a pair
   * @param {string} pair - Trading pair
   * @returns {number} Progress percentage (0-100)
   */
  getProgress(pair) {
    const ticks = this.data.get(pair);
    if (!ticks || ticks.length === 0) return 0;

    const index = this.currentIndices.get(pair) || 0;
    return (index / ticks.length) * 100;
  }

  /**
   * Get overall progress percentage
   * @returns {number} Progress percentage (0-100)
   */
  getOverallProgress() {
    const pairs = this.getPairs();
    if (pairs.length === 0) return 0;

    const totalProgress = pairs.reduce((sum, pair) => sum + this.getProgress(pair), 0);
    return totalProgress / pairs.length;
  }

  /**
   * Clear all data
   */
  clear() {
    this.data.clear();
    this.currentIndices.clear();
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Export data to JSON
   * @param {string} filePath - Output file path
   * @returns {Promise<void>}
   */
  async exportToJSON(filePath) {
    const exportData = {};

    for (const [pair, ticks] of this.data.entries()) {
      exportData[pair] = ticks.map(tick => ({
        timestamp: tick.timestamp,
        pair: tick.pair,
        orderBook: tick.orderBook,
        trades: tick.trades,
        fundingRate: tick.fundingRate
      }));
    }

    await fs.promises.writeFile(
      filePath,
      JSON.stringify(exportData, null, 2),
      'utf-8'
    );
  }
}

export {
  HistoricalDataProvider,
  HistoricalTick
};
