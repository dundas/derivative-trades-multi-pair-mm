/**
 * MultiPairOpportunisticTrader
 * 
 * A market maker that monitors multiple trading pairs simultaneously and executes
 * on the best opportunities across all pairs. Uses futures market data as a leading
 * indicator with 2-8 second advantage over spot markets.
 * 
 * Key Features:
 * - Parallel monitoring of multiple trading pairs
 * - Opportunity ranking based on futures lead signals
 * - Portfolio-level risk management
 * - Fast execution within optimal time windows
 * - Cross-pair correlation tracking
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { LoggerFactory } from '../../utils/logger-factory.js';
import { SessionManager as RedisSessionManager } from '../../lib/redis-backend-api/index.js';
import { MultiPairDataCollector } from '../data/MultiPairDataCollector.js';
import { OpportunityRankingEngine } from '../ranking/OpportunityRankingEngine.js';
import { DynamicPositionManager } from '../position/DynamicPositionManager.js';
import { FastExecutionEngine } from '../execution/FastExecutionEngine.js';
import { MultiPairRedisAPI } from '../data/MultiPairRedisAPI.js';
import { PerformanceTracker } from '../../utils/performance-tracker.js';
import { ComprehensiveBalanceValidator } from '../../utils/comprehensive-balance-validator.js';

// Configuration constants
const CONFIG = {
  INTERVALS: {
    MAIN_LOOP: 2000,           // 2 second main loop to catch futures leads
    OPPORTUNITY_SCAN: 500,     // 500ms opportunity detection
    PERFORMANCE_UPDATE: 30000, // 30 second performance updates
    CORRELATION_UPDATE: 60000  // 1 minute correlation updates
  },
  THRESHOLDS: {
    MIN_OPPORTUNITY_SCORE: 65,     // Minimum score to consider opportunity
    MIN_FUTURES_MOVEMENT: 0.05,    // 0.05% minimum movement to trigger
    MAX_EXECUTION_DELAY: 3000,     // 3 seconds max from detection
    MIN_SPREAD_FOR_PROFIT: 0.10    // 0.10% minimum spread after fees
  },
  RISK_LIMITS: {
    MAX_PORTFOLIO_EXPOSURE: 0.80,   // 80% of total budget
    MAX_PAIR_EXPOSURE: 0.20,        // 20% per trading pair
    MAX_CORRELATED_EXPOSURE: 0.40,  // 40% in highly correlated assets
    MAX_CONCURRENT_POSITIONS: 10,   // Maximum open positions
    MIN_POSITION_SIZE_USD: 50       // Minimum position size
  }
};

export class MultiPairOpportunisticTrader extends EventEmitter {
  /**
   * Creates a new MultiPairOpportunisticTrader instance
   * 
   * @param {Object} options - Configuration options
   * @param {Array<String>} options.pairs - Trading pairs to monitor (e.g., ['BTC/USD', 'ETH/USD'])
   * @param {Number} options.budget - Total trading budget
   * @param {String} options.exchange - Exchange name (default: 'kraken')
   * @param {Object} options.exchangeAdapter - Exchange adapter instance
   * @param {String} options.sessionId - Session ID (generated if not provided)
   * @param {Boolean} options.enableFuturesLeadDetection - Enable futures lead detection
   * @param {Number} options.mainLoopInterval - Main loop interval in ms (default: 2000)
   * @param {Object} options.rankingWeights - Custom weights for opportunity ranking
   * @param {Object} options.logger - Logger instance
   */
  constructor(options = {}) {
    super();
    
    // Validate required options
    if (!options.pairs || !Array.isArray(options.pairs) || options.pairs.length === 0) {
      throw new Error('pairs array is required with at least one trading pair');
    }
    
    if (!options.budget || options.budget <= 0) {
      throw new Error('budget must be provided and greater than 0');
    }
    
    if (!options.exchangeAdapter) {
      throw new Error('exchangeAdapter is required');
    }
    
    // Initialize basic properties
    this.pairs = options.pairs;
    this.budget = options.budget;
    this.exchange = options.exchange || 'kraken';
    this.exchangeAdapter = options.exchangeAdapter;
    this.sessionId = options.sessionId || uuidv4();
    this.enableFuturesLeadDetection = options.enableFuturesLeadDetection !== false;
    this.mainLoopInterval = options.mainLoopInterval || CONFIG.INTERVALS.MAIN_LOOP;
    
    // Initialize logger
    this.logger = options.logger || LoggerFactory.createLogger({ component: 'MultiPairOpportunisticTrader' });
    
    // Initialize components
    this._initializeComponents(options);
    
    // State management
    this.isRunning = false;
    this.sessionStartTime = null;
    this.opportunitiesDetected = 0;
    this.tradesExecuted = 0;
    this.activeOpportunities = new Map();
    
    // Intervals
    this.mainLoopTimer = null;
    this.performanceTimer = null;
    this.correlationTimer = null;
    
    this.logger.info('MultiPairOpportunisticTrader initialized', {
      pairs: this.pairs,
      budget: this.budget,
      exchange: this.exchange,
      sessionId: this.sessionId,
      futuresLeadDetection: this.enableFuturesLeadDetection
    });
  }
  
  /**
   * Initialize all sub-components
   * @private
   */
  _initializeComponents(options) {
    // Data collection
    this.dataCollector = new MultiPairDataCollector({
      pairs: this.pairs,
      exchange: this.exchange,
      exchangeAdapter: this.exchangeAdapter,
      enableFutures: this.enableFuturesLeadDetection,
      logger: this.logger.createChild('DataCollector')
    });
    
    // Opportunity ranking
    this.rankingEngine = new OpportunityRankingEngine({
      weights: options.rankingWeights || {
        signalStrength: 0.30,
        timing: 0.25,
        spread: 0.15,
        liquidity: 0.10,
        correlation: 0.10,
        historical: 0.10
      },
      logger: this.logger.createChild('RankingEngine')
    });
    
    // Position management
    this.positionManager = new DynamicPositionManager({
      totalBudget: this.budget,
      pairs: this.pairs,
      riskLimits: {
        ...CONFIG.RISK_LIMITS,
        ...options.riskLimits
      },
      logger: this.logger.createChild('PositionManager')
    });
    
    // Execution engine
    this.executionEngine = new FastExecutionEngine({
      exchangeAdapter: this.exchangeAdapter,
      maxExecutionDelay: CONFIG.THRESHOLDS.MAX_EXECUTION_DELAY,
      logger: this.logger.createChild('ExecutionEngine')
    });
    
    // Redis API for multi-pair data
    this.redisAPI = new MultiPairRedisAPI({
      redis: this.exchangeAdapter.redisAdapter || this.exchangeAdapter.redis,
      sessionId: this.sessionId,
      exchange: this.exchange,
      logger: this.logger.createChild('RedisAPI')
    });
    
    // Balance validator
    this.balanceValidator = new ComprehensiveBalanceValidator(this.exchangeAdapter, {
      logger: this.logger.createChild('BalanceValidator'),
      cacheTTL: 30000,
      fallbackToAPI: true
    });
    
    // Performance tracker
    this.performanceTracker = new PerformanceTracker({
      logger: this.logger.createChild('PerformanceTracker')
    });
  }
  
  /**
   * Start the multi-pair trader
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('MultiPairOpportunisticTrader already running');
      return;
    }
    
    this.logger.info('Starting MultiPairOpportunisticTrader...');
    
    try {
      // Connect to exchange
      await this.exchangeAdapter.connect();
      this.logger.info('Connected to exchange');
      
      // Initialize session
      await this._initializeSession();
      
      // Start data collection
      await this.dataCollector.start();
      this.logger.info('Data collection started for all pairs');
      
      // Initialize positions and balances
      await this._initializePortfolio();
      
      // Add active pairs to Redis
      for (const pair of this.pairs) {
        await this.redisAPI.addPair(pair);
      }
      
      // Start main trading loop
      this.isRunning = true;
      this.sessionStartTime = Date.now();
      this._startMainLoop();
      
      // Start performance monitoring
      this._startPerformanceMonitoring();
      
      // Start correlation tracking
      if (this.pairs.length > 1) {
        this._startCorrelationTracking();
      }
      
      this.logger.info('MultiPairOpportunisticTrader started successfully', {
        pairs: this.pairs,
        sessionId: this.sessionId
      });
      
      this.emit('started', {
        sessionId: this.sessionId,
        pairs: this.pairs,
        timestamp: Date.now()
      });
      
    } catch (error) {
      this.logger.error('Failed to start MultiPairOpportunisticTrader', error);
      await this._cleanup();
      throw error;
    }
  }
  
  /**
   * Stop the multi-pair trader
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      this.logger.warn('MultiPairOpportunisticTrader not running');
      return;
    }
    
    this.logger.info('Stopping MultiPairOpportunisticTrader...');
    
    // Stop all timers
    if (this.mainLoopTimer) {
      clearInterval(this.mainLoopTimer);
      this.mainLoopTimer = null;
    }
    
    if (this.performanceTimer) {
      clearInterval(this.performanceTimer);
      this.performanceTimer = null;
    }
    
    if (this.correlationTimer) {
      clearInterval(this.correlationTimer);
      this.correlationTimer = null;
    }
    
    // Stop data collection
    await this.dataCollector.stop();
    
    // Close all positions if configured
    // await this._closeAllPositions();
    
    // Update session status
    await this._finalizeSession();
    
    // Disconnect from exchange
    await this.exchangeAdapter.disconnect();
    
    this.isRunning = false;
    
    this.logger.info('MultiPairOpportunisticTrader stopped', {
      sessionId: this.sessionId,
      duration: Date.now() - this.sessionStartTime,
      opportunitiesDetected: this.opportunitiesDetected,
      tradesExecuted: this.tradesExecuted
    });
    
    this.emit('stopped', {
      sessionId: this.sessionId,
      timestamp: Date.now()
    });
  }
  
  /**
   * Initialize session in Redis
   * @private
   */
  async _initializeSession() {
    const sessionData = {
      id: this.sessionId,
      sessionId: this.sessionId,
      strategy: 'multi_pair_opportunistic',
      strategyType: 'multi_pair',
      exchange: this.exchange,
      tradingPairs: this.pairs,
      status: 'active',
      startTime: Date.now(),
      budget: this.budget,
      enableFuturesLeadDetection: this.enableFuturesLeadDetection,
      riskLimits: CONFIG.RISK_LIMITS,
      pairConfigurations: {}
    };
    
    // Initialize pair configurations
    for (const pair of this.pairs) {
      sessionData.pairConfigurations[pair] = {
        minVolume: 0.001, // Will be updated with live data
        maxPosition: this.budget * CONFIG.RISK_LIMITS.MAX_PAIR_EXPOSURE,
        riskMultiplier: 1.0
      };
    }
    
    // Store session data
    await this.redisAPI.updateSession(sessionData);
    
    this.logger.info('Session initialized', {
      sessionId: this.sessionId,
      pairs: this.pairs
    });
  }
  
  /**
   * Initialize portfolio data
   * @private
   */
  async _initializePortfolio() {
    // Fetch current balances
    const balances = await this.exchangeAdapter.fetchBalances();
    await this.positionManager.updateBalances(balances);
    
    // Fetch current positions
    const positions = await this.exchangeAdapter.fetchPositions();
    await this.positionManager.updatePositions(positions);
    
    this.logger.info('Portfolio initialized', {
      balances: Object.keys(balances),
      positionCount: Object.keys(positions).length
    });
  }
  
  /**
   * Start the main trading loop
   * @private
   */
  _startMainLoop() {
    this.mainLoopTimer = setInterval(() => {
      this._executeTradingLogic().catch(error => {
        this.logger.error('Error in main trading loop', error);
      });
    }, this.mainLoopInterval);
    
    // Execute immediately
    this._executeTradingLogic().catch(error => {
      this.logger.error('Error in initial trading logic execution', error);
    });
  }
  
  /**
   * Main trading logic execution
   * @private
   */
  async _executeTradingLogic() {
    try {
      // Collect latest market data for all pairs
      const marketData = await this.dataCollector.collectAllData();
      
      // Detect opportunities
      const opportunities = await this._detectOpportunities(marketData);
      
      if (opportunities.length > 0) {
        this.opportunitiesDetected += opportunities.length;
        
        // Rank opportunities
        const portfolio = await this.positionManager.getPortfolioState();
        const rankedOpportunities = await this.rankingEngine.rank(opportunities, portfolio);
        
        // Log top opportunities
        this._logTopOpportunities(rankedOpportunities.slice(0, 3));
        
        // Execute best opportunity if it meets criteria
        await this._executeBestOpportunity(rankedOpportunities, portfolio);
      }
      
      // Manage existing positions
      await this._manageExistingPositions();
      
    } catch (error) {
      this.logger.error('Error in trading logic execution', error);
    }
  }
  
  /**
   * Detect trading opportunities across all pairs
   * @private
   */
  async _detectOpportunities(marketData) {
    const opportunities = [];
    const now = Date.now();
    
    for (const [pair, data] of Object.entries(marketData)) {
      if (!data.spot || !data.futures) continue;
      
      // Calculate futures movement
      const futuresMovement = this.dataCollector.calculateFuturesMovement(pair);
      
      if (Math.abs(futuresMovement) >= CONFIG.THRESHOLDS.MIN_FUTURES_MOVEMENT) {
        // Check if we already have an active opportunity for this pair
        const existingOpp = this.activeOpportunities.get(pair);
        if (existingOpp && (now - existingOpp.timestamp) < 5000) {
          continue; // Skip if recent opportunity exists
        }
        
        const opportunity = {
          id: uuidv4(),
          pair,
          timestamp: now,
          signal: {
            direction: futuresMovement > 0 ? 'BUY' : 'SELL',
            futuresMovement,
            futuresPrice: data.futures.price,
            spotPrice: data.spot.price,
            spread: ((data.futures.price - data.spot.price) / data.spot.price) * 100,
            strength: Math.abs(futuresMovement)
          },
          marketData: {
            spotBid: data.spot.bid,
            spotAsk: data.spot.ask,
            spotLiquidity: data.spot.liquidity,
            futuresBid: data.futures.bid,
            futuresAsk: data.futures.ask
          },
          leadTimeExpected: this._estimateLeadTime(futuresMovement)
        };
        
        opportunities.push(opportunity);
        this.activeOpportunities.set(pair, opportunity);
      }
    }
    
    // Clean up old opportunities
    this._cleanupOldOpportunities();
    
    return opportunities;
  }
  
  /**
   * Estimate lead time based on movement magnitude
   * @private
   */
  _estimateLeadTime(movement) {
    const absMovement = Math.abs(movement);
    
    if (absMovement > 0.5) {
      return 2000; // 2 seconds for large moves
    } else if (absMovement > 0.2) {
      return 3000; // 3 seconds for medium moves
    } else {
      return 5000; // 5 seconds for small moves
    }
  }
  
  /**
   * Execute the best opportunity if criteria are met
   * @private
   */
  async _executeBestOpportunity(rankedOpportunities, portfolio) {
    for (const opportunity of rankedOpportunities) {
      // Check minimum score threshold
      if (opportunity.finalScore < CONFIG.THRESHOLDS.MIN_OPPORTUNITY_SCORE) {
        break; // Opportunities are sorted, so no better ones below
      }
      
      // Check if we can take this position
      const size = await this._calculatePositionSize(opportunity, portfolio);
      if (!size || size === 0) {
        continue;
      }
      
      if (!this.positionManager.canTakePosition(opportunity.pair, size)) {
        this.logger.debug('Position limits prevent taking opportunity', {
          pair: opportunity.pair,
          requestedSize: size
        });
        continue;
      }
      
      // Execute the trade
      const result = await this.executionEngine.executeOpportunity(opportunity, size);
      
      if (result.executed) {
        this.tradesExecuted++;
        
        // Update position manager
        await this.positionManager.addPosition({
          pair: opportunity.pair,
          side: opportunity.signal.direction,
          size: size,
          entryPrice: result.order.price,
          orderId: result.order.id
        });
        
        // Store opportunity in Redis
        await this.redisAPI.storeOpportunity(opportunity, result.order);
        
        this.logger.info('Opportunity executed successfully', {
          pair: opportunity.pair,
          direction: opportunity.signal.direction,
          size: size,
          score: opportunity.finalScore,
          executionTime: result.executionTime
        });
        
        this.emit('tradeExecuted', {
          opportunity,
          order: result.order,
          executionTime: result.executionTime
        });
        
        break; // Only execute one opportunity per cycle
      }
    }
  }
  
  /**
   * Calculate position size for opportunity
   * @private
   */
  async _calculatePositionSize(opportunity, portfolio) {
    const availableBudget = portfolio.availableBalance;
    const maxPairExposure = this.budget * CONFIG.RISK_LIMITS.MAX_PAIR_EXPOSURE;
    const currentPairExposure = portfolio.exposures[opportunity.pair] || 0;
    
    // Calculate maximum allowed size
    const maxAllowedSize = Math.min(
      availableBudget * 0.1, // 10% of available per trade
      maxPairExposure - currentPairExposure
    );
    
    // Convert to base currency size
    const baseSize = maxAllowedSize / opportunity.signal.spotPrice;
    
    // Ensure minimum size
    if (baseSize * opportunity.signal.spotPrice < CONFIG.RISK_LIMITS.MIN_POSITION_SIZE_USD) {
      return 0;
    }
    
    return baseSize;
  }
  
  /**
   * Manage existing positions
   * @private
   */
  async _manageExistingPositions() {
    const positions = await this.positionManager.getActivePositions();
    
    for (const position of positions) {
      // Check for exit conditions
      // This could include:
      // - Take profit targets
      // - Stop loss levels
      // - Time-based exits
      // - Signal reversal
      
      // For now, just track performance
      const currentPrice = await this.dataCollector.getCurrentPrice(position.pair);
      const pnl = this.positionManager.calculatePnL(position, currentPrice);
      
      if (pnl.percentage > 0.5) { // 0.5% profit
        // Consider taking profit
        this.logger.debug('Position in profit', {
          pair: position.pair,
          pnl: pnl.percentage
        });
      }
    }
  }
  
  /**
   * Log top opportunities for monitoring
   * @private
   */
  _logTopOpportunities(opportunities) {
    if (opportunities.length === 0) return;
    
    this.logger.info('Top opportunities detected', {
      count: opportunities.length,
      top: opportunities.map(opp => ({
        pair: opp.pair,
        score: opp.finalScore.toFixed(2),
        direction: opp.signal.direction,
        spread: opp.signal.spread.toFixed(3) + '%'
      }))
    });
  }
  
  /**
   * Clean up old opportunities
   * @private
   */
  _cleanupOldOpportunities() {
    const now = Date.now();
    const maxAge = 30000; // 30 seconds
    
    for (const [pair, opportunity] of this.activeOpportunities) {
      if (now - opportunity.timestamp > maxAge) {
        this.activeOpportunities.delete(pair);
      }
    }
  }
  
  /**
   * Start performance monitoring
   * @private
   */
  _startPerformanceMonitoring() {
    this.performanceTimer = setInterval(() => {
      this._updatePerformanceMetrics().catch(error => {
        this.logger.error('Error updating performance metrics', error);
      });
    }, CONFIG.INTERVALS.PERFORMANCE_UPDATE);
  }
  
  /**
   * Update performance metrics
   * @private
   */
  async _updatePerformanceMetrics() {
    const metrics = {
      sessionDuration: Date.now() - this.sessionStartTime,
      opportunitiesDetected: this.opportunitiesDetected,
      tradesExecuted: this.tradesExecuted,
      successRate: this.tradesExecuted > 0 ? (this.tradesExecuted / this.opportunitiesDetected) : 0,
      pairPerformance: {}
    };
    
    // Get per-pair performance
    for (const pair of this.pairs) {
      const performance = await this.positionManager.getPairPerformance(pair);
      metrics.pairPerformance[pair] = performance;
    }
    
    // Store in Redis
    await this.redisAPI.updatePerformanceMetrics(metrics);
    
    this.logger.info('Performance update', metrics);
  }
  
  /**
   * Start correlation tracking
   * @private
   */
  _startCorrelationTracking() {
    this.correlationTimer = setInterval(() => {
      this._updateCorrelations().catch(error => {
        this.logger.error('Error updating correlations', error);
      });
    }, CONFIG.INTERVALS.CORRELATION_UPDATE);
  }
  
  /**
   * Update pair correlations
   * @private
   */
  async _updateCorrelations() {
    const correlations = await this.dataCollector.calculateCorrelations();
    await this.positionManager.updateCorrelations(correlations);
    
    this.logger.debug('Correlations updated', {
      highestCorrelation: Math.max(...Object.values(correlations))
    });
  }
  
  /**
   * Finalize session
   * @private
   */
  async _finalizeSession() {
    const finalMetrics = {
      endTime: Date.now(),
      status: 'completed',
      totalOpportunities: this.opportunitiesDetected,
      totalTrades: this.tradesExecuted,
      finalBalance: await this.exchangeAdapter.fetchBalances()
    };
    
    await this.redisAPI.updateSession(finalMetrics);
    
    this.logger.info('Session finalized', {
      sessionId: this.sessionId,
      duration: finalMetrics.endTime - this.sessionStartTime
    });
  }
  
  /**
   * Cleanup resources
   * @private
   */
  async _cleanup() {
    try {
      // Stop all components
      if (this.dataCollector) {
        await this.dataCollector.stop();
      }
      
      // Clear intervals
      if (this.mainLoopTimer) clearInterval(this.mainLoopTimer);
      if (this.performanceTimer) clearInterval(this.performanceTimer);
      if (this.correlationTimer) clearInterval(this.correlationTimer);
      
      // Clear maps
      this.activeOpportunities.clear();
      
    } catch (error) {
      this.logger.error('Error during cleanup', error);
    }
  }
}

export default MultiPairOpportunisticTrader;