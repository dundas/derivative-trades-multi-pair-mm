import { BaseMarketDataProvider } from './BaseMarketDataProvider.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Test Market Data Provider that loads data from files for different market conditions
 */
export class TestMarketDataProvider extends BaseMarketDataProvider {
  /**
   * Create a new TestMarketDataProvider
   * @param {Object} options Configuration options
   * @param {string} [options.dataSource] Source of market data ('file', 'memory')
   * @param {string} [options.marketCondition] Market condition to load data for
   * @param {string} [options.basePath] Base path for market condition data
   */
  constructor(options = {}) {
    super(options);
    
    this.dataSource = options.dataSource || 'file';
    this.marketCondition = options.marketCondition || 'high_liquidity_normal_volatility';
    this.basePath = options.basePath || 
      `${process.cwd()}/src/services/market-maker/test-data/market-conditions`;
  }
  
  /**
   * Get order book data
   * @param {number} [depth=10] Depth of order book to retrieve
   * @returns {Promise<Object>} Order book data with bids and asks
   */
  async getOrderBook(depth = 10) {
    if (this.dataSource === 'file') {
      return this._getOrderBookFromFile(depth);
    } else if (this.dataSource === 'memory') {
      return this._getOrderBookFromMemory(depth);
    }
    throw new Error(`Unsupported data source: ${this.dataSource}`);
  }
  
  /**
   * Get recent trades data
   * @param {number} [limit=50] Number of trades to retrieve
   * @returns {Promise<Array>} Array of recent trades
   */
  async getTrades(limit = 50) {
    if (this.dataSource === 'file') {
      return this._getTradesFromFile(limit);
    } else if (this.dataSource === 'memory') {
      return this._getTradesFromMemory(limit);
    }
    throw new Error(`Unsupported data source: ${this.dataSource}`);
  }
  
  /**
   * Get OHLC (candle) data
   * @param {string} [interval='1h'] Time interval for OHLC data
   * @param {number} [limit=24] Number of candles to retrieve
   * @returns {Promise<Array>} Array of OHLC data
   */
  async getOHLC(interval = '1h', limit = 24) {
    if (this.dataSource === 'file') {
      return this._getOHLCFromFile(interval, limit);
    } else if (this.dataSource === 'memory') {
      return this._getOHLCFromMemory(interval, limit);
    }
    throw new Error(`Unsupported data source: ${this.dataSource}`);
  }
  
  /**
   * Get ticker data
   * @returns {Promise<Object>} Ticker data
   */
  async getTicker() {
    if (this.dataSource === 'file') {
      return this._getTickerFromFile();
    } else if (this.dataSource === 'memory') {
      return this._getTickerFromMemory();
    }
    throw new Error(`Unsupported data source: ${this.dataSource}`);
  }
  
  /**
   * Get order book data from file
   * @private
   */
  async _getOrderBookFromFile(depth) {
    try {
      const filePath = path.join(this.basePath, this.marketCondition, 'orderbook.json');
      
      // Check if data is already cached
      if (this.cache.orderbook) {
        return this._applyDepth(this.cache.orderbook, depth);
      }
      
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      
      // Cache the data
      this.cache.orderbook = data;
      
      return this._applyDepth(data, depth);
    } catch (error) {
      this.logger.error('Error loading order book from file:', error);
      throw error;
    }
  }
  
  /**
   * Apply depth limit to order book data
   * @private
   */
  _applyDepth(data, depth) {
    if (depth && depth > 0) {
      return {
        bids: data.bids.slice(0, depth),
        asks: data.asks.slice(0, depth),
        timestamp: data.timestamp || Date.now()
      };
    }
    return data;
  }
  
  /**
   * Get trades data from file
   * @private
   */
  async _getTradesFromFile(limit) {
    try {
      const filePath = path.join(this.basePath, this.marketCondition, 'trades.json');
      
      // Check if data is already cached
      if (this.cache.trades) {
        return this.cache.trades.slice(0, limit);
      }
      
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      
      // Cache the data
      this.cache.trades = data;
      
      return data.slice(0, limit);
    } catch (error) {
      this.logger.error('Error loading trades from file:', error);
      throw error;
    }
  }
  
  /**
   * Get OHLC data from file
   * @private
   */
  async _getOHLCFromFile(interval, limit) {
    try {
      const filePath = path.join(this.basePath, this.marketCondition, 'ohlc.json');
      
      // Check if data is already cached
      if (this.cache.ohlc && this.cache.ohlc[interval]) {
        return this.cache.ohlc[interval].slice(0, limit);
      }
      
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      
      // Initialize OHLC cache if needed
      if (!this.cache.ohlc) {
        this.cache.ohlc = {};
      }
      
      // Cache the data for this interval
      this.cache.ohlc[interval] = data[interval] || data['1h'] || [];
      
      return this.cache.ohlc[interval].slice(0, limit);
    } catch (error) {
      this.logger.error('Error loading OHLC data from file:', error);
      throw error;
    }
  }
  
  /**
   * Get ticker data from file
   * @private
   */
  async _getTickerFromFile() {
    try {
      const filePath = path.join(this.basePath, this.marketCondition, 'ticker.json');
      
      // Check if data is already cached
      if (this.cache.ticker) {
        return this.cache.ticker;
      }
      
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      
      // Cache the data
      this.cache.ticker = data;
      
      return data;
    } catch (error) {
      this.logger.error('Error loading ticker from file:', error);
      throw error;
    }
  }
  
  /**
   * Get order book data from memory
   * @private
   */
  _getOrderBookFromMemory(depth) {
    if (!this.cache.orderbook) {
      throw new Error('No order book data in memory cache');
    }
    
    return this._applyDepth(this.cache.orderbook, depth);
  }
  
  /**
   * Get trades data from memory
   * @private
   */
  _getTradesFromMemory(limit) {
    if (!this.cache.trades) {
      throw new Error('No trades data in memory cache');
    }
    
    return this.cache.trades.slice(0, limit);
  }
  
  /**
   * Get OHLC data from memory
   * @private
   */
  _getOHLCFromMemory(interval, limit) {
    if (!this.cache.ohlc || !this.cache.ohlc[interval]) {
      throw new Error(`No OHLC data for interval ${interval} in memory cache`);
    }
    
    return this.cache.ohlc[interval].slice(0, limit);
  }
  
  /**
   * Get ticker data from memory
   * @private
   */
  _getTickerFromMemory() {
    if (!this.cache.ticker) {
      throw new Error('No ticker data in memory cache');
    }
    
    return this.cache.ticker;
  }
  
  /**
   * Set data in memory cache
   * @param {string} type Type of data ('orderbook', 'trades', 'ohlc', 'ticker')
   * @param {*} data Data to cache
   * @param {string} [interval] Interval for OHLC data
   */
  setMemoryData(type, data, interval) {
    if (type === 'ohlc') {
      if (!this.cache.ohlc) {
        this.cache.ohlc = {};
      }
      this.cache.ohlc[interval || '1h'] = data;
    } else {
      this.cache[type] = data;
    }
  }
}

export default TestMarketDataProvider;
