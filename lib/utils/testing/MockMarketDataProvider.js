/**
 * @fileoverview Mock Market Data Provider for testing the Adaptive Market Maker
 * 
 * This provider works with the MockExchangeAdapter to provide market data
 * without relying on file-based data sources.
 */

import { BaseMarketDataProvider } from '../data/BaseMarketDataProvider.js';

/**
 * Mock Market Data Provider that works with the MockExchangeAdapter
 */
export class MockMarketDataProvider extends BaseMarketDataProvider {
  /**
   * Create a new MockMarketDataProvider
   * @param {Object} options Configuration options
   * @param {Object} [options.exchange] MockExchangeAdapter instance
   * @param {string} [options.symbol] Trading symbol
   */
  constructor(options = {}) {
    super(options);
    
    this.exchange = options.exchange || options.providerOptions?.exchange;
    this.symbol = options.symbol || options.providerOptions?.symbol || 'BTC/USD';
    
    if (!this.exchange) {
      this.logger.warn('No exchange provided to MockMarketDataProvider, some functionality will be limited');
    }
    
    // Cache for market data
    this.cache = {
      orderBook: null,
      trades: [],
      ticker: null,
      ohlc: {}
    };
    
    // Last update timestamps
    this.lastUpdated = {
      orderBook: 0,
      trades: 0,
      ticker: 0,
      ohlc: {}
    };
    
    this.logger.debug('MockMarketDataProvider initialized', {
      symbol: this.symbol
    });
  }
  
  /**
   * Get order book data
   * @param {number} [depth=10] Depth of order book to retrieve
   * @returns {Promise<Object>} Order book data with bids and asks
   */
  async getOrderBook(depth = 10) {
    try {
      // Check if we need to refresh the cache (every 5 seconds)
      const now = Date.now();
      if (!this.cache.orderBook || now - this.lastUpdated.orderBook > 5000) {
        const orderBook = await this.exchange.getOrderBook(this.symbol, { depth });
        
        this.cache.orderBook = {
          bids: orderBook.bids.slice(0, depth),
          asks: orderBook.asks.slice(0, depth),
          timestamp: orderBook.timestamp || now
        };
        
        this.lastUpdated.orderBook = now;
      }
      
      return { ...this.cache.orderBook };
    } catch (error) {
      this.logger.error('Error getting order book', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Get recent trades data
   * @param {number} [limit=50] Number of trades to retrieve
   * @returns {Promise<Array>} Array of recent trades
   */
  async getTrades(limit = 50) {
    try {
      // Check if we need to refresh the cache (every 5 seconds)
      const now = Date.now();
      if (this.cache.trades.length === 0 || now - this.lastUpdated.trades > 5000) {
        const trades = await this.exchange.client.getTrades(this.symbol, { limit });
        
        this.cache.trades = trades;
        this.lastUpdated.trades = now;
      }
      
      return [...this.cache.trades].slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting trades', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Get ticker data
   * @returns {Promise<Object>} Ticker data
   */
  async getTicker() {
    try {
      // Check if we need to refresh the cache (every 5 seconds)
      const now = Date.now();
      if (!this.cache.ticker || now - this.lastUpdated.ticker > 5000) {
        const ticker = await this.exchange.getTicker(this.symbol);
        
        this.cache.ticker = ticker;
        this.lastUpdated.ticker = now;
      }
      
      return { ...this.cache.ticker };
    } catch (error) {
      this.logger.error('Error getting ticker', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Get OHLC data
   * @param {string} [interval='1h'] Time interval for OHLC data
   * @param {number} [since] Timestamp to get data since
   * @param {number} [limit=100] Number of candles to retrieve
   * @returns {Promise<Array>} Array of OHLC candles
   */
  async getOHLC(interval = '1h', since, limit = 100) {
    try {
      // Check if we need to refresh the cache (every hour)
      const now = Date.now();
      if (!this.cache.ohlc[interval] || now - (this.lastUpdated.ohlc[interval] || 0) > 3600000) {
        // Generate mock OHLC data if exchange is not available
        let ohlcData = [];
        
        if (this.exchange) {
          try {
            ohlcData = await this.exchange.getOHLC(this.symbol, {
              interval,
              since,
              limit
            });
          } catch (e) {
            this.logger.warn('Error getting OHLC from exchange, generating mock data', { error: e.message });
            ohlcData = this._generateMockOHLC(interval, since, limit);
          }
        } else {
          ohlcData = this._generateMockOHLC(interval, since, limit);
        }
        
        this.cache.ohlc[interval] = ohlcData;
        this.lastUpdated.ohlc[interval] = now;
      }
      
      // Ensure we have an array before slicing
      const data = Array.isArray(this.cache.ohlc[interval]) ? 
        this.cache.ohlc[interval] : [];
      
      return data.slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting OHLC data', { error: error.message });
      // Return empty array instead of throwing to avoid breaking the market maker
      return [];
    }
  }
  
  /**
   * Generate mock OHLC data
   * @param {string} interval Time interval for OHLC data
   * @param {number} since Timestamp to get data since
   * @param {number} limit Number of candles to retrieve
   * @returns {Array} Array of OHLC candles
   * @private
   */
  _generateMockOHLC(interval = '1h', since, limit = 100) {
    const now = Date.now();
    const sinceTm = since || now - (24 * 60 * 60 * 1000); // Default to last 24 hours
    
    // Get interval in milliseconds
    const intervalMs = this._getIntervalMilliseconds(interval);
    
    // Generate mock OHLC data based on the current market condition
    const basePrice = this.symbol === 'BTC/USD' ? 40000 : 2800;
    const volatility = 0.3; // Default volatility
    
    const ohlcData = [];
    let lastClose = basePrice;
    
    for (let i = 0; i < limit; i++) {
      const timestamp = sinceTm + (i * intervalMs);
      const volatilityFactor = volatility * basePrice * 0.01;
      
      // Generate random price movements based on volatility
      const open = lastClose;
      const high = open + (Math.random() * volatilityFactor);
      const low = open - (Math.random() * volatilityFactor);
      const close = low + (Math.random() * (high - low));
      
      // Generate random volume
      const volume = 1000 * (Math.random() + 0.5);
      
      ohlcData.push([
        timestamp,
        open,
        high,
        low,
        close,
        volume
      ]);
      
      lastClose = close;
    }
    
    this.logger.debug('Generated mock OHLC data', {
      interval,
      count: ohlcData.length
    });
    
    return ohlcData;
  }
  
  /**
   * Convert interval string to milliseconds
   * @param {string} interval Interval string (e.g., '1h', '15m', '1d')
   * @returns {number} Milliseconds
   * @private
   */
  _getIntervalMilliseconds(interval) {
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1));
    
    switch (unit) {
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      case 'w':
        return value * 7 * 24 * 60 * 60 * 1000;
      default:
        return 60 * 60 * 1000; // Default to 1 hour
    }
  }
  
  /**
   * Get market metrics
   * @returns {Promise<Object>} Market metrics data
   */
  async getMarketMetrics() {
    try {
      const orderBook = await this.getOrderBook(10);
      const trades = await this.getTrades(100);
      const ticker = await this.getTicker();
      const ohlcData = await this.getOHLC('1h', null, 24);
      
      // Calculate liquidity from order book
      let liquidity = 0;
      if (orderBook && orderBook.bids && orderBook.asks) {
        const bidVolume = orderBook.bids.reduce((sum, [price, amount]) => sum + amount, 0);
        const askVolume = orderBook.asks.reduce((sum, [price, amount]) => sum + amount, 0);
        liquidity = bidVolume + askVolume;
      }
      
      // Calculate volatility from OHLC data
      let volatility = 0;
      if (ohlcData && ohlcData.length > 0) {
        const returns = [];
        for (let i = 1; i < ohlcData.length; i++) {
          const prevClose = ohlcData[i - 1][4];
          const currClose = ohlcData[i][4];
          returns.push((currClose - prevClose) / prevClose);
        }
        
        if (returns.length > 0) {
          const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
          const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
          volatility = Math.sqrt(variance);
        }
      }
      
      // Calculate trades per minute
      let tradesPerMinute = 0;
      if (trades && trades.length > 0) {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        const recentTrades = trades.filter(trade => trade.timestamp >= oneMinuteAgo);
        tradesPerMinute = recentTrades.length;
      }
      
      // Get market condition from exchange
      const marketCondition = this.exchange.getMarketCondition(this.symbol);
      
      // If we have a market condition from the exchange, use those values
      if (marketCondition) {
        liquidity = marketCondition.liquidity || liquidity;
        volatility = marketCondition.volatility || volatility;
        tradesPerMinute = marketCondition.tradesPerMinute || tradesPerMinute;
      }
      
      return {
        liquidity,
        volatility,
        tradesPerMinute,
        spread: ticker ? (ticker.ask - ticker.bid) / ticker.bid : 0,
        lastPrice: ticker ? ticker.last : 0,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error('Error getting market metrics', { error: error.message });
      throw error;
    }
  }
}

export default MockMarketDataProvider;
