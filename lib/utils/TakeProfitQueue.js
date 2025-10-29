/**
 * TakeProfitQueue - Simple Redis-backed take-profit queue
 * 
 * Manages a single FIFO queue of buy orders that need take-profit orders created.
 * Uses Redis for persistence and prevents duplicates.
 */

export class TakeProfitQueue {
  constructor(logger, redisClient, sessionId, marketMaker = null) {
    this.logger = logger;
    this.redisClient = redisClient;
    this.sessionId = sessionId;
    this.marketMaker = marketMaker;
    
    // Single Redis queue key
    this.queueKey = `takeprofit:queue:${sessionId}`;
    
    // Configuration
    this.processingIntervalMs = 2000; // Check queue every 2 seconds
    this.maxRetries = 3;
    
    // State
    this.processing = false;
    this.processingInterval = null;
    
    // Don't auto-start processing - let market maker start it when ready
    this.logger.info('[TakeProfitQueue] Queue initialized, waiting for manual start');

    this.logger.info('[TakeProfitQueue] Initialized', {
      sessionId,
      queueKey: this.queueKey,
      processingInterval: this.processingIntervalMs
    });
  }

  /**
   * Redis client wrapper methods to handle different client interfaces
   */
  async _redisCommand(command, ...args) {
    try {
      const lowerCommand = command.toLowerCase();
      
      // Check if we have a standard Redis client with direct methods
      if (this.redisClient && typeof this.redisClient[lowerCommand] === 'function') {
        return await this.redisClient[lowerCommand](...args);
      }
      
      // Check if we have a client with _command method (ioredis style)
      if (this.redisClient && this.redisClient.client && typeof this.redisClient.client._command === 'function') {
        return await this.redisClient.client._command(command.toUpperCase(), ...args);
      }
      
      // Check if we have our custom RedisClient that uses HTTP API
      if (this.redisClient && typeof this.redisClient._fetch === 'function') {
        // For our custom RedisClient, we need to use the HTTP API with proper headers
        const result = await this.redisClient._fetch(this.redisClient.url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.redisClient.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([command.toUpperCase(), ...args]),
        });
        const data = await result.json();
        
        if (data.error) {
          throw new Error(`Redis error: ${data.error}`);
        }
        
        return data.result;
      }
      
      throw new Error(`Unsupported Redis client interface for command: ${command}`);
    } catch (error) {
      this.logger.error(`[TakeProfitQueue] Redis command error: ${command}`, { 
        error: error.message,
        args: args.slice(0, 2), // Log first 2 args only for brevity
        clientType: this.redisClient?.constructor?.name || 'unknown',
        availableMethods: this.redisClient ? Object.getOwnPropertyNames(this.redisClient).filter(name => typeof this.redisClient[name] === 'function').slice(0, 10) : []
      });
      throw error;
    }
  }

  /**
   * Adds a buy order to the take-profit queue
   * @param {Object} buyOrder - The filled buy order
   * @param {Object} fillData - The fill data
   */
  async addOrder(buyOrder, fillData) {
    try {
      // Check if already in queue to prevent duplicates
      const queueItems = await this._redisCommand('LRANGE', this.queueKey, 0, -1);
      const alreadyExists = queueItems.some(itemStr => {
        const item = JSON.parse(itemStr);
        return item.buyOrderId === buyOrder.id;
      });

      if (alreadyExists) {
        this.logger.debug('[TakeProfitQueue] Order already in queue', { buyOrderId: buyOrder.id });
        return;
      }

      // Create queue item
      const queueItem = {
        buyOrderId: buyOrder.id,
        buyOrder: buyOrder,
        fillData: fillData,
        addedAt: Date.now(),
        attempts: 0,
        lastAttempt: null
      };

      // Add to queue (FIFO)
      await this._redisCommand('RPUSH', this.queueKey, JSON.stringify(queueItem));
      
      // Set expiration (24 hours)
      await this._redisCommand('EXPIRE', this.queueKey, 24 * 60 * 60);

      const queueLength = await this._redisCommand('LLEN', this.queueKey);
      
      this.logger.info('[TakeProfitQueue] Added order to queue', {
        buyOrderId: buyOrder.id,
        queueLength,
        price: buyOrder.price,
        amount: buyOrder.amount
      });

    } catch (error) {
      this.logger.error('[TakeProfitQueue] Error adding order to queue', {
        buyOrderId: buyOrder.id,
        error: error.message
      });
    }
  }

  /**
   * Removes and returns the next order from the queue
   */
  async getNextOrder() {
    try {
      const itemStr = await this._redisCommand('LPOP', this.queueKey);
      if (!itemStr) {
        return null;
      }

      return JSON.parse(itemStr);
    } catch (error) {
      this.logger.error('[TakeProfitQueue] Error getting next order', { error: error.message });
      return null;
    }
  }

  /**
   * Puts an order back at the front of the queue (for retries)
   */
  async requeueOrder(queueItem) {
    try {
      queueItem.attempts++;
      queueItem.lastAttempt = Date.now();
      
      await this._redisCommand('LPUSH', this.queueKey, JSON.stringify(queueItem));
      
      this.logger.debug('[TakeProfitQueue] Requeued order for retry', {
        buyOrderId: queueItem.buyOrderId,
        attempts: queueItem.attempts
      });
    } catch (error) {
      this.logger.error('[TakeProfitQueue] Error requeuing order', {
        buyOrderId: queueItem.buyOrderId,
        error: error.message
      });
    }
  }

  /**
   * Starts the queue processing loop
   */
  startProcessing() {
    if (this.processingInterval) {
      return;
    }

    this.processingInterval = setInterval(() => {
      this.processQueue().catch(error => {
        this.logger.error('[TakeProfitQueue] Error in processing loop', { error: error.message });
      });
    }, this.processingIntervalMs);

    this.logger.info('[TakeProfitQueue] Started queue processing');
  }

  /**
   * Stops the queue processing loop
   */
  stopProcessing() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      this.logger.info('[TakeProfitQueue] Stopped queue processing');
    }
  }

  /**
   * Main queue processing logic
   */
  async processQueue() {
    if (this.processing) {
      return; // Already processing
    }

    this.processing = true;

    try {
      const queueItem = await this.getNextOrder();
      if (!queueItem) {
        return; // Queue is empty
      }

      this.logger.info('[TakeProfitQueue] Processing order', {
        buyOrderId: queueItem.buyOrderId,
        attempts: queueItem.attempts
      });

      // Check if we should retry this order
      if (queueItem.attempts >= this.maxRetries) {
        this.logger.error('[TakeProfitQueue] Max retries exceeded, dropping order', {
          buyOrderId: queueItem.buyOrderId,
          attempts: queueItem.attempts
        });
        return; // Don't requeue, just drop it
      }

      // Check if enough time has passed for retry (if this is a retry)
      if (queueItem.attempts > 0 && queueItem.lastAttempt) {
        const timeSinceLastAttempt = Date.now() - queueItem.lastAttempt;
        const minRetryDelay = 30000; // 30 seconds
        
        if (timeSinceLastAttempt < minRetryDelay) {
          // Too soon to retry, put it back
          await this.requeueOrder(queueItem);
          return;
        }
      }

      // Try to create the take-profit order
      const success = await this.createTakeProfitOrder(queueItem);
      
      if (!success) {
        // Failed, requeue for retry
        await this.requeueOrder(queueItem);
      }
      // If successful, order is not requeued (completed)

    } catch (error) {
      this.logger.error('[TakeProfitQueue] Error processing queue', { error: error.message });
    } finally {
      this.processing = false;
    }
  }

  /**
   * Creates a take-profit order using the existing market maker logic
   */
  async createTakeProfitOrder(queueItem) {
    const { buyOrder, fillData } = queueItem;
    
    try {
      this.logger.info('[TakeProfitQueue] Creating take-profit order', {
        buyOrderId: buyOrder.id,
        price: buyOrder.price,
        amount: buyOrder.amount
      });

      // Call the market maker's take-profit logic
      if (this.marketMaker && typeof this.marketMaker._handlePotentialTakeProfitOpportunity === 'function') {
        await this.marketMaker._handlePotentialTakeProfitOpportunity(buyOrder, fillData);
        
        this.logger.info('[TakeProfitQueue] Successfully created take-profit', {
          buyOrderId: buyOrder.id
        });
        
        return true; // Success
      } else {
        throw new Error('Market maker not available or missing take-profit method');
      }
      
    } catch (error) {
      this.logger.error('[TakeProfitQueue] Failed to create take-profit', {
        buyOrderId: buyOrder.id,
        error: error.message
      });
      
      return false; // Failed, will be retried
    }
  }

  /**
   * Clears the queue
   */
  async clear() {
    try {
      await this._redisCommand('DEL', this.queueKey);
      this.logger.info('[TakeProfitQueue] Queue cleared');
    } catch (error) {
      this.logger.error('[TakeProfitQueue] Error clearing queue', { error: error.message });
    }
  }
} 