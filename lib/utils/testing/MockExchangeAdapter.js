/**
 * @fileoverview Mock Exchange Adapter for testing the Adaptive Market Maker
 * 
 * This adapter connects the MockExchangeClient with the AdaptiveMarketMaker
 * to provide a complete testing environment.
 */

import { EventEmitter } from 'events';
import { OrderStatus } from '../../utils/order/OrderStatus.js';

/**
 * Mock Exchange Adapter for testing the Adaptive Market Maker
 */
class MockExchangeAdapter extends EventEmitter {
  /**
   * Create a new MockExchangeAdapter
   * @param {Object} mockClient The MockExchangeClient instance
   * @param {Object} config Configuration options
   */
  constructor(mockClient, config = {}) {
    super();
    this.client = mockClient;
    this.config = config;
    this.logger = config.logger || console;
    
    // Set up event listeners for the mock client
    this.client.on('orderCreated', (order) => {
      this.emit('orderCreated', order);
    });
    
    this.client.on('orderCancelled', (order) => {
      this.emit('orderCancelled', order);
    });
    
    this.client.on('orderUpdated', (order) => {
      this.emit('orderUpdated', order);
    });
    
    this.logger.debug('MockExchangeAdapter initialized');
  }
  
  /**
   * Place an order on the exchange
   * @param {Object} order Order details
   * @returns {Promise<Object>} Order response
   */
  async placeOrder(order) {
    return this.client.placeOrder(order);
  }
  
  /**
   * Cancel an order on the exchange
   * @param {string} orderId ID of the order to cancel
   * @returns {Promise<Object>} Cancellation response
   */
  async cancelOrder(orderId) {
    return this.client.cancelOrder(orderId);
  }
  
  /**
   * Get the status of an order
   * @param {string} orderId ID of the order
   * @returns {Promise<Object>} Order status
   */
  async getOrderStatus(orderId) {
    return this.client.getOrderStatus(orderId);
  }
  
  /**
   * Get all open orders
   * @param {Object} params Additional parameters
   * @returns {Promise<Array>} Open orders
   */
  async getOpenOrders(params = {}) {
    return this.client.getOpenOrders(params);
  }
  
  /**
   * Get account balances
   * @returns {Promise<Object>} Account balances
   */
  async getBalances() {
    return this.client.getBalances();
  }
  
  /**
   * Get positions for the account
   * @returns {Promise<Array>} Account positions
   */
  async getPositions() {
    return this.client.getPositions();
  }
  
  /**
   * Get the current order book for a symbol
   * @param {string} symbol Trading pair symbol (e.g., 'BTC/USD')
   * @param {Object} params Additional parameters
   * @returns {Promise<Object>} Order book data
   */
  async getOrderBook(symbol, params = {}) {
    return this.client.getOrderBook(symbol, params);
  }
  
  /**
   * Get ticker information for a symbol
   * @param {string} symbol Trading pair symbol (e.g., 'BTC/USD')
   * @returns {Promise<Object>} Ticker data
   */
  async getTicker(symbol) {
    return this.client.getTicker(symbol);
  }
  
  /**
   * Get OHLC data for a symbol
   * @param {string} symbol Trading pair symbol (e.g., 'BTC/USD')
   * @param {Object} params Additional parameters
   * @returns {Promise<Array>} OHLC data
   */
  async getOHLC(symbol, params = {}) {
    const interval = params.interval || '1h';
    const since = params.since || Date.now() - (24 * 60 * 60 * 1000); // Default to last 24 hours
    const limit = params.limit || 24;
    
    // Generate mock OHLC data based on the current market condition
    const condition = this.client.getMarketCondition(symbol);
    const basePrice = symbol === 'BTC/USD' ? 40000 : 2800;
    const volatility = condition?.volatility || 0.3;
    
    const ohlcData = [];
    let lastClose = basePrice;
    
    for (let i = 0; i < limit; i++) {
      const timestamp = since + (i * this._getIntervalMilliseconds(interval));
      const volatilityFactor = volatility * basePrice * 0.01;
      
      // Generate random price movements based on volatility
      const open = lastClose;
      const high = open + (Math.random() * volatilityFactor);
      const low = open - (Math.random() * volatilityFactor);
      const close = low + (Math.random() * (high - low));
      
      // Generate random volume based on market condition
      const volume = (condition?.tradesPerMinute || 500) * (Math.random() + 0.5);
      
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
      symbol,
      interval,
      count: ohlcData.length
    });
    
    return ohlcData;
  }
  
  /**
   * Set a mock market condition for testing
   * @param {string} symbol Trading pair symbol
   * @param {Object} condition Market condition data
   */
  setMarketCondition(symbol, condition) {
    this.client.setMarketCondition(symbol, condition);
  }
  
  /**
   * Get the current market condition
   * @param {string} symbol Trading pair symbol
   * @returns {Object} Market condition data
   */
  getMarketCondition(symbol) {
    return this.client.getMarketCondition(symbol);
  }
  
  /**
   * Get the current market condition type based on condition parameters
   * @param {string} symbol Trading pair symbol
   * @returns {string} Market condition type identifier
   */
  getMarketConditionType(symbol) {
    const condition = this.getMarketCondition(symbol);
    
    if (!condition) {
      return 'unknown';
    }
    
    // Determine the condition type based on parameters
    const { liquidity, volatility, tradesPerMinute } = condition;
    
    if (liquidity >= 30) {
      if (volatility >= 0.5) {
        return 'high_liquidity_high_volatility';
      } else {
        return 'high_liquidity_normal_volatility';
      }
    } else {
      if (volatility >= 0.5) {
        return 'low_liquidity_high_volatility';
      } else if (tradesPerMinute <= 200) {
        return 'low_volume_periods';
      } else {
        return 'low_liquidity_normal_volatility';
      }
    }
  }
  
  /**
   * Simulate a partial fill for an order
   * @param {string} orderId ID of the order to partially fill
   * @param {number} amount Amount to fill
   * @param {number} price Price at which the order is filled
   * @returns {Promise<Object>} Updated order
   */
  async simulatePartialFill(orderId, amount, price) {
    return this.client.simulatePartialFill(orderId, amount, price);
  }
  
  /**
   * Update the mock order book
   * @param {string} symbol Trading pair symbol
   * @param {Object} orderBook New order book data
   */
  updateOrderBook(symbol, orderBook) {
    this.client.updateOrderBook(symbol, orderBook);
  }
  
  /**
   * Update market price by modifying the order book
   * @param {number} price New mid price for the market
   * @param {string} symbol Trading pair symbol (optional, defaults to BTC/USD)
   * @returns {Promise<Object>} Updated ticker
   */
  async updateMarketPrice(price, symbol = 'BTC/USD') {
    this.logger.debug('Updating market price', { price, symbol });
    
    // Get current order book
    const orderBook = await this.getOrderBook(symbol);
    if (!orderBook) {
      throw new Error(`Order book not available for symbol: ${symbol}`);
    }
    
    // Calculate spread (preserve existing spread)
    const currentBid = orderBook.bids[0][0];
    const currentAsk = orderBook.asks[0][0];
    const currentSpread = currentAsk - currentBid;
    const spreadPercentage = currentSpread / ((currentAsk + currentBid) / 2);
    
    // Calculate new bid and ask prices
    const halfSpread = price * spreadPercentage / 2;
    const newBid = price - halfSpread;
    const newAsk = price + halfSpread;
    
    // Create new order book with updated prices
    const newOrderBook = {
      bids: [],
      asks: [],
      timestamp: Date.now()
    };
    
    // Update bids
    for (let i = 0; i < orderBook.bids.length; i++) {
      const level = orderBook.bids[i];
      const priceDiff = currentBid - level[0];
      newOrderBook.bids.push([newBid - priceDiff, level[1]]);
    }
    
    // Update asks
    for (let i = 0; i < orderBook.asks.length; i++) {
      const level = orderBook.asks[i];
      const priceDiff = level[0] - currentAsk;
      newOrderBook.asks.push([newAsk + priceDiff, level[1]]);
    }
    
    // Update order book
    this.updateOrderBook(symbol, newOrderBook);
    
    // Return updated ticker
    return this.getTicker(symbol);
  }
  
  /**
   * Simulate different market conditions
   * @param {string} symbol Trading pair symbol
   * @param {string} conditionType Type of market condition to simulate
   */
  simulateMarketCondition(symbol, conditionType) {
    let condition = {};
    
    switch (conditionType) {
      case 'high_liquidity_normal_volatility':
        condition = {
          liquidity: 40,
          volatility: 0.3,
          tradesPerMinute: 1000
        };
        break;
        
      case 'high_liquidity_high_volatility':
        condition = {
          liquidity: 40,
          volatility: 0.8,
          tradesPerMinute: 1200
        };
        break;
        
      case 'low_liquidity_normal_volatility':
        condition = {
          liquidity: 15,
          volatility: 0.3,
          tradesPerMinute: 500
        };
        break;
        
      case 'low_liquidity_high_volatility':
        condition = {
          liquidity: 15,
          volatility: 0.8,
          tradesPerMinute: 600
        };
        break;
        
      case 'low_volume':
        condition = {
          liquidity: 10,
          volatility: 0.2,
          tradesPerMinute: 100
        };
        break;
        
      default:
        throw new Error(`Unknown market condition type: ${conditionType}`);
    }
    
    this.setMarketCondition(symbol, condition);
    
    // Also update the order book to reflect the market condition
    const basePrice = symbol === 'BTC/USD' ? 40000 : 2800;
    const spread = condition.volatility * basePrice * 0.01;
    const depth = condition.liquidity;
    
    const bids = [];
    const asks = [];
    
    for (let i = 0; i < 5; i++) {
      const bidPrice = basePrice - (i * spread / 5);
      const askPrice = basePrice + (i * spread / 5);
      const bidSize = depth / (i + 1);
      const askSize = depth / (i + 1);
      
      bids.push([bidPrice, bidSize]);
      asks.push([askPrice, askSize]);
    }
    
    this.updateOrderBook(symbol, {
      bids,
      asks,
      timestamp: Date.now()
    });
    
    this.logger.info('Simulated market condition', { 
      symbol, 
      conditionType,
      condition,
      orderBook: { bidCount: bids.length, askCount: asks.length }
    });
  }
  
  /**
   * Helper function to convert interval string to milliseconds
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
}

export { MockExchangeAdapter };
