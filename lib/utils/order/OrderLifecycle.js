/**
 * Order Lifecycle
 * 
 * Manages the lifecycle of an order, tracking its state transitions
 * and providing methods to update and query its status.
 */

import OrderStatus from './OrderStatus.js';

export class OrderLifecycle {
  /**
   * Create a new OrderLifecycle.
   * Initializes the order with provided data, inferring status if not given.
   * Prioritizes specific amount/fill/status fields if aliases are present.
   * @param {Object} orderData Initial order data.
   * @param {string} [orderData.id] Unique order identifier.
   * @param {string} [orderData.clientOrderId] Client-assigned order identifier.
   * @param {string} [orderData.symbol] Trading symbol (e.g., BTC/USD).
   * @param {string} [orderData.side] Order side ('buy' or 'sell').
   * @param {string} [orderData.type] Order type (e.g., 'limit', 'market').
   * @param {number} [orderData.price] Order price.
   * @param {number} [orderData.amount=0] Total order amount.
   * @param {number} [orderData.filledAmount] Initial filled amount (preferred over `orderData.filled`).
   * @param {number} [orderData.filled] Initial filled amount.
   * @param {number} [orderData.remainingAmount] Initial remaining amount (preferred over `orderData.remaining`).
   * @param {number} [orderData.remaining] Initial remaining amount.
   * @param {string} [orderData.status] Initial order status (e.g., from OrderStatus). Inferred if not provided.
   * @param {number} [orderData.createdAt] Timestamp of order creation (milliseconds since epoch). Defaults to `Date.now()`.
   * @param {number} [orderData.updatedAt] Timestamp of last update (milliseconds since epoch). Defaults to `createdAt`.
   * @param {Array<Object>} [orderData.fills] Array of initial fill objects.
   */
  constructor(orderData = {}) {
    this.id = orderData.id;
    this.clientOrderId = orderData.clientOrderId;
    this.symbol = orderData.symbol;
    this.side = orderData.side;
    this.type = orderData.type;
    this.price = orderData.price; // Order price

    this.amount = typeof orderData.amount === 'number' ? orderData.amount : 0;

    this.createdAt = orderData.createdAt || Date.now();
    // If updatedAt is provided, use it; otherwise, use createdAt for initial history.
    // Status updates will correctly set updatedAt.
    this.updatedAt = orderData.updatedAt || this.createdAt;

    this.fills = Array.isArray(orderData.fills) ? [...orderData.fills] : [];

    // Initialize filled amount
    let initialFilled = 0;
    if (typeof orderData.filledAmount === 'number') {
      initialFilled = orderData.filledAmount;
    } else if (typeof orderData.filled === 'number') {
      initialFilled = orderData.filled;
    } else if (this.fills.length > 0) {
      // Fallback to summing fills if explicit filled amount not given
      // This might be complex if fills don't have 'amount'. Assuming simple structure for now or that this path isn't common.
      initialFilled = this.fills.reduce((sum, fill) => sum + (fill.amount || 0), 0);
    }
    this.filled = initialFilled;

    // Initialize remaining amount
    if (typeof orderData.remainingAmount === 'number') {
      this.remaining = orderData.remainingAmount;
    } else if (typeof orderData.remaining === 'number') {
      this.remaining = orderData.remaining;
    } else {
      this.remaining = this.amount - this.filled;
    }
    
    // Ensure remaining isn't negative if inconsistent data provided
    if (this.remaining < 0) this.remaining = 0;
    if (this.filled > this.amount) this.filled = this.amount;


    // Determine initial status
    let initialStatus = orderData.status;

    if (this.amount > 0 && this.filled >= this.amount) {
      initialStatus = OrderStatus.FILLED; // Override if logically filled
    } else if (initialStatus) {
      this.status = initialStatus;
    } else {
      if (this.amount === 0 && this.filled === 0) {
        this.status = OrderStatus.PENDING;
      } else if (this.filled > 0 && this.filled < this.amount) {
        this.status = OrderStatus.PARTIALLY_FILLED;
      } else if (this.filled === 0 && this.amount > 0) {
        this.status = OrderStatus.PENDING; // Default for new, unfilled orders
      } else {
        this.status = OrderStatus.PENDING; // Fallback
      }
    }
    
    // If a status was explicitly provided, use it unless completely overridden by fill state
    if (orderData.status && initialStatus !== OrderStatus.FILLED) {
        this.status = orderData.status;
    } else {
        this.status = initialStatus || OrderStatus.PENDING;
    }
    
    // Final sanity check for FILLED status based on amounts, this takes precedence.
    if (this.amount > 0 && this.filled >= this.amount) {
        this.status = OrderStatus.FILLED;
        this.remaining = 0; // Ensure remaining is zero if filled
    }


    this.history = [
      {
        status: this.status,
        timestamp: this.updatedAt, // Use updatedAt for the first history event
        data: { ...orderData }
      }
    ];
  }

  /**
   * Get the current status of the order
   * @returns {string} Order status
   */
  getStatus() {
    return this.status;
  }

  /**
   * Get the order price
   * @returns {number} Order price
   */
  getPrice() {
    return this.price;
  }

  /**
   * Get the order amount
   * @returns {number} Order amount
   */
  getAmount() {
    return this.amount;
  }

  /**
   * Get the filled amount
   * @returns {number} Filled amount
   */
  getFilled() {
    return this.filled;
  }

  /**
   * Get the remaining amount
   * @returns {number} Remaining amount
   */
  getRemaining() {
    return this.remaining;
  }

  /**
   * Get the fill percentage
   * @returns {number} Fill percentage (0-100)
   */
  getFillPercentage() {
    if (this.amount === 0) return 0;
    return (this.filled / this.amount) * 100;
  }

  /**
   * Get all fills for this order
   * @returns {Array} List of fills
   */
  getFills() {
    return [...this.fills];
  }

  /**
   * Get the order history
   * @returns {Array} Order history
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Set the order as open
   * @param {Object} [data={}] Additional data
   * @returns {OrderLifecycle} This instance for chaining
   */
  setOpen(data = {}) {
    this._updateStatus(OrderStatus.OPEN, data);
    return this;
  }

  /**
   * Set the order as filled.
   * Updates status, filled/remaining amounts, and adds a fill record.
   * The fill record's price prioritizes `data.averageFillPrice`, then `data.price`, then the order's original price.
   * The fill record's timestamp prioritizes `data.timestamp` (exchange event time) over `Date.now()`.
   * @param {Object} [data={}] Fill data.
   * @param {number} [data.amount] The amount filled in this specific event. If not provided, assumes the entire remaining amount was filled.
   * @param {number} [data.price] Price of this fill event.
   * @param {number} [data.averageFillPrice] Average fill price for the order, preferred for the fill record if provided.
   * @param {number} [data.timestamp] Timestamp of the fill event from the exchange. Defaults to `Date.now()`.
   * @returns {OrderLifecycle} This instance for chaining.
   */
  setFilled(data = {}) {
    const fillAmount = data.amount || this.remaining; // Amount of this specific fill event
    
    // Add fill record
    if (fillAmount > 0 || (this.amount > 0 && this.filled < this.amount)) { // Add fill if there's an amount or if order wasn't fully filled before
      const fillPrice = data.averageFillPrice || data.price || this.price;
      const fillTimestamp = data.timestamp || Date.now();
      const fillEventData = { ...data };
      delete fillEventData.averageFillPrice;
      delete fillEventData.price;
      delete fillEventData.timestamp;

      this.fills.push({
        amount: fillAmount > 0 ? fillAmount : (this.amount - this.filled), // ensure fill amount is calculated correctly if not provided
        price: fillPrice,
        timestamp: fillTimestamp,
        ...fillEventData
      });
    }
    
    // Update filled and remaining amounts
    this.filled = this.amount;
    this.remaining = 0;
    
    this._updateStatus(OrderStatus.FILLED, data);
    return this;
  }

  /**
   * Apply a partial fill to the order.
   * Updates status, filled/remaining amounts, and adds a fill record.
   * The fill record's price uses `fillData.price` or the order's original price.
   * The fill record's timestamp prioritizes `fillData.timestamp` (exchange event time) over `Date.now()`.
   * @param {Object} fillData Fill data.
   * @param {number} fillData.amount Amount of this partial fill. Must be positive.
   * @param {number} [fillData.price] Price of this partial fill. Defaults to order price if not provided.
   * @param {number} [fillData.timestamp] Timestamp of the fill event from the exchange. Defaults to `Date.now()`.
   * @returns {OrderLifecycle} This instance for chaining.
   */
  setPartialFill(fillData = {}) {
    const amount = fillData.amount || fillData.quantity;
    if (!amount || amount <= 0) {
      throw new Error('Fill amount must be positive');
    }
    
    const fillAmount = Math.min(amount, this.remaining); // This is the delta amount for this event
    
    // Add fill record
    const fillPrice = fillData.price || this.price; // For partial, usually use the specific fill's price
    const fillTimestamp = fillData.timestamp || Date.now(); // Prioritize provided timestamp
    const fillEventData = { ...fillData };
    delete fillEventData.price;
    delete fillEventData.timestamp;


    this.fills.push({
      amount: fillAmount,
      price: fillPrice,
      timestamp: fillTimestamp,
      ...fillEventData
    });
    
    // Update filled and remaining amounts
    this.filled += fillAmount;
    this.remaining -= fillAmount;
    
    // Update status
    if (this.remaining <= 0) {
      this._updateStatus(OrderStatus.FILLED, fillData);
    } else {
      this._updateStatus(OrderStatus.PARTIALLY_FILLED, fillData);
    }
    
    return this;
  }

  /**
   * Set the order as cancelled
   * @param {Object} [data={}] Additional data
   * @returns {OrderLifecycle} This instance for chaining
   */
  setCancelled(data = {}) {
    this._updateStatus(OrderStatus.CANCELLED, data);
    return this;
  }

  /**
   * Set the order as rejected
   * @param {Object} [data={}] Additional data
   * @returns {OrderLifecycle} This instance for chaining
   */
  setRejected(data = {}) {
    this._updateStatus(OrderStatus.REJECTED, data);
    return this;
  }

  /**
   * Set the order as expired
   * @param {Object} [data={}] Additional data
   * @returns {OrderLifecycle} This instance for chaining
   */
  setExpired(data = {}) {
    this._updateStatus(OrderStatus.EXPIRED, data);
    return this;
  }

  /**
   * Update the order status
   * @param {string} status New status
   * @param {Object} [data={}] Additional data
   * @private
   */
  _updateStatus(status, data = {}) {
    this.status = status;
    this.updatedAt = Date.now();
    
    this.history.push({
      status,
      timestamp: this.updatedAt,
      data: { ...data }
    });
  }
}

export default OrderLifecycle;
