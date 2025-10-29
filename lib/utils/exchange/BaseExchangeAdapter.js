import { EventEmitter } from 'events';
import { LoggerFactory } from '../logger-factory.js'; // Adjust path as needed
import { 
  OrderManager as RedisOrderManager,
  FillManager as RedisFillManager,
  BalanceManager as RedisBalanceManager,
  KeyGenerator
} from '../../../../lib/redis-backend-api/index.js'; // Adjust path as needed

/**
 * @abstract
 * Base class for all exchange adapters.
 * Defines the interface that AdaptiveMarketMakerV2 expects.
 * Handles common initialization and provides utilities for concrete adapters.
 */
export class BaseExchangeAdapter extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {String} options.exchangeName - Name of the exchange
   * @param {String} options.tradingMode - 'paper' or 'live'
   * @param {String} options.tradingPair - e.g., 'BTC/USD'
   * @param {String} options.sessionId - Current session ID
   * @param {String} options.strategyName - Name of the trading strategy
   * @param {Object} options.symbolConfig - Configuration for the trading pair (precision, min size etc.)
   * @param {Object} [options.redisConfig] - Optional Redis configuration
   */
  constructor(options = {}) {
    super();
    this.logger = options.logger || LoggerFactory.createLogger(options.exchangeName || 'BaseExchangeAdapter');
    this.exchangeName = options.exchangeName || 'unknown';
    this.tradingMode = options.tradingMode || 'paper'; // Default to paper
    this.tradingPair = options.tradingPair;
    this.sessionId = options.sessionId;
    this.strategyName = options.strategyName || 'default_exchange_strategy'; // Added strategyName
    this.symbolConfig = options.symbolConfig || {};

    if (!this.tradingPair) {
      this.logger.error('[BaseExchangeAdapter] tradingPair is required.');
      throw new Error('tradingPair is required for BaseExchangeAdapter.');
    }
     if (!this.sessionId) {
      this.logger.error('[BaseExchangeAdapter] sessionId is required.');
      throw new Error('sessionId is required for BaseExchangeAdapter.');
    }

    const redisChildLogger = this.logger.createChild ? this.logger.createChild('RedisManagers') : this.logger;

    this.keyGenerator = new KeyGenerator({
      strategy: this.strategyName,
      exchange: this.exchangeName,
      symbol: this.tradingPair,
      sessionId: this.sessionId
    });
    
    this.redisOrderManager = new RedisOrderManager({ 
      logger: redisChildLogger, 
      redisConfig: options.redisConfig,
      keyGenerator: this.keyGenerator
    });
    
    this.redisFillManager = new RedisFillManager({ 
      logger: redisChildLogger, 
      redisConfig: options.redisConfig,
      keyGenerator: this.keyGenerator
    });
    
    this.balanceManager = new RedisBalanceManager({ 
      logger: redisChildLogger, 
      redisConfig: options.redisConfig,
      keyGenerator: this.keyGenerator,
      symbolConfig: this.symbolConfig // For base/quote currency info
    });

    this.activeOrders = new Map(); // Internal cache for orders: Map<orderId, orderObject>
    this.currentBalances = null; // Internal cache for balances

    this.logger.info(`[${this.exchangeName}] BaseExchangeAdapter initialized for ${this.tradingPair}`, {
      tradingMode: this.tradingMode,
      sessionId: this.sessionId
    });
  }

  // --- Abstract Methods to be Implemented by Concrete Adapters ---

  /**
   * Connects to the exchange.
   * @abstract
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('Method connect() must be implemented by the concrete adapter.');
  }

  /**
   * Disconnects from the exchange.
   * @abstract
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('Method disconnect() must be implemented by the concrete adapter.');
  }

  /**
   * Fetches current account balances.
   * Should populate this.currentBalances and return them.
   * @abstract
   * @returns {Promise<Object>} - Balance object (e.g., { BTC: { free: 1, used: 0, total: 1 }, USD: { ... } })
   */
  async fetchBalances() {
    throw new Error('Method fetchBalances() must be implemented by the concrete adapter.');
  }

  /**
   * Fetches current open positions.
   * @abstract
   * @returns {Promise<Object>} - Positions object
   */
  async fetchPositions() {
    // For many spot exchanges, positions are implicit in balances.
    // This might be more relevant for derivatives or margin trading.
    // Default implementation can return an empty object or rely on balances.
    this.logger.debug(`[${this.exchangeName}] fetchPositions() called, default implementation returns empty object.`);
    return {}; 
  }

  /**
   * Creates a new order.
   * Expected orderParams: { symbol, type, side, price, amount, [clientId], [params] }
   * Must store the order using _storeOrder and emit relevant events.
   * @abstract
   * @param {Object} orderParams - Parameters for the new order.
   * @returns {Promise<Object>} - The created order object as returned by the exchange/simulation.
   */
  async createOrder(orderParams) {
    throw new Error('Method createOrder(orderParams) must be implemented by the concrete adapter.');
  }

  /**
   * Cancels an existing order.
   * Must update order status using _updateOrderStatus and emit relevant events.
   * @abstract
   * @param {String} orderId - The ID of the order to cancel.
   * @param {Object} [params] - Additional parameters for cancellation.
   * @returns {Promise<Object>} - The cancelled order object or confirmation.
   */
  async cancelOrder(orderId, params = {}) {
    throw new Error('Method cancelOrder(orderId, params) must be implemented by the concrete adapter.');
  }

  /**
   * Cancels all managed open orders on the exchange.
   * Typically used during shutdown or for risk management.
   * @abstract
   * @param {String} reason - The reason for cancelling all orders.
   * @returns {Promise<Array<Object>>} - A promise that resolves to an array of results, one for each attempted cancellation.
   *                                    Each result object could be { orderId: string, success: boolean, error?: string }.
   */
  async cancelAllManagedOrders(reason) {
    throw new Error('Method cancelAllManagedOrders(reason) must be implemented by the concrete adapter.');
  }

  /**
   * Cancels all open buy orders managed by this adapter.
   * @abstract
   * @param {String} reason - Reason for cancellation.
   * @returns {Promise<Array<Object>>} - Array of canceled order results.
   */
  async cancelOpenBuyOrders(reason) {
    throw new Error('Method cancelOpenBuyOrders(reason) must be implemented by the concrete adapter.');
  }

  /**
   * Fetches the status of a specific order.
   * @abstract
   * @param {String} orderId - The ID of the order.
   * @returns {Promise<Object>} - The order object with its current status.
   */
  async getOrderStatus(orderId) {
    throw new Error('Method getOrderStatus(orderId) must be implemented by the concrete adapter.');
  }

  /**
   * Fetches a list of all tradable pairs on the exchange.
   * @abstract
   * @returns {Promise<Array<String>>} - e.g., ['BTC/USD', 'ETH/USD']
   */
  async getTradablePairs() {
    throw new Error('Method getTradablePairs() must be implemented by the concrete adapter.');
  }

  /**
   * Fetches specific details for a trading pair (min size, precision, etc.).
   * @abstract
   * @param {String} pair - The trading pair (e.g., 'BTC/USD').
   * @returns {Promise<Object>} - Pair details object.
   */
  async getPairDetails(pair) {
    throw new Error('Method getPairDetails(pair) must be implemented by the concrete adapter.');
  }

  // --- Helper Methods for Concrete Adapters (Protected Style) ---

  /**
   * Stores an order in Redis and the internal cache.
   * @protected
   * @param {Object} order - The order object to store.
   * @returns {Promise<void>}
   */
  async _storeOrder(order) {
    if (!order || !order.id) {
      this.logger.error(`[${this.exchangeName}] _storeOrder: Invalid order object provided.`, { order });
      return;
    }
    try {
      await this.redisOrderManager.add(order);
      this.activeOrders.set(order.id, order);
      this.logger.info(`[${this.exchangeName}] Stored order ${order.id}`, { status: order.status, side: order.side, price: order.price, amount: order.amount });
    } catch (error) {
      this.logger.error(`[${this.exchangeName}] Error storing order ${order.id}: ${error.message}`, { error, orderId: order.id });
    }
  }

  /**
   * Updates an order's status in Redis and the internal cache. Emits 'orderStatusChanged'.
   * @protected
   * @param {String} orderId
   * @param {String} newStatus
   * @param {Object} [updateFields] - Additional fields to update on the order object.
   * @returns {Promise<Object | null>} The updated order object or null if not found.
   */
  async _updateOrderStatus(orderId, newStatus, updateFields = {}) {
    let order = this.activeOrders.get(orderId);
    if (!order) {
      order = await this.redisOrderManager.get(orderId);
      if (order) this.activeOrders.set(orderId, order); // Cache if found in Redis
    }

    if (order) {
      const oldStatus = order.status;
      order.status = newStatus;
      order.lastModified = new Date().toISOString();
      Object.assign(order, updateFields);

      try {
        await this.redisOrderManager.update(order);
        this.activeOrders.set(orderId, order); // Ensure cache is updated
        this.logger.info(`[${this.exchangeName}] Updated order ${orderId} status: ${oldStatus} -> ${newStatus}`, { price: order.price, amount: order.amount, filled: order.filled });
        this.emit('orderStatusChanged', { ...order }); // Emit a copy
        return order;
      } catch (error) {
        this.logger.error(`[${this.exchangeName}] Error updating order ${orderId} status: ${error.message}`, { error, orderId });
        return order; // Return the locally modified order even if Redis fails
      }
    } else {
      this.logger.warn(`[${this.exchangeName}] _updateOrderStatus: Order ${orderId} not found.`);
      return null;
    }
  }

  /**
   * Records a fill in Redis, updates the order, updates balances, and emits 'orderFilled'.
   * @protected
   * @param {Object} fillData - Must include { orderId, fillId, price, amount, fee, timestamp, side }
   * @returns {Promise<void>}
   */
  async _processFill(fillData) {
    if (!fillData || !fillData.orderId || !fillData.fillId) {
      this.logger.error(`[${this.exchangeName}] _processFill: Invalid fillData provided.`, { fillData });
      return;
    }

    this.logger.info(`[${this.exchangeName}] Processing fill ${fillData.fillId} for order ${fillData.orderId}`, { price: fillData.price, amount: fillData.amount || fillData.quantity });

    try {
      // 1. Record the fill
      await this.redisFillManager.add(fillData);

      // 2. Update the order associated with the fill
      let order = this.activeOrders.get(fillData.orderId);
      if (!order) {
        order = await this.redisOrderManager.get(fillData.orderId);
        if (order) this.activeOrders.set(fillData.orderId, order);
      }

      if (!order) {
        this.logger.error(`[${this.exchangeName}] Cannot process fill ${fillData.fillId}: Original order ${fillData.orderId} not found.`);
        return;
      }
      
      // Handle both 'amount' and 'quantity' fields for compatibility
      const filledAmountThisFill = parseFloat(fillData.amount || fillData.quantity);
      order.filled = (parseFloat(order.filled) || 0) + filledAmountThisFill;
      order.remaining = parseFloat(order.amount) - order.filled;
      
      let newStatus = order.status;
      if (order.remaining <= 0) { // Consider a small tolerance for float precision if needed
        newStatus = 'closed'; // Or 'filled'
        order.remaining = 0; // Ensure remaining is not negative
      } else if (order.filled > 0) {
        newStatus = 'partially-filled'; // Or 'partial'
      }
      // Potentially add averageFillPrice calculation here if needed

      await this._updateOrderStatus(order.id, newStatus, {
        filled: order.filled,
        remaining: order.remaining,
        // averageFillPrice: newAverageFillPrice (if calculated)
      });
      
      // 3. Update balances
      // The balanceManager should handle the logic of debiting/crediting based on fill side, amount, price, fee
      await this.balanceManager.applyFill(fillData);
      this.currentBalances = await this.balanceManager.getBalances(); // Refresh cached balances

      // 4. Emit 'orderFilled' event (with potentially enriched fillData or the order itself)
      this.emit('orderFilled', { ...fillData, orderStatus: newStatus, orderFilledAmount: order.filled, orderRemainingAmount: order.remaining });
      
      // 5. Emit 'balancesUpdated' event
      this.emit('balancesUpdated', this.currentBalances);

      if (newStatus === 'closed' || newStatus === 'filled') {
         this.activeOrders.delete(order.id); // Remove from active cache if fully filled/closed
      }

    } catch (error) {
      this.logger.error(`[${this.exchangeName}] Error processing fill ${fillData.fillId} for order ${fillData.orderId}: ${error.message}`, { error, fillData });
      this.emit('error', { type: 'FILL_PROCESSING_ERROR', message: error.message, details: fillData });
    }
  }

  /**
   * Standardized way to emit order book updates.
   * @protected
   * @param {Object} orderBook - The order book data.
   */
  _emitOrderBookUpdate(orderBook) {
    this.emit('orderBookUpdate', orderBook);
  }

  /**
   * Standardized way to emit trade updates.
   * @protected
   * @param {Object} trade - The trade data.
   */
  _emitTradeUpdate(trade) {
    this.emit('tradeUpdate', trade);
  }
  
  /**
   * Standardized way to emit balance updates.
   * @protected
   * @param {Object} balances - The balance data.
   */
  _emitBalancesUpdated(balances) {
    this.currentBalances = balances; // Update internal cache
    this.emit('balancesUpdated', balances);
  }

  /**
   * Standardized way to emit errors.
   * @protected
   * @param {String} type - Error type (e.g., 'CONNECTION_ERROR', 'API_ERROR')
   * @param {String} message - Error message
   * @param {Object} [details] - Additional error details
   */
  _emitError(type, message, details = {}) {
    this.logger.error(`[${this.exchangeName} Adapter Error] Type: ${type}, Message: ${message}`, details);
    this.emit('error', { type, message, exchange: this.exchangeName, ...details });
  }
}

export default BaseExchangeAdapter; 