/**
 * RESTClientManager - Singleton manager for reusing REST API clients
 * 
 * Prevents rate limiting issues by ensuring only one REST client instance
 * is created per exchange and reused across all services.
 */

export class RESTClientManager {
  static instance = null;
  
  constructor() {
    if (RESTClientManager.instance) {
      return RESTClientManager.instance;
    }
    
    this.clients = new Map(); // Map of exchange -> client instance
    this.initializationPromises = new Map(); // Track ongoing initializations
    this.logger = null;
    
    RESTClientManager.instance = this;
  }
  
  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!RESTClientManager.instance) {
      RESTClientManager.instance = new RESTClientManager();
    }
    return RESTClientManager.instance;
  }
  
  /**
   * Set logger for the manager
   */
  setLogger(logger) {
    this.logger = logger;
  }
  
  /**
   * Get or create a REST client for Kraken
   * @param {Object} options - Client configuration options
   * @param {Object} options.logger - Logger instance
   * @param {boolean} options.forceNew - Force creation of new client (default: false)
   * @returns {Promise<Object>} - KrakenRESTClient instance
   */
  async getKrakenClient(options = {}) {
    const clientKey = 'kraken';
    const forceNew = options.forceNew || false;
    
    // Return existing client unless forced to create new one
    if (this.clients.has(clientKey) && !forceNew) {
      const logger = options.logger || this.logger;
      if (logger) {
        logger.debug('[RESTClientManager] Reusing existing Kraken REST client');
      }
      return this.clients.get(clientKey);
    }
    
    // Check if initialization is already in progress
    if (this.initializationPromises.has(clientKey) && !forceNew) {
      const logger = options.logger || this.logger;
      if (logger) {
        logger.debug('[RESTClientManager] Waiting for ongoing Kraken client initialization');
      }
      return await this.initializationPromises.get(clientKey);
    }
    
    // Create new client
    const initPromise = this._createKrakenClient(options);
    this.initializationPromises.set(clientKey, initPromise);
    
    try {
      const client = await initPromise;
      this.clients.set(clientKey, client);
      this.initializationPromises.delete(clientKey);
      
      const logger = options.logger || this.logger;
      if (logger) {
        logger.info('[RESTClientManager] ✅ New Kraken REST client created and cached');
      }
      
      return client;
    } catch (error) {
      this.initializationPromises.delete(clientKey);
      throw error;
    }
  }
  
  /**
   * Create a new Kraken REST client
   * @private
   */
  async _createKrakenClient(options = {}) {
    const logger = options.logger || this.logger;
    
    try {
      if (logger) {
        logger.info('[RESTClientManager] Creating new Kraken REST client...');
      }
      
      const { KrakenRESTClient } = await import('../../../lib/exchanges/KrakenRESTClient.js');
      
      const client = new KrakenRESTClient({
        apiKey: process.env.KRAKEN_API_KEY,
        apiSecret: process.env.KRAKEN_API_SECRET || process.env.KRAKEN_PRIVATE_KEY,
        otp: process.env.KRAKEN_OTP,
        logger: logger && typeof logger.createChild === 'function' ? 
                logger.createChild('KrakenRESTClient-Shared') : 
                (logger || console)
      });
      
      // Test the connection to ensure it's working
      if (process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET) {
        try {
          await client.getAccountBalance();
          if (logger) {
            logger.info('[RESTClientManager] ✅ Kraken REST client connectivity verified');
          }
        } catch (testError) {
          if (logger) {
            logger.warn('[RESTClientManager] ⚠️ Kraken REST client created but connectivity test failed:', testError.message);
          }
          // Don't throw here - client might still be usable for other operations
        }
      }
      
      return client;
      
    } catch (error) {
      if (logger) {
        logger.error('[RESTClientManager] ❌ Failed to create Kraken REST client:', error);
      }
      throw new Error(`Failed to create Kraken REST client: ${error.message}`);
    }
  }
  
  /**
   * Check if a client exists for the given exchange
   */
  hasClient(exchange = 'kraken') {
    return this.clients.has(exchange);
  }
  
  /**
   * Get cached client without creating new one
   */
  getCachedClient(exchange = 'kraken') {
    return this.clients.get(exchange) || null;
  }
  
  /**
   * Clear a specific client (useful for error recovery)
   */
  clearClient(exchange = 'kraken') {
    const logger = this.logger;
    if (this.clients.has(exchange)) {
      this.clients.delete(exchange);
      if (logger) {
        logger.info(`[RESTClientManager] Cleared cached ${exchange} client`);
      }
    }
    
    if (this.initializationPromises.has(exchange)) {
      this.initializationPromises.delete(exchange);
      if (logger) {
        logger.info(`[RESTClientManager] Cleared pending ${exchange} initialization`);
      }
    }
  }
  
  /**
   * Clear all cached clients
   */
  clearAllClients() {
    const logger = this.logger;
    if (logger) {
      logger.info(`[RESTClientManager] Clearing all cached clients (${this.clients.size} clients)`);
    }
    
    this.clients.clear();
    this.initializationPromises.clear();
  }
  
  /**
   * Get stats about cached clients
   */
  getStats() {
    return {
      cachedClients: this.clients.size,
      pendingInitializations: this.initializationPromises.size,
      exchanges: Array.from(this.clients.keys())
    };
  }
}

// Export singleton instance for convenience
export const restClientManager = RESTClientManager.getInstance(); 