/**
 * @fileoverview Mock Exchange Client for testing the Adaptive Market Maker
 * 
 * This mock client implements the necessary methods for the Adaptive Market Maker
 * to function properly in a testing environment without connecting to a real exchange.
 */

import { EventEmitter } from 'events';
import { OrderStatus } from '../../utils/order/OrderStatus.js';

/**
 * Mock Exchange Client for testing the Adaptive Market Maker
 * Implements the same interface as KrakenRESTClient but with mock data
 */
class MockExchangeClient extends EventEmitter {
  /**
   * Create a new MockExchangeClient
   * @param {Object} config Configuration options
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.logger = config.logger || console;
    this.orders = new Map();
    this.positions = new Map();
    this.balances = {
      USD: config.initialBalance?.USD || 100000,
      BTC: config.initialBalance?.BTC || 10,
      ETH: config.initialBalance?.ETH || 100
    };
    
    // Mock market data
    this.orderBooks = {
      'BTC/USD': {
        bids: [[40000, 1.5], [39900, 2.0], [39800, 2.5], [39700, 3.0], [39600, 3.5]],
        asks: [[40100, 1.5], [40200, 2.0], [40300, 2.5], [40400, 3.0], [40500, 3.5]],
        timestamp: Date.now()
      },
      'ETH/USD': {
        bids: [[2800, 10], [2790, 15], [2780, 20], [2770, 25], [2760, 30]],
        asks: [[2810, 10], [2820, 15], [2830, 20], [2840, 25], [2850, 30]],
        timestamp: Date.now()
      }
    };
    
    this.marketConditions = {
      'BTC/USD': {
        liquidity: 40,
        volatility: 0.3,
        tradesPerMinute: 1000
      },
      'ETH/USD': {
        liquidity: 30,
        volatility: 0.4,
        tradesPerMinute: 800
      }
    };
    
    this.logger.debug('MockExchangeClient initialized', {
      balances: this.balances,
      symbols: Object.keys(this.orderBooks)
    });
  }
  
  /**
   * Get the current order book for a symbol
   * @param {string} symbol Trading pair symbol (e.g., 'BTC/USD')
   * @param {Object} params Additional parameters
   * @returns {Promise<Object>} Order book data
   */
  async getOrderBook(symbol, params = {}) {
    this.logger.debug('Getting order book', { symbol, params });
    
    if (!this.orderBooks[symbol]) {
      throw new Error(`Order book not available for symbol: ${symbol}`);
    }
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 50));
    
    return {
      ...this.orderBooks[symbol],
      timestamp: Date.now()
    };
  }
  
  /**
   * Get recent trades for a symbol
   * @param {string} symbol Trading pair symbol (e.g., 'BTC/USD')
   * @param {Object} params Additional parameters
   * @returns {Promise<Array>} Recent trades
   */
  async getTrades(symbol, params = {}) {
    this.logger.debug('Getting trades', { symbol, params });
    
    // Generate mock trades
    const trades = [];
    const basePrice = symbol === 'BTC/USD' ? 40000 : 2800;
    const count = params.limit || 100;
    
    for (let i = 0; i < count; i++) {
      const price = basePrice + (Math.random() * 200 - 100);
      const amount = Math.random() * 2;
      const side = Math.random() > 0.5 ? 'buy' : 'sell';
      
      trades.push({
        id: `trade-${Date.now()}-${i}`,
        timestamp: Date.now() - (i * 1000),
        price,
        amount,
        side
      });
    }
    
    return trades;
  }
  
  /**
   * Get ticker information for a symbol
   * @param {string} symbol Trading pair symbol (e.g., 'BTC/USD')
   * @returns {Promise<Object>} Ticker data
   */
  async getTicker(symbol) {
    this.logger.debug('Getting ticker', { symbol });
    
    const orderBook = this.orderBooks[symbol];
    if (!orderBook) {
      throw new Error(`Ticker not available for symbol: ${symbol}`);
    }
    
    const bid = orderBook.bids[0][0];
    const ask = orderBook.asks[0][0];
    
    return {
      symbol,
      bid,
      ask,
      last: (bid + ask) / 2,
      volume: Math.random() * 1000,
      timestamp: Date.now()
    };
  }
  
  /**
   * Get OHLC data for a symbol
   * @param {string} symbol Trading pair symbol (e.g., 'BTC/USD')
   * @param {Object} params Additional parameters
   * @returns {Promise<Array>} OHLC data
   */
  async getOHLC(symbol, params = {}) {
    this.logger.debug('Getting OHLC data', { symbol, params });
    
    // Delegate to the adapter's implementation
    // This is just a passthrough method
    return [];
  }
  
  /**
   * Place an order on the exchange
   * @param {Object} order Order details
   * @returns {Promise<Object>} Order response
   */
  async placeOrder(order) {
    this.logger.debug('Placing order', { order });
    
    const orderId = `order-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newOrder = {
      id: orderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: order.price,
      amount: order.amount,
      status: OrderStatus.OPEN,
      filled: 0,
      remaining: order.amount,
      timestamp: Date.now()
    };
    
    this.orders.set(orderId, newOrder);
    this.logger.debug(`Placed order: ${JSON.stringify(newOrder)}`);
    
    // Emit order update event
    this.emit('orderUpdate', newOrder);
    
    return newOrder;
  }
  
  /**
   * Create an order on the exchange (compatible with exchange adapter interface)
   * @param {string} symbol - Trading symbol
   * @param {string} type - Order type ('limit', 'market', etc.)
   * @param {string} side - Order side ('buy' or 'sell')
   * @param {number} amount - Order amount
   * @param {number} price - Order price
   * @param {Object} [params] - Additional exchange-specific parameters
   * @returns {Promise<Object>} - Order response
   */
  async createOrder(symbol, type, side, amount, price, params = {}) {
    const order = {
      symbol,
      type,
      side,
      amount,
      price,
      params
    };
    
    return this.placeOrder(order);
  }
  
  /**
   * Cancel an order on the exchange
   * @param {string} orderId ID of the order to cancel
   * @returns {Promise<Object>} Cancellation response
   */
  async cancelOrder(orderId) {
    this.logger.debug('Cancelling order', { orderId });
    
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    order.status = OrderStatus.CANCELED;
    order.cancelTimestamp = Date.now();
    
    // Emit order cancelled event
    this.emit('orderCancelled', order);
    
    return {
      id: orderId,
      status: OrderStatus.CANCELED
    };
  }
  
  /**
   * Get the status of an order
   * @param {string} orderId ID of the order
   * @returns {Promise<Object>} Order status
   */
  async getOrderStatus(orderId) {
    this.logger.debug('Getting order status', { orderId });
    
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    return order;
  }
  
  /**
   * Get all open orders
   * @param {Object} params Additional parameters
   * @returns {Promise<Array>} Open orders
   */
  async getOpenOrders(params = {}) {
    this.logger.debug('Getting open orders', { params });
    
    const openOrders = [];
    for (const order of this.orders.values()) {
      if (order.status === OrderStatus.OPEN) {
        openOrders.push(order);
      }
    }
    
    return openOrders;
  }
  
  /**
   * Get account balances
   * @returns {Promise<Object>} Account balances
   */
  async getBalances() {
    this.logger.debug('Getting balances');
    
    return { ...this.balances };
  }
  
  /**
   * Get positions for the account
   * @returns {Promise<Array>} Account positions
   */
  async getPositions() {
    this.logger.debug('Getting positions');
    
    const positions = [];
    for (const [symbol, position] of this.positions.entries()) {
      positions.push({
        symbol,
        ...position
      });
    }
    
    return positions;
  }
  
  /**
   * Set a mock market condition for testing
   * @param {string} symbol Trading pair symbol
   * @param {Object} condition Market condition data
   */
  setMarketCondition(symbol, condition) {
    this.marketConditions[symbol] = {
      ...this.marketConditions[symbol],
      ...condition
    };
    
    this.logger.debug('Set market condition', { 
      symbol, 
      condition: this.marketConditions[symbol] 
    });
  }
  
  /**
   * Get the current market condition
   * @param {string} symbol Trading pair symbol
   * @returns {Object} Market condition data
   */
  getMarketCondition(symbol) {
    return this.marketConditions[symbol];
  }
  
  /**
   * Simulate a partial fill for an order
   * @param {string} orderId ID of the order to partially fill
   * @param {number} amount Amount to fill
   * @param {number} price Price at which the order is filled
   * @returns {Promise<Object>} Updated order
   */
  async simulatePartialFill(orderId, amount, price) {
    this.logger.debug('Simulating partial fill', { orderId, amount, price });
    
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    if (order.status !== OrderStatus.OPEN) {
      throw new Error(`Cannot fill order with status: ${order.status}`);
    }
    
    if (amount > order.remaining) {
      throw new Error(`Fill amount (${amount}) exceeds remaining amount (${order.remaining})`);
    }
    
    // Update order
    order.filled += amount;
    order.remaining -= amount;
    
    if (order.remaining === 0) {
      order.status = OrderStatus.FILLED;
    } else {
      order.status = OrderStatus.PARTIALLY_FILLED;
    }
    
    // Update balances based on the fill
    const [base, quote] = order.symbol.split('/');
    
    if (order.side === 'buy') {
      this.balances[base] += amount;
      this.balances[quote] -= amount * price;
    } else {
      this.balances[base] -= amount;
      this.balances[quote] += amount * price;
    }
    
    // Emit order updated event
    this.emit('orderUpdated', {
      id: orderId,
      ...order,
      lastFillAmount: amount,
      lastFillPrice: price,
      lastFillTimestamp: Date.now()
    });
    
    return order;
  }
  
  /**
   * Update the mock order book
   * @param {string} symbol Trading pair symbol
   * @param {Object} orderBook New order book data
   */
  updateOrderBook(symbol, orderBook) {
    this.orderBooks[symbol] = {
      ...orderBook,
      timestamp: Date.now()
    };
    
    this.logger.debug('Updated order book', { symbol });
  }
}

export { MockExchangeClient };
