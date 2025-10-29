/**
 * Complete Order Optimizer
 * 
 * Integrates all components for optimal entry and exit calculation:
 * - Entry price optimization with multi-signal fusion
 * - Optimal exit finding with historical + real-time analysis
 * - Fee-aware profit maximization
 * - Multi-tier execution strategy
 */

import { EntryExitCalculator } from './entry-exit-calculator.js';
import { OptimalExitFinder } from './optimal-exit-finder.js';
import { FeeAwareExitOptimizer } from './fee-aware-exit-optimizer.js';
import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'CompleteOrderOptimizer' });

export class CompleteOrderOptimizer {
  constructor(config = {}) {
    this.config = {
      // Analysis mode
      analysisMode: 'hybrid', // 'historical', 'realtime', or 'hybrid'
      
      // Optimization preferences
      optimizeFor: 'profit', // 'profit', 'volume', or 'balanced'
      
      // Risk settings
      maxRiskPerTrade: 0.02,
      useStopLoss: true,
      
      ...config
    };
    
    this.entryCalculator = new EntryExitCalculator(config.entry);
    this.exitFinder = new OptimalExitFinder(config.exit);
    this.feeOptimizer = new FeeAwareExitOptimizer(config.fees);
    
    this.initialized = false;
  }
  
  async initialize() {
    await this.exitFinder.initialize();
    this.initialized = true;
    logger.info('Complete Order Optimizer initialized');
  }
  
  /**
   * Calculate complete optimal order setup
   * @param {Object} marketData Current market data including orderbook
   * @param {Object} decision Weighted decision from engine
   * @param {Object} feeInfo Current fee information
   * @param {Object} historicalPatterns Optional historical patterns
   * @returns {Object} Complete order optimization
   */
  async optimizeOrder(marketData, decision, feeInfo, historicalPatterns = null) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Update fee rates
    this.feeOptimizer.updateFeeRates(feeInfo);
    
    // 1. Calculate optimal entry
    const entryDetails = this.entryCalculator.calculateEntryPrice(
      marketData,
      decision,
      historicalPatterns
    );
    
    logger.info(`Entry optimization for ${decision.pair}:`, {
      currentPrice: marketData.price,
      entryPrice: entryDetails.price,
      improvement: `${entryDetails.improvementPercent.toFixed(3)}%`
    });
    
    // 2. Find optimal exits using all methods
    const optimalExits = await this.exitFinder.findOptimalExits(
      entryDetails,
      marketData,
      decision,
      feeInfo
    );
    
    // 3. Apply fee optimization
    const feeOptimizedExits = this.feeOptimizer.calculateOptimalExit(
      entryDetails,
      marketData,
      decision,
      { 
        useMakerOnly: true,
        conservativeExit: this.config.optimizeFor === 'volume'
      }
    );
    
    // 4. Merge and optimize all exit strategies
    const finalStrategy = this.mergeExitStrategies(
      optimalExits,
      feeOptimizedExits,
      decision,
      historicalPatterns
    );
    
    // 5. Calculate position sizing
    const positionSize = this.calculateOptimalPosition(
      entryDetails,
      finalStrategy,
      marketData,
      decision
    );
    
    // 6. Generate complete order plan
    const orderPlan = this.generateOrderPlan(
      entryDetails,
      finalStrategy,
      positionSize,
      decision
    );
    
    // 7. Add analysis and recommendations
    const analysis = this.generateAnalysis(
      orderPlan,
      optimalExits,
      feeOptimizedExits,
      decision
    );
    
    return {
      success: true,
      pair: decision.pair,
      direction: decision.direction,
      entry: entryDetails,
      exits: finalStrategy,
      position: positionSize,
      orders: orderPlan,
      analysis,
      recommendation: this.generateRecommendation(analysis),
      timestamp: Date.now()
    };
  }
  
  /**
   * Merge exit strategies from different optimizers
   */
  mergeExitStrategies(optimalExits, feeExits, decision, patterns) {
    // Extract targets from each strategy
    const historicalTargets = optimalExits.summary;
    const feeTargets = feeExits.strategy.tiers;
    
    // Weight different approaches based on config
    const weights = this.getStrategyWeights();
    
    // Build merged strategy
    const mergedTiers = [];
    
    // Tier 1: Conservative (highest probability)
    const conservativeTarget = this.weightTargets(
      historicalTargets.conservative?.target || feeExits.minProfitableExit.profit,
      feeExits.minProfitableExit.profit,
      weights
    );
    
    mergedTiers.push({
      level: 1,
      name: 'conservative',
      target: conservativeTarget,
      price: this.calculateExitPrice(decision, conservativeTarget),
      sizePercent: 0.25,
      probability: Math.max(
        historicalTargets.conservative?.probability || 0.7,
        0.7
      ),
      expectedTime: historicalTargets.conservative?.expectedTime || '5-15 minutes',
      reason: 'Quick profit, high probability'
    });
    
    // Tier 2: Primary (balanced)
    const primaryTarget = this.weightTargets(
      historicalTargets.primary?.target || feeExits.targetExit.profit,
      feeExits.targetExit.profit,
      weights
    );
    
    mergedTiers.push({
      level: 2,
      name: 'primary',
      target: primaryTarget,
      price: this.calculateExitPrice(decision, primaryTarget),
      sizePercent: 0.5,
      probability: Math.max(
        historicalTargets.primary?.probability || 0.5,
        0.5
      ),
      expectedTime: '30-60 minutes',
      reason: 'Main profit target'
    });
    
    // Tier 3: Aggressive (capture extended moves)
    if (this.config.optimizeFor !== 'volume') {
      const aggressiveTarget = this.weightTargets(
        historicalTargets.aggressive?.target || feeExits.maxExit.profit,
        feeExits.maxExit.profit,
        weights
      );
      
      mergedTiers.push({
        level: 3,
        name: 'aggressive',
        target: aggressiveTarget,
        price: this.calculateExitPrice(decision, aggressiveTarget),
        sizePercent: 0.25,
        probability: Math.max(
          historicalTargets.aggressive?.probability || 0.2,
          0.2
        ),
        expectedTime: '2-4 hours',
        reason: 'Capture extended moves'
      });
    }
    
    // Calculate weighted average
    const weightedAverage = this.calculateWeightedAverage(mergedTiers);
    
    return {
      strategy: 'multi_tier_optimized',
      tiers: mergedTiers,
      averageTarget: weightedAverage.target,
      averagePrice: weightedAverage.price,
      expectedProfit: weightedAverage.profit,
      breakeven: feeExits.costs.totalCost,
      netProfit: weightedAverage.target - feeExits.costs.totalCost,
      optimal: optimalExits.summary.optimal || patterns
    };
  }
  
  /**
   * Get strategy weights based on configuration
   */
  getStrategyWeights() {
    switch (this.config.analysisMode) {
      case 'historical':
        return { historical: 0.7, realtime: 0.3 };
      case 'realtime':
        return { historical: 0.3, realtime: 0.7 };
      case 'hybrid':
      default:
        return { historical: 0.5, realtime: 0.5 };
    }
  }
  
  /**
   * Weight targets from different sources
   */
  weightTargets(historicalTarget, realtimeTarget, weights) {
    return (
      historicalTarget * weights.historical +
      realtimeTarget * weights.realtime
    );
  }
  
  /**
   * Calculate exit price from target percentage
   */
  calculateExitPrice(decision, targetPercent) {
    const entryPrice = decision.entryPrice || decision.basePrice;
    
    return decision.direction === 'buy' ?
      entryPrice * (1 + targetPercent) :
      entryPrice * (1 - targetPercent);
  }
  
  /**
   * Calculate weighted average of tiers
   */
  calculateWeightedAverage(tiers) {
    let weightedTarget = 0;
    let weightedPrice = 0;
    let totalWeight = 0;
    
    for (const tier of tiers) {
      weightedTarget += tier.target * tier.sizePercent;
      weightedPrice += tier.price * tier.sizePercent;
      totalWeight += tier.sizePercent;
    }
    
    return {
      target: weightedTarget / totalWeight,
      price: weightedPrice / totalWeight,
      profit: weightedTarget / totalWeight
    };
  }
  
  /**
   * Calculate optimal position size
   */
  calculateOptimalPosition(entryDetails, exitStrategy, marketData, decision) {
    const baseSize = decision.adjustedSize || decision.size;
    const accountBalance = marketData.accountBalance || 10000;
    
    // Risk-based sizing
    let riskSize = baseSize;
    
    if (this.config.useStopLoss && exitStrategy.optimal?.stopLoss) {
      const stopLoss = exitStrategy.optimal.stopLoss;
      const riskPerUnit = Math.abs(entryDetails.price * stopLoss);
      const maxRisk = accountBalance * this.config.maxRiskPerTrade;
      riskSize = Math.min(baseSize, maxRisk / riskPerUnit);
    }
    
    // Confidence-based adjustment
    const confidenceMultiplier = 0.5 + (decision.confidence * 0.5);
    const adjustedSize = riskSize * confidenceMultiplier;
    
    // Volume optimization
    if (this.config.optimizeFor === 'volume') {
      // Increase size for volume building
      return {
        base: baseSize,
        adjusted: adjustedSize * 1.2,
        value: adjustedSize * 1.2 * entryDetails.price,
        riskPercent: (adjustedSize * 1.2 * entryDetails.price) / accountBalance
      };
    }
    
    return {
      base: baseSize,
      adjusted: adjustedSize,
      value: adjustedSize * entryDetails.price,
      riskPercent: (adjustedSize * entryDetails.price) / accountBalance
    };
  }
  
  /**
   * Generate complete order plan
   */
  generateOrderPlan(entryDetails, exitStrategy, positionSize, decision) {
    const orders = [];
    
    // Entry order
    orders.push({
      id: `entry_${Date.now()}`,
      type: 'entry',
      side: decision.direction,
      price: Number(entryDetails.price.toFixed(4)),
      size: Number(positionSize.adjusted.toFixed(6)),
      orderType: 'LIMIT',
      postOnly: true,
      ttl: Math.max(60, Math.round(decision.executionDelay / 1000)) || 300,
      metadata: {
        strategy: 'optimized_entry',
        offset: entryDetails.offset,
        confidence: decision.confidence
      }
    });
    
    // Exit orders (multi-tier)
    let remainingSize = positionSize.adjusted;
    
    for (const tier of exitStrategy.tiers) {
      const tierSize = positionSize.adjusted * tier.sizePercent;
      
      orders.push({
        id: `exit_t${tier.level}_${Date.now()}`,
        type: 'exit',
        side: decision.direction === 'buy' ? 'sell' : 'buy',
        price: Number(tier.price.toFixed(4)),
        size: Number(tierSize.toFixed(6)),
        orderType: 'LIMIT',
        postOnly: true,
        ttl: 3600 * tier.level, // Longer TTL for higher tiers
        metadata: {
          tier: tier.level,
          name: tier.name,
          target: tier.target,
          probability: tier.probability,
          reason: tier.reason
        }
      });
      
      remainingSize -= tierSize;
    }
    
    // Stop loss (if enabled)
    if (this.config.useStopLoss && exitStrategy.optimal?.stopLoss) {
      const stopPrice = decision.direction === 'buy' ?
        entryDetails.price * (1 - exitStrategy.optimal.stopLoss) :
        entryDetails.price * (1 + exitStrategy.optimal.stopLoss);
      
      orders.push({
        id: `stop_${Date.now()}`,
        type: 'stop_loss',
        side: decision.direction === 'buy' ? 'sell' : 'buy',
        triggerPrice: Number(stopPrice.toFixed(4)),
        size: Number(positionSize.adjusted.toFixed(6)),
        orderType: 'MARKET',
        metadata: {
          lossPercent: exitStrategy.optimal.stopLoss,
          maxLoss: exitStrategy.optimal.stopLoss * positionSize.value
        }
      });
    }
    
    return orders;
  }
  
  /**
   * Generate comprehensive analysis
   */
  generateAnalysis(orderPlan, optimalExits, feeExits, decision) {
    return {
      entry: {
        method: 'multi_signal_optimization',
        signals: {
          futures: decision.futuresSignal?.direction,
          temporal: decision.temporalBias?.combinedBias > 0 ? 'positive' : 'negative',
          microTiming: decision.adjustments?.timing?.urgency || 'normal'
        }
      },
      
      exits: {
        method: 'hybrid_optimization',
        historical: {
          available: optimalExits.success !== false,
          confidence: optimalExits.summary?.optimal?.winRate || 0.5
        },
        feeOptimized: {
          breakeven: feeExits.costs.totalCost,
          minProfitable: feeExits.minProfitableExit.profit,
          targetROI: feeExits.expectedProfit.roi
        }
      },
      
      risk: {
        positionRisk: orderPlan[0].size * orderPlan[0].price,
        maxLoss: orderPlan.find(o => o.type === 'stop_loss')?.metadata.maxLoss || 'No stop loss',
        confidence: decision.confidence
      },
      
      execution: {
        totalOrders: orderPlan.length,
        entryTTL: orderPlan[0].ttl,
        exitStrategy: 'multi_tier',
        tiers: orderPlan.filter(o => o.type === 'exit').length
      }
    };
  }
  
  /**
   * Generate final recommendation
   */
  generateRecommendation(analysis) {
    const confidence = analysis.risk.confidence;
    
    if (confidence >= 0.8) {
      return {
        action: 'execute_full',
        reason: 'High confidence with optimal exits identified',
        priority: 'high'
      };
    } else if (confidence >= 0.65) {
      return {
        action: 'execute_standard',
        reason: 'Good opportunity with reasonable risk/reward',
        priority: 'medium'
      };
    } else {
      return {
        action: 'skip',
        reason: 'Insufficient confidence',
        priority: 'low'
      };
    }
  }
}

// Example usage
export async function optimizeCompleteOrder(marketData, decision, feeInfo) {
  const optimizer = new CompleteOrderOptimizer({
    analysisMode: 'hybrid',
    optimizeFor: 'profit',
    maxRiskPerTrade: 0.02
  });
  
  return await optimizer.optimizeOrder(
    marketData,
    decision,
    feeInfo
  );
}

export default CompleteOrderOptimizer;