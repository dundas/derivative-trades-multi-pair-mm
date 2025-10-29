/**
 * Base Market Data Provider
 * 
 * Abstract base class for all market data providers. Implements common functionality
 * and defines the interface that exchange-specific providers must implement.
 */
export class BaseMarketDataProvider {
  /**
   * Create a new BaseMarketDataProvider
   * @param {Object} options Configuration options
   * @param {string} [options.symbol] Trading symbol (default: 'BTC/USD')
   * @param {Object} [options.logger] Logger instance
   */
  constructor(options = {}) {
    this.symbol = options.symbol || 'BTC/USD';
    this.logger = options.logger || console;
    this.cache = {};
  }
  
  /**
   * Get order book data
   * @param {number} [depth=10] Depth of order book to retrieve
   * @returns {Promise<Object>} Order book data with bids and asks
   */
  async getOrderBook(depth = 10) { 
    throw new Error('Method not implemented: getOrderBook()');
  }
  
  /**
   * Get recent trades data
   * @param {number} [limit=50] Number of trades to retrieve
   * @returns {Promise<Array>} Array of recent trades
   */
  async getTrades(limit = 50) { 
    throw new Error('Method not implemented: getTrades()');
  }
  
  /**
   * Get OHLC (candle) data
   * @param {string} [interval='1h'] Time interval for OHLC data
   * @param {number} [limit=24] Number of candles to retrieve
   * @returns {Promise<Array>} Array of OHLC data
   */
  async getOHLC(interval = '1h', limit = 24) { 
    throw new Error('Method not implemented: getOHLC()');
  }
  
  /**
   * Get ticker data
   * @returns {Promise<Object>} Ticker data
   */
  async getTicker() { 
    throw new Error('Method not implemented: getTicker()');
  }
  
  /**
   * Format a symbol for the exchange
   * @param {string} symbol Symbol to format
   * @returns {string} Formatted symbol
   */
  formatSymbol(symbol) {
    // Default implementation - override in exchange-specific providers
    return symbol.replace('/', '');
  }
  
  /**
   * Clear the cache
   */
  clearCache() {
    this.cache = {};
  }
}

export default BaseMarketDataProvider;
