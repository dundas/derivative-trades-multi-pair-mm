/**
 * DynamicPositionManager
 * 
 * Manages positions across multiple trading pairs with portfolio-level risk management
 */

export class DynamicPositionManager {
  constructor(options = {}) {
    this.totalBudget = options.totalBudget || 0;
    this.pairs = options.pairs || [];
    this.logger = options.logger;
    
    // Risk limits
    this.riskLimits = {
      maxPortfolioExposure: 0.80,
      maxPairExposure: 0.20,
      maxCorrelatedExposure: 0.40,
      maxConcurrentPositions: 10,
      minPositionSizeUSD: 50,
      ...options.riskLimits
    };
    
    // Position tracking
    this.positions = new Map(); // positionId -> position data
    this.pairPositions = new Map(); // pair -> Set of positionIds
    this.exposures = new Map(); // pair -> total exposure
    
    // Performance tracking
    this.pairPerformance = new Map(); // pair -> performance metrics
    
    // Balances
    this.balances = {};
    
    // Correlations
    this.correlations = {};
  }
  
  /**
   * Check if we can take a new position
   * @param {String} pair - Trading pair
   * @param {Number} size - Position size in base currency
   * @param {Number} price - Entry price
   * @returns {Boolean}
   */
  canTakePosition(pair, size, price = null) {
    // Check concurrent positions limit
    if (this.positions.size >= this.riskLimits.maxConcurrentPositions) {
      this.logger?.debug('Max concurrent positions reached', {
        current: this.positions.size,
        max: this.riskLimits.maxConcurrentPositions
      });
      return false;
    }
    
    // Calculate position value
    const positionValue = size * (price || 1);
    
    // Check minimum position size
    if (positionValue < this.riskLimits.minPositionSizeUSD) {
      this.logger?.debug('Position too small', {
        value: positionValue,
        minimum: this.riskLimits.minPositionSizeUSD
      });
      return false;
    }
    
    // Check portfolio exposure
    const currentExposure = this.calculateTotalExposure();
    const newTotalExposure = currentExposure + positionValue;
    const maxPortfolioExposure = this.totalBudget * this.riskLimits.maxPortfolioExposure;
    
    if (newTotalExposure > maxPortfolioExposure) {
      this.logger?.debug('Portfolio exposure limit exceeded', {
        current: currentExposure,
        new: newTotalExposure,
        max: maxPortfolioExposure
      });
      return false;
    }
    
    // Check pair exposure
    const currentPairExposure = this.exposures.get(pair) || 0;
    const newPairExposure = currentPairExposure + positionValue;
    const maxPairExposure = this.totalBudget * this.riskLimits.maxPairExposure;
    
    if (newPairExposure > maxPairExposure) {
      this.logger?.debug('Pair exposure limit exceeded', {
        pair,
        current: currentPairExposure,
        new: newPairExposure,
        max: maxPairExposure
      });
      return false;
    }
    
    return true;
  }
  
  /**
   * Add a new position
   * @param {Object} position - Position data
   * @returns {String} Position ID
   */
  async addPosition(position) {
    const positionId = `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const positionData = {
      id: positionId,
      pair: position.pair,
      side: position.side,
      size: position.size,
      entryPrice: position.entryPrice,
      entryTime: Date.now(),
      orderId: position.orderId,
      status: 'open',
      unrealizedPnL: 0,
      realizedPnL: 0
    };
    
    // Store position
    this.positions.set(positionId, positionData);
    
    // Update pair positions
    if (!this.pairPositions.has(position.pair)) {
      this.pairPositions.set(position.pair, new Set());
    }
    this.pairPositions.get(position.pair).add(positionId);
    
    // Update exposure
    const exposure = position.size * position.entryPrice;
    this.exposures.set(position.pair, (this.exposures.get(position.pair) || 0) + exposure);
    
    this.logger?.info('Position added', {
      positionId,
      pair: position.pair,
      side: position.side,
      size: position.size,
      entryPrice: position.entryPrice
    });
    
    return positionId;
  }
  
  /**
   * Update balances
   * @param {Object} balances - Balance data from exchange
   */
  async updateBalances(balances) {
    this.balances = balances;
  }
  
  /**
   * Update positions from exchange
   * @param {Object} positions - Position data from exchange
   */
  async updatePositions(positions) {
    // Reconcile with internal position tracking
    // This would sync exchange positions with our internal state
  }
  
  /**
   * Get portfolio state
   * @returns {Object} Portfolio state
   */
  async getPortfolioState() {
    const totalExposure = this.calculateTotalExposure();
    const availableBalance = this._calculateAvailableBalance();
    
    return {
      totalBudget: this.totalBudget,
      totalExposure,
      availableBalance,
      exposurePercentage: (totalExposure / this.totalBudget) * 100,
      positions: Object.fromEntries(this.positions),
      exposures: Object.fromEntries(this.exposures),
      pairPerformance: Object.fromEntries(this.pairPerformance),
      positionCount: this.positions.size
    };
  }
  
  /**
   * Get active positions
   * @returns {Array} Active positions
   */
  async getActivePositions() {
    return Array.from(this.positions.values()).filter(pos => pos.status === 'open');
  }
  
  /**
   * Calculate total portfolio exposure
   * @returns {Number} Total exposure in USD
   */
  calculateTotalExposure() {
    let total = 0;
    for (const exposure of this.exposures.values()) {
      total += exposure;
    }
    return total;
  }
  
  /**
   * Calculate P&L for a position
   * @param {Object} position - Position data
   * @param {Number} currentPrice - Current market price
   * @returns {Object} P&L data
   */
  calculatePnL(position, currentPrice) {
    const direction = position.side === 'BUY' ? 1 : -1;
    const priceDiff = (currentPrice - position.entryPrice) * direction;
    const unrealizedPnL = priceDiff * position.size;
    const percentage = (priceDiff / position.entryPrice) * 100;
    
    return {
      unrealizedPnL,
      percentage,
      currentPrice
    };
  }
  
  /**
   * Get performance metrics for a pair
   * @param {String} pair - Trading pair
   * @returns {Object} Performance metrics
   */
  async getPairPerformance(pair) {
    return this.pairPerformance.get(pair) || {
      totalTrades: 0,
      winRate: 0,
      avgProfit: 0,
      totalVolume: 0
    };
  }
  
  /**
   * Update correlation data
   * @param {Object} correlations - Correlation matrix
   */
  async updateCorrelations(correlations) {
    this.correlations = correlations;
  }
  
  /**
   * Calculate available balance
   * @private
   */
  _calculateAvailableBalance() {
    // This would check actual exchange balances
    // For now, use budget minus exposure
    return Math.max(0, this.totalBudget - this.calculateTotalExposure());
  }
}

export default DynamicPositionManager;