import { BaseMarketDataProvider } from './BaseMarketDataProvider.js';
import { KrakenRESTClient } from '../../../../lib/exchanges/KrakenRESTClient.js';

/**
 * Kraken-specific implementation of the Market Data Provider
 */
export class KrakenMarketDataProvider extends BaseMarketDataProvider {
  /**
   * Create a new KrakenMarketDataProvider
   * @param {Object} options Configuration options
   * @param {Object} [options.client] KrakenRESTClient instance
   * @param {string} [options.baseUrl] Base URL for the Kraken API
   * @param {string} [options.symbol] Trading symbol (default: 'BTC/USD')
   * @param {Object} [options.logger] Logger instance
   */
  constructor(options = {}) {
    super(options);
    
    this.client = options.client || new KrakenRESTClient({
      baseUrl: options.baseUrl || 'https://api.kraken.com'
    });
  }
  
  /**
   * Format a symbol for Kraken exchange
   * @param {string} symbol Symbol to format
   * @returns {string} Formatted symbol
   */
  formatSymbol(symbol) {
    // Kraken uses XBT instead of BTC
    return symbol.replace('/', '').replace('BTC', 'XBT');
  }
  
  /**
   * Get order book data
   * @param {number} [depth=10] Depth of order book to retrieve
   * @returns {Promise<Object>} Order book data with bids and asks
   */
  async getOrderBook(depth = 10) {
    try {
      const formattedSymbol = this.formatSymbol(this.symbol);
      const response = await this.client.getOrderBook(formattedSymbol, depth);
      
      if (response.result) {
        const pair = Object.keys(response.result)[0];
        return {
          bids: response.result[pair].bids,
          asks: response.result[pair].asks,
          timestamp: Date.now()
        };
      }
      
      throw new Error('Invalid order book response format');
    } catch (error) {
      this.logger.error('Error fetching order book:', error);
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
      const formattedSymbol = this.formatSymbol(this.symbol);
      const response = await this.client.getRecentTrades(formattedSymbol, limit);
      
      if (response.result) {
        const pair = Object.keys(response.result)[0];
        const trades = response.result[pair];
        
        return trades.map(trade => ({
          price: parseFloat(trade[0]),
          size: parseFloat(trade[1]),
          timestamp: parseInt(trade[2] * 1000), // Convert to milliseconds
          side: trade[3] === 'b' ? 'buy' : 'sell'
        }));
      }
      
      throw new Error('Invalid trades response format');
    } catch (error) {
      this.logger.error('Error fetching trades:', error);
      throw error;
    }
  }
  
  /**
   * Get OHLC (candle) data
   * @param {string} [interval='1h'] Time interval for OHLC data
   * @param {number} [limit=24] Number of candles to retrieve
   * @returns {Promise<Array>} Array of OHLC data
   */
  async getOHLC(interval = '1h', limit = 24) {
    try {
      const formattedSymbol = this.formatSymbol(this.symbol);
      
      // Convert interval to Kraken format
      const intervalMap = {
        '1m': 1,
        '5m': 5,
        '15m': 15,
        '30m': 30,
        '1h': 60,
        '4h': 240,
        '1d': 1440,
        '1w': 10080,
        '2w': 21600
      };
      
      const krakenInterval = intervalMap[interval] || 60;
      const response = await this.client.getOHLCData(formattedSymbol, krakenInterval);
      
      if (response.result) {
        const pair = Object.keys(response.result).find(key => key !== 'last');
        if (!pair) {
          throw new Error('No OHLC data found in response');
        }
        
        const ohlcData = response.result[pair];
        return ohlcData.slice(0, limit).map(candle => ({
          time: parseInt(candle[0] * 1000), // Convert to milliseconds
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          vwap: parseFloat(candle[5]),
          volume: parseFloat(candle[6]),
          count: parseInt(candle[7])
        }));
      }
      
      throw new Error('Invalid OHLC response format');
    } catch (error) {
      this.logger.error('Error fetching OHLC data:', error);
      throw error;
    }
  }
  
  /**
   * Get ticker data
   * @returns {Promise<Object>} Ticker data
   */
  async getTicker() {
    try {
      const formattedSymbol = this.formatSymbol(this.symbol);
      const response = await this.client.getTicker(formattedSymbol);
      
      if (response.result) {
        const pair = Object.keys(response.result)[0];
        const tickerData = response.result[pair];
        
        return {
          ask: parseFloat(tickerData.a[0]),
          bid: parseFloat(tickerData.b[0]),
          last: parseFloat(tickerData.c[0]),
          volume: parseFloat(tickerData.v[1]), // 24h volume
          volumeWeightedAveragePrice: parseFloat(tickerData.p[1]), // 24h VWAP
          high: parseFloat(tickerData.h[1]), // 24h high
          low: parseFloat(tickerData.l[1]), // 24h low
          timestamp: Date.now()
        };
      }
      
      throw new Error('Invalid ticker response format');
    } catch (error) {
      this.logger.error('Error fetching ticker:', error);
      throw error;
    }
  }
}

export default KrakenMarketDataProvider;
