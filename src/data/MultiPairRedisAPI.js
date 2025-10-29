/**
 * MultiPairRedisAPI
 * 
 * Redis operations for multi-pair trading sessions
 */

export class MultiPairRedisAPI {
  constructor(options = {}) {
    this.redis = options.redis;
    this.sessionId = options.sessionId;
    this.exchange = options.exchange || 'kraken';
    this.logger = options.logger;
    
    // Key prefixes
    this.keyPrefix = `opportunistic:${this.exchange}:multi:${this.sessionId}`;
  }
  
  /**
   * Add a trading pair to the session
   * @param {String} pair - Trading pair
   */
  async addPair(pair) {
    const key = `${this.keyPrefix}:active_pairs`;
    await this.redis.sadd(key, pair);
    
    this.logger?.debug('Added pair to session', { pair, sessionId: this.sessionId });
  }
  
  /**
   * Get all active pairs
   * @returns {Array<String>} Active trading pairs
   */
  async getActivePairs() {
    const key = `${this.keyPrefix}:active_pairs`;
    const pairs = await this.redis.smembers(key);
    return pairs || [];
  }
  
  /**
   * Update session data
   * @param {Object} data - Session data to update
   */
  async updateSession(data) {
    const key = `${this.keyPrefix}:session`;
    const existing = await this.redis.get(key);
    
    const sessionData = existing ? JSON.parse(existing) : {};
    const updated = {
      ...sessionData,
      ...data,
      lastUpdated: Date.now()
    };
    
    await this.redis.set(key, JSON.stringify(updated));
    
    this.logger?.debug('Session updated', { sessionId: this.sessionId });
  }
  
  /**
   * Store opportunity data
   * @param {Object} opportunity - Opportunity data
   * @param {Object} order - Executed order data
   */
  async storeOpportunity(opportunity, order) {
    const key = `${this.keyPrefix}:opportunities:history`;
    
    const opportunityData = {
      ...opportunity,
      executedAt: Date.now(),
      orderId: order.id,
      orderPrice: order.price,
      orderSize: order.amount
    };
    
    // Store in sorted set with timestamp as score
    await this.redis.zadd(key, Date.now(), JSON.stringify(opportunityData));
    
    // Keep only last 1000 opportunities
    await this.redis.zremrangebyrank(key, 0, -1001);
  }
  
  /**
   * Get orders for a specific pair
   * @param {String} pair - Trading pair
   * @returns {Array} Orders for the pair
   */
  async getOrdersForPair(pair) {
    const key = `${this.keyPrefix}:pairs:${pair}:orders`;
    const ordersJson = await this.redis.get(key);
    return ordersJson ? JSON.parse(ordersJson) : [];
  }
  
  /**
   * Update performance metrics
   * @param {Object} metrics - Performance metrics
   */
  async updatePerformanceMetrics(metrics) {
    const key = `${this.keyPrefix}:performance`;
    await this.redis.set(key, JSON.stringify({
      ...metrics,
      timestamp: Date.now()
    }));
    
    // Also update historical performance
    const historyKey = `${this.keyPrefix}:performance:history`;
    await this.redis.zadd(historyKey, Date.now(), JSON.stringify(metrics));
    
    // Keep only last 24 hours
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    await this.redis.zremrangebyscore(historyKey, '-inf', dayAgo);
  }
  
  /**
   * Get all orders across all pairs
   * @returns {Array} All orders
   */
  async getAllOrdersMultiPair() {
    const pairs = await this.getActivePairs();
    const allOrders = [];
    
    for (const pair of pairs) {
      const orders = await this.getOrdersForPair(pair);
      allOrders.push(...orders);
    }
    
    return allOrders;
  }
  
  /**
   * Update market data cache
   * @param {String} pair - Trading pair
   * @param {Object} data - Market data
   */
  async updateMarketData(pair, data) {
    const key = `market_data:${this.exchange}:${pair}:latest`;
    await this.redis.hset(key, {
      ...data,
      timestamp: Date.now()
    });
    
    // Set TTL
    await this.redis.expire(key, 60); // 1 minute TTL
  }
}

export default MultiPairRedisAPI;