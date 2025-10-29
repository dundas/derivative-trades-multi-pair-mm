/**
 * Cancel order methods for KrakenWebSocketV2ExchangeAdapter
 * These methods should be added to the adapter to support proper cleanup on session stop
 */

/**
 * Cancels all open buy orders managed by this adapter
 * @param {String} reason - Reason for cancellation
 * @returns {Promise<Array<Object>>} - Array of canceled order results
 */
async cancelOpenBuyOrders(reason = 'SESSION_CLEANUP') {
  this.logger.info(`[${this.exchangeName}] Cancelling all open buy orders. Reason: ${reason}`);
  
  try {
    // Get all open orders from the order manager
    const openOrders = await this.orderManager.getOpenOrders();
    
    // Filter for buy orders
    const openBuyOrders = openOrders.filter(order => 
      order.side === 'buy' && 
      (order.status === 'OPEN' || order.status === 'open')
    );
    
    this.logger.info(`[${this.exchangeName}] Found ${openBuyOrders.length} open buy orders to cancel`);
    
    const results = [];
    
    // Cancel each buy order
    for (const order of openBuyOrders) {
      try {
        const result = await this.cancelOrder(order.id, { reason });
        results.push({
          orderId: order.id,
          success: true,
          result
        });
      } catch (error) {
        this.logger.error(`[${this.exchangeName}] Failed to cancel order ${order.id}:`, error);
        results.push({
          orderId: order.id,
          success: false,
          error: error.message
        });
      }
    }
    
    this.logger.info(`[${this.exchangeName}] Buy order cancellation complete.`, {
      total: openBuyOrders.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
    
    return results;
  } catch (error) {
    this.logger.error(`[${this.exchangeName}] Error in cancelOpenBuyOrders:`, error);
    throw error;
  }
}

/**
 * Cancels all managed open orders on the exchange
 * @param {String} reason - The reason for cancelling all orders
 * @returns {Promise<Array<Object>>} - Array of cancellation results
 */
async cancelAllManagedOrders(reason = 'SESSION_CLEANUP') {
  this.logger.info(`[${this.exchangeName}] Cancelling all open orders. Reason: ${reason}`);
  
  try {
    // Get all open orders from the order manager
    const openOrders = await this.orderManager.getOpenOrders();
    
    this.logger.info(`[${this.exchangeName}] Found ${openOrders.length} open orders to cancel`);
    
    const results = [];
    
    // Cancel each order
    for (const order of openOrders) {
      try {
        const result = await this.cancelOrder(order.id, { reason });
        results.push({
          orderId: order.id,
          success: true,
          result
        });
      } catch (error) {
        this.logger.error(`[${this.exchangeName}] Failed to cancel order ${order.id}:`, error);
        results.push({
          orderId: order.id,
          success: false,
          error: error.message
        });
      }
    }
    
    this.logger.info(`[${this.exchangeName}] Order cancellation complete.`, {
      total: openOrders.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
    
    return results;
  } catch (error) {
    this.logger.error(`[${this.exchangeName}] Error in cancelAllManagedOrders:`, error);
    throw error;
  }
}

/**
 * Enhanced cancelOrder method for paper trading
 * Ensures proper status updates and persistence
 */
async cancelOrder(orderId, params = {}) {
  if (this.tradingMode === 'paper') {
    this.logger.info(`[${this.exchangeName}] Paper trading: Cancelling order ${orderId}`, params);
    
    try {
      // Get the order from order manager
      const order = await this.orderManager.get(orderId);
      
      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }
      
      if (order.status !== 'OPEN' && order.status !== 'open') {
        throw new Error(`Order ${orderId} is not open. Current status: ${order.status}`);
      }
      
      // Update order status
      const updatedOrder = {
        ...order,
        status: 'CANCELLED',
        canceledAt: Date.now(),
        lastUpdated: Date.now(),
        cancelReason: params.reason || 'USER_REQUESTED'
      };
      
      // Save to Redis via order manager
      await this.orderManager.update(updatedOrder);
      
      // Emit order status changed event
      this.emit('orderStatusChanged', {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        status: 'CANCELLED',
        timestamp: Date.now(),
        reason: params.reason
      });
      
      this.logger.info(`[${this.exchangeName}] Paper order ${orderId} cancelled successfully`);
      
      return {
        id: orderId,
        status: 'CANCELLED',
        success: true
      };
      
    } catch (error) {
      this.logger.error(`[${this.exchangeName}] Error cancelling paper order ${orderId}:`, error);
      throw error;
    }
  } else {
    // Live trading - use the WebSocket API
    return this._cancelOrderLive(orderId, params);
  }
}

// Export the methods
export { cancelOpenBuyOrders, cancelAllManagedOrders, cancelOrder };