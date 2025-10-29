/**
 * Flexible Fill Management System
 * 
 * This module implements a flexible fill discovery system that supports multiple
 * fill discovery mechanisms, including paper trading with midprice-based fills
 * and live trading with Kraken WebSocket executions.
 * 
 * See the specification document for more details:
 * /src/services/market-maker/docs/flexible-fill-management-specification.md
 */

/**
 * FillDiscoveryManager
 * 
 * Central coordinator that selects and manages fill discovery strategies.
 */
export class FillDiscoveryManager {
  /**
   * Create a new FillDiscoveryManager
   * @param {Object} options Configuration options
   * @param {Object} options.logger Logger instance
   * @param {string} options.tradingMode Trading mode ('paper' or 'live')
   * @param {Object} options.exchange Exchange client instance
   * @param {string} options.symbol Trading symbol
   * @param {Object} options.orderBookManager Order book manager instance
   * @param {Object} options.activeOrders Active orders object
   * @param {Function} options.onFill Callback function for fill notifications
   * @param {Object} options.fillManager Redis fill manager instance
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.tradingMode = options.tradingMode || 'paper';
    this.exchange = options.exchange;
    this.symbol = options.symbol;
    this.orderBookManager = options.orderBookManager;
    this.memoryManager = options.memoryManager; // Add memoryManager for direct order access
    this.activeOrders = options.activeOrders || {};
    this.onFill = options.onFill;
    this.fillManager = options.fillManager;
    this.orderManager = options.orderManager;
    
    // Initialize the appropriate fill discovery strategy
    this._initializeStrategy();
    
    this.logger.info('FillDiscoveryManager initialized', {
      tradingMode: this.tradingMode,
      symbol: this.symbol,
      hasMemoryManager: !!this.memoryManager,
      strategyType: this.strategy ? this.strategy.constructor.name : 'none'
    });
  }
  
  /**
   * Initialize the appropriate fill discovery strategy
   * @private
   */
  _initializeStrategy() {
    if (this.tradingMode === 'paper') {
      this.strategy = new MidpriceFillStrategy({
        logger: this.logger,
        symbol: this.symbol,
        orderBookManager: this.orderBookManager,
        onFill: this.onFill,
        memoryManager: this.memoryManager // Pass memoryManager to strategy
      });
    } else {
      this.strategy = new KrakenWebSocketFillStrategy({
        logger: this.logger,
        symbol: this.symbol,
        exchange: this.exchange,
        onFill: this.onFill
      });
    }
  }
  
  /**
   * Check for fills using the appropriate strategy
   * @param {Object} activeOrders Active orders object
   * @returns {Promise<Array>} Array of discovered fills
   */
  async checkForFills(activeOrders) {
    try {
      // Update active orders reference
      this.activeOrders = activeOrders;
      
      // Delegate to the appropriate strategy
      return await this.strategy.checkForFills(this.activeOrders);
    } catch (error) {
      this.logger.error('Error checking for fills', {
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }
  
  /**
   * Change the strategy at runtime
   * @param {string} strategyType Strategy type ('midprice' or 'websocket')
   */
  setStrategy(strategyType) {
    if (strategyType === 'midprice') {
      this.strategy = new MidpriceFillStrategy({
        logger: this.logger,
        symbol: this.symbol,
        orderBookManager: this.orderBookManager,
        onFill: this.onFill
      });
      this.logger.info('Switched to MidpriceFillStrategy');
    } else if (strategyType === 'websocket') {
      this.strategy = new KrakenWebSocketFillStrategy({
        logger: this.logger,
        symbol: this.symbol,
        exchange: this.exchange,
        onFill: this.onFill
      });
      this.logger.info('Switched to KrakenWebSocketFillStrategy');
    } else {
      this.logger.warn(`Unknown strategy type: ${strategyType}`);
    }
  }
  
  /**
   * Get the current strategy
   * @returns {Object} Current strategy
   */
  getStrategy() {
    return this.strategy;
  }
}

/**
 * MidpriceFillStrategy
 * 
 * Discovers fills based on midprice for paper trading.
 */
export class MidpriceFillStrategy {
  /**
   * Create a new MidpriceFillStrategy
   * @param {Object} options Configuration options
   * @param {Object} options.logger Logger instance
   * @param {string} options.symbol Trading symbol
   * @param {Object} options.orderBookManager Order book manager instance
   * @param {Function} options.onFill Callback function for fill notifications
   * @param {Object} options.memoryManager Memory manager for accessing active orders
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.symbol = options.symbol;
    this.orderBookManager = options.orderBookManager;
    this.onFill = options.onFill;
    this.memoryManager = options.memoryManager;
    
    this.logger.info('MidpriceFillStrategy initialized', {
      symbol: this.symbol,
      hasMemoryManager: !!this.memoryManager
    });
  }
  
  /**
   * Check for fills based on midprice
   * @param {Object} [passedOrders] Optional active orders object (for backward compatibility)
   * @returns {Promise<Array>} Array of discovered fills
   */
  async checkForFills(passedOrders) {
    try {
      // Get active orders - first try memory manager, then fallback to passed orders
      let activeOrders = {};
      
      if (this.memoryManager) {
        // Get active orders from memory manager
        const ordersFromMemory = this.memoryManager.getOrder('active_orders');
        if (ordersFromMemory) {
          activeOrders = ordersFromMemory;
          this.logger.debug('Retrieved active orders from memory manager', {
            bidOrder: activeOrders.bid ? activeOrders.bid.id : 'none',
            askOrder: activeOrders.ask ? activeOrders.ask.id : 'none'
          });
        } else {
          this.logger.debug('No active orders found in memory manager');
          
          // Fall back to orders passed to the method (for backward compatibility)
          if (passedOrders) {
            activeOrders = passedOrders;
            this.logger.debug('Using passed orders for fill checking');
          }
        }
      } else if (passedOrders) {
        // No memory manager, use orders passed to the method
        activeOrders = passedOrders;
        this.logger.debug('No memory manager available, using passed orders');
      }
      
      // Get the latest orderbook - use the lastSnapshot property or getRecentOrderbooks method
      let orderBook = null;
      
      if (this.orderBookManager.lastSnapshot) {
        // Use the lastSnapshot property directly
        orderBook = this.orderBookManager.lastSnapshot;
        this.logger.debug('Using lastSnapshot for fill checking');
      } else {
        // Fall back to getting the most recent orderbook from the buffer
        const recentOrderbooks = this.orderBookManager.getRecentOrderbooks(1000); // Get orderbooks from last second
        if (recentOrderbooks && recentOrderbooks.length > 0) {
          orderBook = recentOrderbooks[0]; // Get the most recent one
          this.logger.debug('Using recent orderbook for fill checking', { timestamp: orderBook.timestamp });
        }
      }
      
      if (!orderBook) {
        this.logger.debug('No orderbook available for fill checking');
        return [];
      }
      
      // Calculate midprice
      const midprice = this._calculateMidprice(orderBook);
      if (!midprice) {
        this.logger.debug('Could not calculate midprice for fill checking');
        return [];
      }
      
      const activeOrderCount = Object.keys(activeOrders)
        .filter(k => activeOrders[k])
        .length;
        
      this.logger.debug('Checking for fills with midprice', { midprice, activeOrderCount });
      
      const fills = [];
      
      // Check each active order against the midprice
      for (const [side, order] of Object.entries(activeOrders)) {
        if (!order) {
          this.logger.debug(`No active ${side} order to check`);
          continue;
        }
        
        this.logger.debug(`Checking ${side} order for fill`, { 
          orderId: order.id, 
          orderPrice: order.price, 
          midprice,
          priceDiff: side === 'buy' ? (order.price - midprice) : (midprice - order.price)
        });
        
        const shouldFill = this._shouldFillOrder(order, midprice);
        if (shouldFill) {
          const fill = this._createFill(order, midprice);
          fills.push(fill);
          
          this.logger.info(`Fill discovered for ${order.side} order ${order.id} at ${midprice}`, {
            orderId: order.id,
            side: order.side,
            orderPrice: order.price,
            fillPrice: midprice
          });
          
          // Notify via callback
          if (this.onFill) {
            this.onFill(fill);
          }
        }
      }
      
      return fills;
    } catch (error) {
      this.logger.error('Error checking for fills with midprice strategy', {
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }
  
  /**
   * Calculate midprice from order book
   * @param {Object} orderBook Order book object
   * @returns {number|null} Midprice or null if not available
   * @private
   */
  _calculateMidprice(orderBook) {
    if (!orderBook || !orderBook.bids || !orderBook.asks || 
        !orderBook.bids.length || !orderBook.asks.length) {
      return null;
    }
    
    const bestBid = parseFloat(orderBook.bids[0][0]);
    const bestAsk = parseFloat(orderBook.asks[0][0]);
    
    return (bestBid + bestAsk) / 2;
  }
  
  /**
   * Determine if an order should be filled
   * @param {Object} order Order object
   * @param {number} midprice Current midprice
   * @returns {boolean} Whether the order should be filled
   * @private
   */
  _shouldFillOrder(order, midprice) {
    if (!order || !order.price) return false;
    
    const orderPrice = parseFloat(order.price);
    
    // For buy orders, fill if midprice <= order price
    if (order.side === 'buy') {
      return midprice <= orderPrice;
    }
    
    // For sell orders, fill if midprice >= order price
    if (order.side === 'sell') {
      return midprice >= orderPrice;
    }
    
    return false;
  }
  
  /**
   * Create a fill object
   * @param {Object} order Order object
   * @param {number} price Fill price
   * @returns {Object} Fill object
   * @private
   */
  _createFill(order, price) {
    return {
      id: `fill-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId: order.id,
      price,
      size: order.size || order.amount,
      side: order.side,
      symbol: this.symbol,
      timestamp: Date.now(),
      fee: (order.size || order.amount) * price * 0.0026 // Simulate 0.26% fee
    };
  }
}

/**
 * KrakenWebSocketFillStrategy
 * 
 * Discovers fills from Kraken WebSocket executions API.
 */
export class KrakenWebSocketFillStrategy {
  /**
   * Create a new KrakenWebSocketFillStrategy
   * @param {Object} options Configuration options
   * @param {Object} options.logger Logger instance
   * @param {string} options.symbol Trading symbol
   * @param {Object} options.exchange Exchange client instance
   * @param {Function} options.onFill Callback function for fill notifications
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.symbol = options.symbol;
    this.exchange = options.exchange;
    this.onFill = options.onFill;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000; // 5 seconds
    
    // Initialize WebSocket connection
    this._initializeWebSocket();
    
    this.logger.info('KrakenWebSocketFillStrategy initialized', {
      symbol: this.symbol
    });
  }
  
  /**
   * Initialize WebSocket connection
   * @private
   */
  async _initializeWebSocket() {
    try {
      // Check if exchange has WebSocket support
      if (!this.exchange || !this.exchange.subscribeToExecutions) {
        this.logger.warn('Exchange does not support executions WebSocket');
        return;
      }
      
      // Subscribe to executions
      await this.exchange.subscribeToExecutions(this.symbol, this._handleExecution.bind(this));
      this.connected = true;
      this.reconnectAttempts = 0;
      this.logger.info(`Subscribed to executions for ${this.symbol}`);
    } catch (error) {
      this.logger.error('Error initializing WebSocket for executions', {
        error: error.message,
        stack: error.stack
      });
      
      // Attempt to reconnect
      this._scheduleReconnect();
    }
  }
  
  /**
   * Schedule a reconnection attempt
   * @private
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`Maximum reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    
    this.logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => this._reconnectWebSocket(), delay);
  }
  
  /**
   * Attempt to reconnect WebSocket
   * @private
   */
  async _reconnectWebSocket() {
    try {
      this.logger.info('Attempting to reconnect WebSocket');
      await this._initializeWebSocket();
    } catch (error) {
      this.logger.error('Failed to reconnect WebSocket', {
        error: error.message
      });
      
      // Schedule another reconnection attempt
      this._scheduleReconnect();
    }
  }
  
  /**
   * Handle execution message from WebSocket
   * @param {Object} execution Execution object from WebSocket
   * @private
   */
  _handleExecution(execution) {
    try {
      if (!execution || !execution.orderId) {
        this.logger.warn('Received invalid execution', { execution });
        return;
      }
      
      this.logger.info('Received execution from WebSocket', { execution });
      
      // Create a fill from the execution
      const fill = {
        id: execution.id || `fill-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        orderId: execution.orderId,
        price: execution.price,
        size: execution.volume || execution.size,
        side: execution.side,
        symbol: this.symbol,
        timestamp: execution.time || Date.now(),
        fee: execution.fee || 0
      };
      
      // Notify via callback
      if (this.onFill) {
        this.onFill(fill);
      }
    } catch (error) {
      this.logger.error('Error handling execution', {
        error: error.message,
        execution
      });
    }
  }
  
  /**
   * Check for fills (placeholder method for interface consistency)
   * @param {Object} activeOrders Active orders object
   * @returns {Promise<Array>} Empty array (fills are handled via WebSocket)
   */
  async checkForFills(activeOrders) {
    // For WebSocket strategy, fills are handled via the WebSocket
    // This method is just a placeholder to maintain the interface
    return [];
  }
}

export default FillDiscoveryManager;
