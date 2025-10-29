/**
 * FastExecutionEngine
 * 
 * Handles rapid order execution for opportunities with validation and timing constraints
 */

export class FastExecutionEngine {
  constructor(options = {}) {
    this.exchangeAdapter = options.exchangeAdapter;
    this.maxExecutionDelay = options.maxExecutionDelay || 3000; // 3 seconds
    this.logger = options.logger;
    
    // Execution tracking with memory management
    this.recentExecutions = new Map(); // pair -> last execution time
    this.minTimeBetweenExecutions = 5000; // 5 seconds between executions per pair
    this.maxExecutionHistory = 100; // Maximum number of executions to track
    this.executionCleanupInterval = 60000; // Clean up old executions every minute
    
    // Start periodic cleanup
    this._startCleanupInterval();
  }
  
  /**
   * Start periodic cleanup of old execution records
   * @private
   */
  _startCleanupInterval() {
    this.cleanupTimer = setInterval(() => {
      this._cleanupOldExecutions();
    }, this.executionCleanupInterval);
  }
  
  /**
   * Clean up old execution records to prevent memory growth
   * @private
   */
  _cleanupOldExecutions() {
    const now = Date.now();
    const cutoffTime = now - (this.minTimeBetweenExecutions * 2);
    
    // Remove entries older than 2x the minimum time between executions
    for (const [pair, executionTime] of this.recentExecutions.entries()) {
      if (executionTime < cutoffTime) {
        this.recentExecutions.delete(pair);
      }
    }
    
    // Enforce maximum size limit
    if (this.recentExecutions.size > this.maxExecutionHistory) {
      // Sort by execution time and keep only the most recent
      const sortedEntries = Array.from(this.recentExecutions.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.maxExecutionHistory);
      
      this.recentExecutions.clear();
      for (const [pair, time] of sortedEntries) {
        this.recentExecutions.set(pair, time);
      }
    }
    
    this.logger?.debug('Cleaned up execution history', {
      entriesRemaining: this.recentExecutions.size
    });
  }
  
  /**
   * Clean up resources when shutting down
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.recentExecutions.clear();
  }
  
  /**
   * Execute a trading opportunity
   * @param {Object} opportunity - Opportunity to execute
   * @param {Number} size - Position size
   * @returns {Object} Execution result
   */
  async executeOpportunity(opportunity, size) {
    const startTime = Date.now();
    
    try {
      // Check if opportunity is still valid
      const timeSinceDetection = startTime - opportunity.timestamp;
      if (timeSinceDetection > this.maxExecutionDelay) {
        this.logger?.warn('Opportunity expired', {
          pair: opportunity.pair,
          age: timeSinceDetection,
          maxAge: this.maxExecutionDelay
        });
        return { executed: false, reason: 'Opportunity expired' };
      }
      
      // Check recent executions
      if (!this._canExecuteForPair(opportunity.pair)) {
        return { executed: false, reason: 'Too soon after last execution' };
      }
      
      // Validate opportunity is still valid
      const validationResult = await this._validateOpportunity(opportunity);
      if (!validationResult.valid) {
        return { executed: false, reason: validationResult.reason };
      }
      
      // Calculate order parameters
      const orderParams = this._calculateOrderParams(opportunity, size);
      
      // Place the order
      const order = await this._placeOrder(orderParams);
      
      if (order && order.id) {
        // Update recent executions
        this.recentExecutions.set(opportunity.pair, Date.now());
        
        const executionTime = Date.now() - startTime;
        
        this.logger?.info('Order executed successfully', {
          pair: opportunity.pair,
          orderId: order.id,
          side: orderParams.side,
          size: orderParams.amount,
          price: orderParams.price,
          executionTime
        });
        
        return {
          executed: true,
          order,
          executionTime,
          opportunity
        };
      } else {
        return {
          executed: false,
          reason: 'Order placement failed'
        };
      }
      
    } catch (error) {
      this.logger?.error('Execution error', {
        pair: opportunity.pair,
        error: error.message
      });
      
      return {
        executed: false,
        reason: error.message,
        error
      };
    }
  }
  
  /**
   * Check if we can execute for this pair
   * @private
   */
  _canExecuteForPair(pair) {
    const lastExecution = this.recentExecutions.get(pair);
    if (!lastExecution) return true;
    
    return (Date.now() - lastExecution) >= this.minTimeBetweenExecutions;
  }
  
  /**
   * Validate opportunity is still valid
   * @private
   */
  async _validateOpportunity(opportunity) {
    // In a real implementation, this would:
    // 1. Check current market prices
    // 2. Verify the signal still exists
    // 3. Confirm liquidity is available
    
    // For now, basic validation
    if (!opportunity.signal || !opportunity.pair) {
      return { valid: false, reason: 'Invalid opportunity structure' };
    }
    
    return { valid: true };
  }
  
  /**
   * Calculate order parameters
   * @private
   */
  _calculateOrderParams(opportunity, size) {
    const side = opportunity.signal.direction === 'BUY' ? 'buy' : 'sell';
    
    // Calculate entry price based on current market
    let price;
    if (side === 'buy') {
      // For buy orders, use slightly above current ask to ensure fill
      price = opportunity.marketData.spotAsk * 1.0001;
    } else {
      // For sell orders, use slightly below current bid
      price = opportunity.marketData.spotBid * 0.9999;
    }
    
    return {
      symbol: opportunity.pair,
      type: 'limit',
      side,
      price,
      amount: size,
      clientOrderId: `opp_${opportunity.id}`,
      params: {
        postOnly: false, // We want fast execution
        timeInForce: 'IOC' // Immediate or cancel
      }
    };
  }
  
  /**
   * Place order on exchange
   * @private
   */
  async _placeOrder(orderParams) {
    if (!this.exchangeAdapter) {
      throw new Error('No exchange adapter configured');
    }
    
    return await this.exchangeAdapter.createOrder(orderParams);
  }
}

export default FastExecutionEngine;