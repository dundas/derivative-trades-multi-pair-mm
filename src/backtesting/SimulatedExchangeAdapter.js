/**
 * SimulatedExchangeAdapter
 *
 * Simulates exchange behavior for backtesting.
 * Simulates order fills based on historical order book data.
 *
 * Based on Hummingbot's executor simulator
 * Reference: hummingbot/strategy_v2/backtesting/executor_simulator_base.py
 */

import { OrderBookAnalyzer, OrderBookSnapshot } from '../../lib/utils/order-book/OrderBookAnalyzer.js';

const ORDER_STATUS_PENDING = 'PENDING';
const ORDER_STATUS_OPEN = 'OPEN';
const ORDER_STATUS_FILLED = 'FILLED';
const ORDER_STATUS_PARTIALLY_FILLED = 'PARTIALLY_FILLED';
const ORDER_STATUS_CANCELLED = 'CANCELLED';
const ORDER_STATUS_REJECTED = 'REJECTED';

/**
 * Simulated order
 */
class SimulatedOrder {
  constructor({
    id,
    pair,
    side, // 'BUY' or 'SELL'
    type, // 'LIMIT' or 'MARKET'
    price = null,
    amount,
    timestamp
  }) {
    this.id = id;
    this.pair = pair;
    this.side = side;
    this.type = type;
    this.price = price;
    this.amount = amount;
    this.timestamp = timestamp;
    this.status = ORDER_STATUS_PENDING;
    this.filledAmount = 0;
    this.averageFillPrice = 0;
    this.fills = [];
  }

  get remainingAmount() {
    return this.amount - this.filledAmount;
  }

  get isFullyFilled() {
    return this.filledAmount >= this.amount;
  }

  addFill(fillAmount, fillPrice, timestamp, fee = 0) {
    this.fills.push({
      amount: fillAmount,
      price: fillPrice,
      timestamp,
      fee
    });

    // Update filled amount and average price
    const totalValue = this.averageFillPrice * this.filledAmount + fillPrice * fillAmount;
    this.filledAmount += fillAmount;
    this.averageFillPrice = this.filledAmount > 0 ? totalValue / this.filledAmount : 0;

    // Update status
    if (this.isFullyFilled) {
      this.status = ORDER_STATUS_FILLED;
    } else {
      this.status = ORDER_STATUS_PARTIALLY_FILLED;
    }
  }
}

/**
 * Simulated fill
 */
class SimulatedFill {
  constructor({ orderId, pair, side, amount, price, timestamp, fee }) {
    this.orderId = orderId;
    this.pair = pair;
    this.side = side;
    this.amount = amount;
    this.price = price;
    this.timestamp = timestamp;
    this.fee = fee;
  }
}

/**
 * Simulated exchange adapter
 */
class SimulatedExchangeAdapter {
  constructor(options = {}) {
    this.orders = new Map(); // orderId -> SimulatedOrder
    this.fills = []; // Array of SimulatedFill
    this.balances = new Map(Object.entries(options.initialBalances || { USD: 10000 }));

    // Configuration
    this.makerFee = options.makerFee || 0.0016; // 0.16% (Kraken maker fee)
    this.takerFee = options.takerFee || 0.0026; // 0.26% (Kraken taker fee)
    this.slippageModel = options.slippageModel || 'realistic'; // 'none', 'fixed', 'realistic'
    this.fixedSlippageBps = options.fixedSlippageBps || 10; // 10 bps if using fixed model

    // Statistics
    this.stats = {
      ordersPlaced: 0,
      ordersFilled: 0,
      ordersPartiallyFilled: 0,
      ordersCancelled: 0,
      ordersRejected: 0,
      totalVolume: 0,
      totalFees: 0
    };

    this.orderIdCounter = 1;
  }

  /**
   * Place an order
   * @param {Object} orderParams - Order parameters
   * @returns {SimulatedOrder} Created order
   */
  placeOrder({ pair, side, type, price = null, amount, timestamp }) {
    const orderId = `SIM-${this.orderIdCounter++}`;

    const order = new SimulatedOrder({
      id: orderId,
      pair,
      side,
      type,
      price,
      amount,
      timestamp
    });

    // Check if we have sufficient balance
    const baseAsset = pair.split('/')[0];
    const quoteAsset = pair.split('/')[1];

    if (side === 'BUY') {
      const requiredBalance = amount * (price || 0); // Estimate
      const availableBalance = this.balances.get(quoteAsset) || 0;

      if (type === 'LIMIT' && requiredBalance > availableBalance) {
        order.status = ORDER_STATUS_REJECTED;
        this.stats.ordersRejected++;
        return order;
      }
    } else {
      // SELL
      const availableBalance = this.balances.get(baseAsset) || 0;

      if (amount > availableBalance) {
        order.status = ORDER_STATUS_REJECTED;
        this.stats.ordersRejected++;
        return order;
      }
    }

    order.status = ORDER_STATUS_OPEN;
    this.orders.set(orderId, order);
    this.stats.ordersPlaced++;

    return order;
  }

  /**
   * Cancel an order
   * @param {string} orderId - Order ID
   * @returns {boolean} True if cancelled
   */
  cancelOrder(orderId) {
    const order = this.orders.get(orderId);
    if (!order) return false;

    if (order.status === ORDER_STATUS_OPEN || order.status === ORDER_STATUS_PARTIALLY_FILLED) {
      order.status = ORDER_STATUS_CANCELLED;
      this.stats.ordersCancelled++;
      return true;
    }

    return false;
  }

  /**
   * Process order matching against order book
   * @param {string} orderId - Order ID
   * @param {Object} orderBook - Order book snapshot { bids, asks }
   * @param {number} timestamp - Current timestamp
   * @returns {Array<SimulatedFill>} Array of fills generated
   */
  processOrderMatching(orderId, orderBook, timestamp) {
    const order = this.orders.get(orderId);
    if (!order) return [];

    if (order.status !== ORDER_STATUS_OPEN && order.status !== ORDER_STATUS_PARTIALLY_FILLED) {
      return [];
    }

    if (order.isFullyFilled) {
      return [];
    }

    const fills = [];
    const obSnapshot = OrderBookAnalyzer.createSnapshot(orderBook.bids, orderBook.asks, timestamp);

    if (order.type === 'MARKET') {
      // Market order - fill immediately at best available prices
      const isBuy = order.side === 'BUY';
      const analysis = OrderBookAnalyzer.calculateVWAP(obSnapshot, isBuy, order.remainingAmount);

      if (analysis.totalVolume > 0) {
        const fillAmount = Math.min(order.remainingAmount, analysis.totalVolume);
        const fillPrice = analysis.vwap;
        const fee = fillAmount * fillPrice * this.takerFee;

        order.addFill(fillAmount, fillPrice, timestamp, fee);

        const fill = new SimulatedFill({
          orderId: order.id,
          pair: order.pair,
          side: order.side,
          amount: fillAmount,
          price: fillPrice,
          timestamp,
          fee
        });

        fills.push(fill);
        this.fills.push(fill);

        // Update balances
        this.updateBalances(order.pair, order.side, fillAmount, fillPrice, fee);

        // Update stats
        this.stats.totalVolume += fillAmount * fillPrice;
        this.stats.totalFees += fee;
      }
    } else {
      // LIMIT order - fill if price crosses
      const isBuy = order.side === 'BUY';
      const bestPrice = isBuy ? obSnapshot.bestAsk : obSnapshot.bestBid;

      if (!bestPrice) return [];

      // Check if order price crosses
      const crosses = isBuy ? order.price >= bestPrice : order.price <= bestPrice;

      if (crosses) {
        // Find how much volume is available at our price or better
        const availableVolume = OrderBookAnalyzer.getVolumeForPrice(
          obSnapshot,
          isBuy,
          order.price
        );

        if (availableVolume > 0) {
          const fillAmount = Math.min(order.remainingAmount, availableVolume);
          const fillPrice = order.price; // Fill at limit price (maker)
          const fee = fillAmount * fillPrice * this.makerFee;

          order.addFill(fillAmount, fillPrice, timestamp, fee);

          const fill = new SimulatedFill({
            orderId: order.id,
            pair: order.pair,
            side: order.side,
            amount: fillAmount,
            price: fillPrice,
            timestamp,
            fee
          });

          fills.push(fill);
          this.fills.push(fill);

          // Update balances
          this.updateBalances(order.pair, order.side, fillAmount, fillPrice, fee);

          // Update stats
          this.stats.totalVolume += fillAmount * fillPrice;
          this.stats.totalFees += fee;
        }
      }
    }

    // Update order status statistics
    if (order.status === ORDER_STATUS_FILLED) {
      this.stats.ordersFilled++;
    } else if (order.status === ORDER_STATUS_PARTIALLY_FILLED) {
      this.stats.ordersPartiallyFilled++;
    }

    return fills;
  }

  /**
   * Update balances after fill
   * @param {string} pair - Trading pair
   * @param {string} side - Order side
   * @param {number} amount - Fill amount
   * @param {number} price - Fill price
   * @param {number} fee - Fee amount
   */
  updateBalances(pair, side, amount, price, fee) {
    const [baseAsset, quoteAsset] = pair.split('/');

    if (side === 'BUY') {
      // Buying base asset with quote asset
      const cost = amount * price + fee;
      this.balances.set(quoteAsset, (this.balances.get(quoteAsset) || 0) - cost);
      this.balances.set(baseAsset, (this.balances.get(baseAsset) || 0) + amount);
    } else {
      // Selling base asset for quote asset
      const proceeds = amount * price - fee;
      this.balances.set(baseAsset, (this.balances.get(baseAsset) || 0) - amount);
      this.balances.set(quoteAsset, (this.balances.get(quoteAsset) || 0) + proceeds);
    }
  }

  /**
   * Get order by ID
   * @param {string} orderId - Order ID
   * @returns {SimulatedOrder|null} Order or null
   */
  getOrder(orderId) {
    return this.orders.get(orderId) || null;
  }

  /**
   * Get all open orders
   * @returns {Array<SimulatedOrder>} Array of open orders
   */
  getOpenOrders() {
    return Array.from(this.orders.values()).filter(
      order => order.status === ORDER_STATUS_OPEN || order.status === ORDER_STATUS_PARTIALLY_FILLED
    );
  }

  /**
   * Get balance for asset
   * @param {string} asset - Asset symbol
   * @returns {number} Balance
   */
  getBalance(asset) {
    return this.balances.get(asset) || 0;
  }

  /**
   * Get all balances
   * @returns {Map<string, number>} Balances map
   */
  getAllBalances() {
    return new Map(this.balances);
  }

  /**
   * Get fills for order
   * @param {string} orderId - Order ID
   * @returns {Array<SimulatedFill>} Array of fills
   */
  getOrderFills(orderId) {
    return this.fills.filter(fill => fill.orderId === orderId);
  }

  /**
   * Get all fills
   * @returns {Array<SimulatedFill>} Array of all fills
   */
  getAllFills() {
    return [...this.fills];
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      openOrders: this.getOpenOrders().length,
      balances: Object.fromEntries(this.balances)
    };
  }

  /**
   * Reset exchange state
   * @param {Object} initialBalances - Initial balances
   */
  reset(initialBalances = null) {
    this.orders.clear();
    this.fills = [];

    if (initialBalances) {
      this.balances = new Map(Object.entries(initialBalances));
    }

    this.stats = {
      ordersPlaced: 0,
      ordersFilled: 0,
      ordersPartiallyFilled: 0,
      ordersCancelled: 0,
      ordersRejected: 0,
      totalVolume: 0,
      totalFees: 0
    };

    this.orderIdCounter = 1;
  }
}

export {
  SimulatedExchangeAdapter,
  SimulatedOrder,
  SimulatedFill,
  ORDER_STATUS_PENDING,
  ORDER_STATUS_OPEN,
  ORDER_STATUS_FILLED,
  ORDER_STATUS_PARTIALLY_FILLED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_REJECTED
};
