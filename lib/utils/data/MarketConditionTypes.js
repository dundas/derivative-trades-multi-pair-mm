/**
 * Market Condition Types
 * 
 * Constants and types for different market conditions used in testing.
 */

/**
 * Standard market condition identifiers
 * @enum {string}
 */
export const MarketConditions = {
  /**
   * Default condition that applies to all market states
   * Used for setting default strategies
   */
  ALL: 'all',

  /**
   * High trading volume with normal price volatility
   * Typical of active trading hours in stable market
   */
  HIGH_LIQUIDITY_NORMAL_VOLATILITY: 'high_liquidity_normal_volatility',
  
  /**
   * High trading volume with high price volatility
   * Typical of market with significant news or events
   */
  HIGH_LIQUIDITY_HIGH_VOLATILITY: 'high_liquidity_high_volatility',
  
  /**
   * Low trading volume with normal price volatility
   * Typical of off-hours or weekend trading
   */
  LOW_LIQUIDITY_NORMAL_VOLATILITY: 'low_liquidity_normal_volatility',
  
  /**
   * Low trading volume with high price volatility
   * Typical of flash crashes or sudden market movements during off-hours
   */
  LOW_LIQUIDITY_HIGH_VOLATILITY: 'low_liquidity_high_volatility',
  
  /**
   * Very low trading volume periods
   * Typical of overnight or weekend trading
   */
  LOW_VOLUME_PERIODS: 'low_volume_periods'
};

/**
 * Map of exchanges to their specific quirks and requirements
 * This allows for easy extension to other exchanges
 */
export const ExchangeSpecifics = {
  KRAKEN: {
    formatSymbol: (symbol) => symbol.replace('/', '').replace('BTC', 'XBT'),
    orderBookResponseHandler: (response) => {
      if (response.result) {
        const pair = Object.keys(response.result)[0];
        return {
          bids: response.result[pair].bids,
          asks: response.result[pair].asks,
          timestamp: Date.now()
        };
      }
      throw new Error('Invalid order book response format');
    }
  },
  COINBASE: {
    formatSymbol: (symbol) => symbol.replace('/', '-'),
    orderBookResponseHandler: (response) => {
      return {
        bids: response.bids,
        asks: response.asks,
        timestamp: new Date(response.time).getTime()
      };
    }
  }
  // Add more exchanges as needed
};

export default MarketConditions;
