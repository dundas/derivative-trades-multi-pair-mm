/**
 * PacingEngine
 * 
 * Simple timing control that paces buy orders based on:
 * available budget / seconds remaining = spending rate
 * 
 * The first order is allowed immediately to ensure sessions start promptly,
 * then subsequent orders are paced according to the calculated spending rate.
 * 
 * Only active when pacing is enabled on the session.
 * 
 * @see Documentation:
 * - Full Guide: /docs/features/ORDER_PACING.md
 * - Quick Start: /docs/PACING_QUICK_START.md
 * 
 * @example
 * // Initialize with session parameters
 * const pacingEngine = new PacingEngine({
 *   logger: logger,
 *   enabled: true,
 *   sessionLength: 3600000, // 1 hour
 *   sessionStartTime: Date.now(),
 *   budgetPercentagePerOrder: 0.02, // 2% (uses perTradeRiskPercent from risk parameters)
 *   buyOrderTTL: 16000 // 16 seconds
 * });
 * 
 * // Check if order should be allowed
 * const decision = pacingEngine.shouldAllowBuyOrder(
 *   availableBudget,
 *   currentPrice,
 *   totalBudget
 * );
 * 
 * if (decision.allowed) {
 *   // Place order...
 *   pacingEngine.recordBuyOrder();
 * }
 */

class PacingEngine {
  /**
   * Create a new PacingEngine
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {boolean} options.enabled - Whether pacing is enabled
   * @param {number} options.sessionLength - Session length in milliseconds
   * @param {number} options.sessionStartTime - Session start timestamp
   * @param {number} options.budgetPercentagePerOrder - Percentage of budget per order (typically perTradeRiskPercent from risk parameters)
   * @param {number} options.buyOrderTTL - Buy order time-to-live in milliseconds
   * @param {Function} options.getAvailableBudget - Callback to get real-time available budget
   */
  constructor(options = {}) {
    this.logger = options.logger;
    this.enabled = options.enabled || false;
    
    if (!this.enabled) {
      this.logger.info('[PacingEngine] Pacing is disabled');
      return;
    }
    
    // Timing configuration
    this.sessionStartTime = options.sessionStartTime || Date.now();
    this.lastBuyAllowedTime = this.sessionStartTime + options.sessionLength - (options.buyOrderTTL || 16000);
    this.budgetPercentagePerOrder = options.budgetPercentagePerOrder || 0.1;
    
    // Dynamic budget callback - if not provided, returns null (will use static budget)
    this.getAvailableBudget = options.getAvailableBudget || null;
    
    // State tracking - Initialize to 0 to allow first order immediately
    this.lastBuyOrderTime = 0;
    this.orderCount = 0;
    
    this.logger.info('[PacingEngine] Initialized:', {
      enabled: this.enabled,
      sessionLength: options.sessionLength / 1000 + 's',
      lastBuyAllowedTime: new Date(this.lastBuyAllowedTime).toISOString(),
      dynamicBudget: !!this.getAvailableBudget
    });
  }
  
  /**
   * Check if a buy order should be allowed based on pacing
   * @param {number} availableBudget - Currently available budget
   * @param {number} currentPrice - Current market price  
   * @param {number} sessionBudget - Total session budget
   * @returns {Object} - { allowed: boolean, reason: string, details: Object }
   */
  shouldAllowBuyOrder(availableBudget, currentPrice, sessionBudget) {
    if (!this.enabled) {
      return { allowed: true, reason: 'PACING_DISABLED' };
    }
    
    // If dynamic budget callback is available, use it to get real-time budget
    const effectiveBudget = this.getAvailableBudget ? this.getAvailableBudget() : availableBudget;
    
    // Input validation
    if (effectiveBudget <= 0) {
      return { allowed: false, reason: 'NO_BUDGET_AVAILABLE' };
    }
    
    if (currentPrice <= 0) {
      return { allowed: false, reason: 'INVALID_PRICE' };
    }
    
    const now = Date.now();
    
    // Check if we're past the buy window
    if (now > this.lastBuyAllowedTime) {
      return {
        allowed: false,
        reason: 'BUY_WINDOW_EXPIRED',
        details: {
          lastBuyTime: new Date(this.lastBuyAllowedTime).toISOString()
        }
      };
    }
    
    // Calculate pacing
    const secondsRemaining = (this.lastBuyAllowedTime - now) / 1000;
    
    // Handle near-zero time remaining
    if (secondsRemaining <= 1) {
      return { 
        allowed: true, 
        reason: 'FINAL_SECONDS_OVERRIDE',
        details: { warning: 'Less than 1 second remaining' }
      };
    }
    
    // Dynamic order value calculation based on current available budget
    const averageOrderValue = effectiveBudget * this.budgetPercentagePerOrder; // Order value in USD
    const requiredSpendingRate = secondsRemaining > 0 ? effectiveBudget / secondsRemaining : Infinity;
    const secondsBetweenOrders = requiredSpendingRate > 0 ? averageOrderValue / requiredSpendingRate : Infinity;
    let millisecondsBetweenOrders = secondsBetweenOrders * 1000;
    
    // Debug logging for pacing calculations
    this.logger.debug('[PacingEngine] Pacing calculation:', {
      sessionBudget,
      availableBudget,
      effectiveBudget,
      dynamicBudget: !!this.getAvailableBudget,
      budgetPercentagePerOrder: this.budgetPercentagePerOrder,
      averageOrderValue,
      secondsRemaining,
      requiredSpendingRate,
      secondsBetweenOrders,
      millisecondsBetweenOrders
    });
    
    // Prevent extremely high frequency trading
    if (millisecondsBetweenOrders < 100) {
      millisecondsBetweenOrders = 100; // At least 100ms between orders
    }
    
    // Allow first order immediately, then enforce pacing
    if (this.orderCount === 0) {
      this.logger.info('[PacingEngine] First order - allowing immediately to start session');
      return {
        allowed: true,
        reason: 'FIRST_ORDER_BYPASS',
        details: {
          message: 'First order allowed without pacing',
          nextInterval: Math.round(millisecondsBetweenOrders / 1000) + 's'
        }
      };
    }
    
    // Check if enough time has passed for subsequent orders
    if (this.lastBuyOrderTime > 0) {
      const timeSinceLastBuy = now - this.lastBuyOrderTime;
      if (timeSinceLastBuy < millisecondsBetweenOrders) {
        return {
          allowed: false,
          reason: 'PACING_COOLDOWN',
          details: {
            timeUntilNext: Math.round((millisecondsBetweenOrders - timeSinceLastBuy) / 1000) + 's',
            pacingInterval: Math.round(millisecondsBetweenOrders / 1000) + 's'
          }
        };
      }
    }
    
    return {
      allowed: true,
      reason: 'PACING_APPROVED',
      details: {
        pacingInterval: Math.round(millisecondsBetweenOrders / 1000) + 's',
        spendingRate: '$' + requiredSpendingRate.toFixed(2) + '/s',
        effectiveBudget: effectiveBudget.toFixed(2),
        dynamicPacing: !!this.getAvailableBudget
      }
    };
  }
  
  /**
   * Record that a buy order was placed
   */
  recordBuyOrder() {
    if (!this.enabled) return;
    this.lastBuyOrderTime = Date.now();
    this.orderCount++;
    
    this.logger.debug('[PacingEngine] Buy order recorded:', {
      orderCount: this.orderCount,
      lastBuyOrderTime: new Date(this.lastBuyOrderTime).toISOString()
    });
  }
}

export default PacingEngine;