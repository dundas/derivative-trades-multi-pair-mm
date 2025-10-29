/**
 * TakeProfitManager - Manages take-profit order creation with duplicate prevention
 * 
 * This class ensures that only one take-profit order is created per buy order,
 * preventing race conditions when multiple fill events arrive simultaneously.
 */

export class TakeProfitManager {
  constructor(logger) {
    this.logger = logger;
    this.processingLocks = new Map(); // Maps buyOrderId -> processing promise
    this.completedTakeProfits = new Set(); // Set of buyOrderIds that have TP orders
    this.failedAttempts = new Map(); // Maps buyOrderId -> { count, lastAttempt, reason }
    this.maxRetries = 3; // Maximum retry attempts per order
    this.retryBackoffMs = 30000; // 30 seconds backoff between retries
    this.insufficientFundsBackoffMs = 300000; // 5 minutes backoff for insufficient funds
  }

  /**
   * Checks if a take-profit order can be created for a buy order
   * @param {string} buyOrderId - The ID of the buy order
   * @param {Function} checkExistingOrders - Function to check existing orders
   * @returns {Promise<boolean>} - True if TP can be created, false otherwise
   */
  async canCreateTakeProfit(buyOrderId, checkExistingOrders) {
    // Check if we've already completed processing for this buy order
    if (this.completedTakeProfits.has(buyOrderId)) {
      this.logger.info('[TakeProfitManager] Take-profit already exists for buy order', { buyOrderId });
      return false;
    }

    // Check retry limits and backoff
    const failureInfo = this.failedAttempts.get(buyOrderId);
    if (failureInfo) {
      const now = Date.now();
      const timeSinceLastAttempt = now - failureInfo.lastAttempt;
      
      // Check if we've exceeded max retries
      if (failureInfo.count >= this.maxRetries) {
        this.logger.warn('[TakeProfitManager] Max retries exceeded for buy order', { 
          buyOrderId, 
          attempts: failureInfo.count,
          lastReason: failureInfo.reason 
        });
        // Mark as completed to stop retries
        this.completedTakeProfits.add(buyOrderId);
        return false;
      }
      
      // Check backoff period based on failure reason
      const requiredBackoff = failureInfo.reason === 'INSUFFICIENT_FUNDS' 
        ? this.insufficientFundsBackoffMs 
        : this.retryBackoffMs;
        
      if (timeSinceLastAttempt < requiredBackoff) {
        const remainingBackoff = Math.ceil((requiredBackoff - timeSinceLastAttempt) / 1000);
        this.logger.debug('[TakeProfitManager] Still in backoff period for buy order', { 
          buyOrderId, 
          remainingSeconds: remainingBackoff,
          reason: failureInfo.reason
        });
        return false;
      }
      
      this.logger.info('[TakeProfitManager] Retrying take-profit creation after backoff', { 
        buyOrderId, 
        attempt: failureInfo.count + 1,
        lastReason: failureInfo.reason
      });
    }

    // Check if we're already processing this buy order
    if (this.processingLocks.has(buyOrderId)) {
      this.logger.info('[TakeProfitManager] Already processing take-profit for buy order, waiting...', { buyOrderId });
      // Wait for the existing processing to complete
      try {
        await this.processingLocks.get(buyOrderId);
      } catch (error) {
        // Previous processing failed, log the error
        this.logger.warn('[TakeProfitManager] Previous processing failed', { buyOrderId, error: error.message });
      }
      
      // After waiting, another process has handled this (successfully or not)
      // We should NOT proceed to avoid duplicates
      this.logger.info('[TakeProfitManager] Another process handled take-profit for buy order', { buyOrderId });
      return false;
    }

    // Create a processing lock - we are the first process to handle this buy order
    let resolveProcessing;
    let rejectProcessing;
    const processingPromise = new Promise((resolve, reject) => {
      resolveProcessing = resolve;
      rejectProcessing = reject;
    });
    this.processingLocks.set(buyOrderId, processingPromise);

    this.logger.info('[TakeProfitManager] Acquired processing lock for buy order', { buyOrderId });

    try {
      // Double-check completedTakeProfits after acquiring lock
      if (this.completedTakeProfits.has(buyOrderId)) {
        this.logger.info('[TakeProfitManager] Take-profit was created while acquiring lock', { buyOrderId });
        resolveProcessing(false);
        this.processingLocks.delete(buyOrderId);
        return false;
      }

      // Check existing orders in Redis
      const existingOrders = await checkExistingOrders();
      
      // Filter for sell orders with this buy order as parent
      const relatedSellOrders = existingOrders.filter(order => 
        order.parentOrderId === buyOrderId && 
        (order.side === 'sell' || order.side === 'SELL')
      );
      
      // Check if there's any open sell order
      const hasOpenSellOrder = relatedSellOrders.some(order => 
        order.status === 'open' || order.status === 'OPEN' || 
        order.status === 'new' || order.status === 'NEW' ||
        order.status === 'pending' || order.status === 'PENDING'
      );
      
      // Check if there's any filled/closed sell order
      const hasFilledSellOrder = relatedSellOrders.some(order => 
        order.status === 'filled' || order.status === 'FILLED' || 
        order.status === 'closed' || order.status === 'CLOSED' ||
        order.status === 'COMPLETED' || order.status === 'completed'
      );
      
      if (hasOpenSellOrder || hasFilledSellOrder) {
        this.logger.info('[TakeProfitManager] Existing sell order found in Redis', {
          buyOrderId,
          hasOpenSellOrder,
          hasFilledSellOrder,
          relatedSellOrders: relatedSellOrders.map(o => ({
            id: o.id,
            status: o.status,
            parentOrderId: o.parentOrderId
          }))
        });
        resolveProcessing(false);
        this.processingLocks.delete(buyOrderId);
        this.completedTakeProfits.add(buyOrderId); // Mark as completed
        // Clear any failure records since we found existing orders
        this.failedAttempts.delete(buyOrderId);
        return false;
      }

      // No existing orders found, we can proceed to create take-profit
      this.logger.info('[TakeProfitManager] No existing sell orders found, can proceed with take-profit', { buyOrderId });
      resolveProcessing(true);
      // CRITICAL FIX: Delete the lock when returning true so subsequent calls don't get blocked
      this.processingLocks.delete(buyOrderId);
      return true;
    } catch (error) {
      this.logger.error('[TakeProfitManager] Error checking existing orders', {
        buyOrderId,
        error: error.message,
        stack: error.stack
      });
      rejectProcessing(error);
      this.processingLocks.delete(buyOrderId);
      throw error;
    }
  }

  /**
   * Marks a take-profit order as successfully created
   * @param {string} buyOrderId - The ID of the buy order
   */
  markTakeProfitCreated(buyOrderId) {
    this.completedTakeProfits.add(buyOrderId);
    this.processingLocks.delete(buyOrderId);
    // Clear any failure records on success
    this.failedAttempts.delete(buyOrderId);
    this.logger.info('[TakeProfitManager] Take-profit marked as created', { buyOrderId });
  }

  /**
   * Marks a take-profit creation as failed with retry logic
   * @param {string} buyOrderId - The ID of the buy order
   * @param {string} reason - The reason for failure (e.g., 'INSUFFICIENT_FUNDS', 'EXCHANGE_ERROR')
   */
  markTakeProfitFailed(buyOrderId, reason = 'UNKNOWN') {
    this.processingLocks.delete(buyOrderId);
    
    // Update failure tracking
    const currentFailure = this.failedAttempts.get(buyOrderId) || { count: 0, lastAttempt: 0, reason: '' };
    const updatedFailure = {
      count: currentFailure.count + 1,
      lastAttempt: Date.now(),
      reason: reason
    };
    this.failedAttempts.set(buyOrderId, updatedFailure);
    
    this.logger.warn('[TakeProfitManager] Take-profit creation failed', { 
      buyOrderId, 
      reason,
      attempt: updatedFailure.count,
      maxRetries: this.maxRetries
    });
    
    // If we've exceeded max retries, mark as completed to stop retries
    if (updatedFailure.count >= this.maxRetries) {
      this.completedTakeProfits.add(buyOrderId);
      this.logger.error('[TakeProfitManager] Max retries exceeded, giving up on take-profit', { 
        buyOrderId, 
        totalAttempts: updatedFailure.count,
        finalReason: reason
      });
    }
  }

  /**
   * Removes a take-profit record (e.g., when the sell order is cancelled)
   * @param {string} buyOrderId - The ID of the buy order
   */
  removeTakeProfit(buyOrderId) {
    this.completedTakeProfits.delete(buyOrderId);
    this.processingLocks.delete(buyOrderId);
    this.failedAttempts.delete(buyOrderId);
    this.logger.info('[TakeProfitManager] Take-profit record removed', { buyOrderId });
  }

  /**
   * Clears all locks and records (for cleanup)
   */
  clear() {
    this.processingLocks.clear();
    this.completedTakeProfits.clear();
    this.failedAttempts.clear();
    this.logger.info('[TakeProfitManager] All records cleared');
  }

  /**
   * Clears stale processing locks that may be stuck
   * This is a recovery mechanism for locks that never completed
   */
  clearStaleLocks() {
    const staleLockCount = this.processingLocks.size;
    if (staleLockCount > 0) {
      this.logger.warn(`[TakeProfitManager] Clearing ${staleLockCount} stale processing locks`);
      this.processingLocks.clear();
    }
  }

  /**
   * Gets statistics about take-profit management
   * @returns {Object} Statistics object
   */
  getStats() {
    const failedOrders = Array.from(this.failedAttempts.entries()).map(([buyOrderId, info]) => ({
      buyOrderId,
      attempts: info.count,
      lastAttempt: new Date(info.lastAttempt).toISOString(),
      reason: info.reason
    }));

    return {
      completedTakeProfits: this.completedTakeProfits.size,
      processingLocks: this.processingLocks.size,
      failedOrders: failedOrders.length,
      failedOrderDetails: failedOrders
    };
  }
}