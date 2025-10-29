/**
 * Volume-Optimized Order Engine
 * 
 * Simplified order engine focused on:
 * 1. Breakeven/profitable trades only
 * 2. Maximum volume generation
 * 3. Fastest possible exits
 */

import { EntryExitCalculator } from './entry-exit-calculator.js';
import { VolumeFocusedExitOptimizer } from './volume-focused-exit-optimizer.js';
import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'VolumeOptimizedOrderEngine' });

export class VolumeOptimizedOrderEngine {
  constructor(config = {}) {
    this.config = {
      // Volume targets
      targetVolume30d: 500000, // $500k for next tier
      currentVolume30d: 0,
      
      // Trade settings
      maxHoldTime: 240, // 4 hours maximum
      preferredHoldTime: 30, // 30 minutes preferred
      
      // Risk settings
      minConfidence: 0.65,
      acceptBreakeven: true,
      
      ...config
    };
    
    this.entryCalculator = new EntryExitCalculator();
    this.exitOptimizer = new VolumeFocusedExitOptimizer({
      maxHoldTime: this.config.maxHoldTime,
      preferredExitTime: this.config.preferredHoldTime,
      acceptBreakeven: this.config.acceptBreakeven
    });
    
    this.sessionStats = {
      trades: 0,
      volume: 0,
      profit: 0,
      avgHoldTime: 0
    };
  }
  
  /**
   * Process trading opportunity with volume optimization
   * @param {Object} marketData Current market data
   * @param {Object} decision Weighted decision from engine
   * @param {Object} feeInfo Current fee information
   * @returns {Object} Order decision
   */
  async processOpportunity(marketData, decision, feeInfo) {
    // Skip low confidence
    if (decision.confidence < this.config.minConfidence) {
      return { action: 'skip', reason: 'Low confidence' };
    }
    
    // Update fee rates
    this.exitOptimizer.updateFeeRates(feeInfo);
    
    // 1. Calculate optimal entry
    const entryDetails = this.entryCalculator.calculateEntryPrice(
      marketData,
      decision
    );
    
    // 2. Find volume-optimal exit
    const exitStrategy = this.exitOptimizer.findVolumeOptimalExits(
      entryDetails,
      marketData,
      marketData.historicalData,
      decision
    );
    
    // 3. Make go/no-go decision
    const goDecision = this.evaluateOpportunity(
      exitStrategy,
      decision,
      feeInfo
    );
    
    if (!goDecision.execute) {
      return { action: 'skip', reason: goDecision.reason };
    }
    
    // 4. Generate orders
    const orders = this.generateOrders(
      entryDetails,
      exitStrategy,
      decision
    );
    
    // 5. Create execution plan
    return {
      action: 'execute',
      orders,
      analysis: this.generateAnalysis(entryDetails, exitStrategy, decision, feeInfo),
      metrics: exitStrategy.metrics,
      recommendation: exitStrategy.analysis.recommendation
    };
  }
  
  /**
   * Evaluate if opportunity meets volume building criteria
   */
  evaluateOpportunity(exitStrategy, decision, feeInfo) {
    const netProfit = exitStrategy.metrics.netProfitPercent;
    const expectedTime = exitStrategy.expectedTime;
    const probability = exitStrategy.probability;
    
    // Must be at least breakeven
    if (netProfit < 0) {
      return { execute: false, reason: 'Unprofitable after fees' };
    }
    
    // Prefer faster exits
    if (expectedTime > this.config.maxHoldTime) {
      return { execute: false, reason: 'Exit time too long' };
    }
    
    // Minimum probability threshold
    if (probability < 0.4) {
      return { execute: false, reason: 'Fill probability too low' };
    }
    
    // Calculate score
    const score = this.calculateOpportunityScore(
      netProfit,
      expectedTime,
      probability,
      decision.confidence
    );
    
    if (score < 0.5) {
      return { execute: false, reason: 'Opportunity score too low' };
    }
    
    return { execute: true, score };
  }
  
  /**
   * Score opportunity based on volume optimization goals
   */
  calculateOpportunityScore(netProfit, expectedTime, probability, confidence) {
    // Normalize inputs
    const profitScore = Math.min(1, netProfit / 0.005); // Max at 0.5%
    const timeScore = 1 - (expectedTime / this.config.maxHoldTime); // Faster is better
    const probScore = probability;
    const confScore = confidence;
    
    // Weights prioritizing speed and reliability
    const weights = {
      profit: 0.2,    // 20% - just needs to be positive
      time: 0.4,      // 40% - speed is critical
      probability: 0.3, // 30% - must fill reliably
      confidence: 0.1  // 10% - signal confidence
    };
    
    return (
      profitScore * weights.profit +
      timeScore * weights.time +
      probScore * weights.probability +
      confScore * weights.confidence
    );
  }
  
  /**
   * Generate simple entry + exit orders
   */
  generateOrders(entryDetails, exitStrategy, decision) {
    const orders = [];
    
    // Entry order
    orders.push({
      id: `entry_${Date.now()}`,
      type: 'entry',
      side: decision.direction,
      price: Number(entryDetails.price.toFixed(4)),
      size: decision.adjustedSize,
      orderType: 'LIMIT',
      postOnly: true,
      ttl: 300, // 5 minute TTL for entry
      metadata: {
        offset: entryDetails.offset,
        improvement: entryDetails.improvementPercent
      }
    });
    
    // Single exit order (volume optimized)
    orders.push({
      id: `exit_${Date.now()}`,
      type: 'exit',
      side: decision.direction === 'buy' ? 'sell' : 'buy',
      price: Number(exitStrategy.exitPrice.toFixed(4)),
      size: decision.adjustedSize,
      orderType: 'LIMIT',
      postOnly: true,
      ttl: exitStrategy.orderParams.ttl,
      reduceOnly: true,
      metadata: {
        target: exitStrategy.target,
        expectedTime: exitStrategy.expectedTime,
        netProfit: exitStrategy.metrics.netProfit
      }
    });
    
    return orders;
  }
  
  /**
   * Generate analysis for logging/monitoring
   */
  generateAnalysis(entryDetails, exitStrategy, decision, feeInfo) {
    const volumeMetrics = this.exitOptimizer.calculateVolumeMetrics(
      exitStrategy,
      this.config.maxHoldTime
    );
    
    return {
      pair: decision.pair,
      direction: decision.direction,
      
      entry: {
        price: entryDetails.price,
        improvement: `${entryDetails.improvementPercent.toFixed(3)}%`,
        signals: {
          futures: decision.futuresSignal?.direction,
          confidence: decision.confidence
        }
      },
      
      exit: {
        strategy: 'single_exit_volume_optimized',
        price: exitStrategy.exitPrice,
        target: `${(exitStrategy.target * 100).toFixed(3)}%`,
        netProfit: `${exitStrategy.metrics.netProfitPercent.toFixed(3)}%`,
        expectedTime: `${exitStrategy.expectedTime} minutes`,
        probability: `${(exitStrategy.probability * 100).toFixed(0)}%`
      },
      
      volume: {
        tradesPerHour: exitStrategy.metrics.turnoversPerHour.toFixed(1),
        volumePerHour: `$${exitStrategy.metrics.volumePerHour.toFixed(0)}`,
        expectedTradesIn4h: volumeMetrics.expectedTrades,
        expectedVolumeIn4h: `$${volumeMetrics.expectedVolume.toFixed(0)}`
      },
      
      fees: {
        currentMakerFee: `${(feeInfo.maker * 100).toFixed(3)}%`,
        roundTripCost: `${(exitStrategy.metrics.breakeven * 100).toFixed(3)}%`,
        netAfterFees: `${exitStrategy.metrics.netProfitPercent.toFixed(3)}%`
      },
      
      recommendation: exitStrategy.analysis.recommendation
    };
  }
  
  /**
   * Update session statistics
   */
  updateStats(executedTrade) {
    this.sessionStats.trades++;
    this.sessionStats.volume += executedTrade.size * executedTrade.price;
    this.sessionStats.profit += executedTrade.profit;
    
    // Update average hold time
    const prevAvg = this.sessionStats.avgHoldTime;
    this.sessionStats.avgHoldTime = 
      (prevAvg * (this.sessionStats.trades - 1) + executedTrade.holdTime) / 
      this.sessionStats.trades;
  }
  
  /**
   * Get session performance summary
   */
  getSessionSummary() {
    const hoursElapsed = this.sessionStats.trades > 0 ? 
      (this.sessionStats.avgHoldTime * this.sessionStats.trades) / 60 : 0;
    
    return {
      trades: this.sessionStats.trades,
      volume: this.sessionStats.volume,
      avgHoldTime: `${this.sessionStats.avgHoldTime.toFixed(0)} minutes`,
      tradesPerHour: hoursElapsed > 0 ? 
        (this.sessionStats.trades / hoursElapsed).toFixed(1) : 0,
      volumePerHour: hoursElapsed > 0 ? 
        (this.sessionStats.volume / hoursElapsed).toFixed(0) : 0,
      netProfit: this.sessionStats.profit,
      avgProfitPerTrade: this.sessionStats.trades > 0 ?
        (this.sessionStats.profit / this.sessionStats.trades).toFixed(4) : 0
    };
  }
}

// Example usage
export async function processVolumeOptimizedTrade(marketData, decision, feeInfo) {
  const engine = new VolumeOptimizedOrderEngine({
    currentVolume30d: feeInfo.volume30d || 400000,
    minConfidence: 0.65,
    acceptBreakeven: true
  });
  
  return await engine.processOpportunity(marketData, decision, feeInfo);
}

export default VolumeOptimizedOrderEngine;