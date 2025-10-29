/**
 * Integrated Order Calculator
 * 
 * Combines entry calculation with fee-aware exit optimization
 * for complete order parameter generation.
 */

import { EntryExitCalculator } from './entry-exit-calculator.js';
import { FeeAwareExitOptimizer } from './fee-aware-exit-optimizer.js';
import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'IntegratedOrderCalculator' });

export class IntegratedOrderCalculator {
  constructor(config = {}) {
    this.config = {
      // Volume building settings
      volumeBuildingMode: false,
      volumeThreshold: 500000, // $500k for next tier
      
      // Risk settings
      maxPositionRisk: 0.02,   // 2% max risk per position
      useStopLoss: true,
      
      ...config
    };
    
    this.entryCalculator = new EntryExitCalculator(config.entry);
    this.exitOptimizer = new FeeAwareExitOptimizer({
      ...config.exit,
      volumeBuildingMode: this.config.volumeBuildingMode
    });
  }
  
  /**
   * Update fee information
   */
  async updateFees(feeInfo) {
    this.exitOptimizer.updateFeeRates(feeInfo);
    
    // Check if we should enable volume building mode
    const progression = this.exitOptimizer.getFeeProgressionInfo();
    if (progression && progression.volumeNeeded < this.config.volumeThreshold) {
      logger.info('Enabling volume building mode', {
        volumeNeeded: progression.volumeNeeded,
        progress: `${(progression.volumeProgress * 100).toFixed(1)}%`
      });
      this.config.volumeBuildingMode = true;
      this.exitOptimizer.config.volumeBuildingMode = true;
    }
  }
  
  /**
   * Calculate complete order parameters
   * @param {Object} marketData Current market data
   * @param {Object} decision Weighted decision from engine
   * @param {Object} patterns Historical patterns (optional)
   * @returns {Object} Complete order setup
   */
  calculateOrderSetup(marketData, decision, patterns = null) {
    // Skip if confidence too low
    if (decision.confidence < 0.65) {
      return null;
    }
    
    // 1. Calculate entry price
    const entryDetails = this.entryCalculator.calculateEntryPrice(
      marketData,
      decision,
      patterns
    );
    
    // 2. Calculate fee-aware exit
    const exitDetails = this.exitOptimizer.calculateOptimalExit(
      entryDetails,
      marketData,
      decision,
      {
        conservativeExit: decision.confidence < 0.7,
        aggressiveExit: decision.confidence > 0.85
      }
    );
    
    // 3. Calculate position size based on risk
    const positionSize = this.calculatePositionSize(
      decision,
      entryDetails,
      exitDetails,
      marketData
    );
    
    // 4. Generate order specifications
    const orders = this.generateOrders(
      entryDetails,
      exitDetails,
      positionSize,
      decision
    );
    
    return {
      pair: decision.pair,
      direction: decision.direction,
      confidence: decision.confidence,
      entryDetails,
      exitDetails,
      positionSize,
      orders,
      analysis: this.generateAnalysis(entryDetails, exitDetails, decision),
      timestamp: Date.now()
    };
  }
  
  /**
   * Calculate position size based on risk parameters
   */
  calculatePositionSize(decision, entryDetails, exitDetails, marketData) {
    const baseSize = decision.adjustedSize;
    
    // Adjust for risk
    let riskAdjustedSize = baseSize;
    
    if (this.config.useStopLoss) {
      const stopLoss = this.entryCalculator.calculateStopLossPrice(entryDetails);
      const riskPerUnit = Math.abs(entryDetails.price - stopLoss.price);
      const maxRiskValue = marketData.accountBalance * this.config.maxPositionRisk;
      const maxUnits = maxRiskValue / riskPerUnit;
      
      riskAdjustedSize = Math.min(baseSize, maxUnits);
    }
    
    // Adjust for fee tier optimization
    if (this.config.volumeBuildingMode) {
      // Increase size to accelerate volume building
      riskAdjustedSize *= 1.2;
    }
    
    // Ensure minimum order size
    const minSize = marketData.minOrderSize || 0.001;
    riskAdjustedSize = Math.max(riskAdjustedSize, minSize);
    
    return {
      base: baseSize,
      adjusted: riskAdjustedSize,
      value: riskAdjustedSize * entryDetails.price,
      riskPercent: (riskAdjustedSize * entryDetails.price) / marketData.accountBalance
    };
  }
  
  /**
   * Generate order specifications
   */
  generateOrders(entryDetails, exitDetails, positionSize, decision) {
    const orders = [];
    
    // Entry order
    orders.push({
      type: 'entry',
      side: decision.direction,
      price: Number(entryDetails.price.toFixed(4)),
      size: Number(positionSize.adjusted.toFixed(6)),
      orderType: 'LIMIT',
      postOnly: true,
      ttl: Math.round(decision.executionDelay / 1000) || 300, // seconds
      metadata: {
        offset: entryDetails.offset,
        improvement: entryDetails.improvementPercent,
        confidence: decision.confidence
      }
    });
    
    // Exit orders (multi-tier)
    exitDetails.strategy.tiers.forEach((tier, index) => {
      const exitSize = positionSize.adjusted * tier.sizePercent;
      
      orders.push({
        type: 'exit',
        side: decision.direction === 'buy' ? 'sell' : 'buy',
        price: Number(tier.price.toFixed(4)),
        size: Number(exitSize.toFixed(6)),
        orderType: 'LIMIT',
        postOnly: true,
        ttl: 3600, // 1 hour default
        tier: tier.level,
        metadata: {
          reason: tier.reason,
          expectedFillTime: tier.expectedFillTime,
          profitTarget: exitDetails.targetExit.profitPercent
        }
      });
    });
    
    // Stop loss order (if enabled)
    if (this.config.useStopLoss) {
      const stopLoss = this.entryCalculator.calculateStopLossPrice(entryDetails);
      
      orders.push({
        type: 'stop_loss',
        side: decision.direction === 'buy' ? 'sell' : 'buy',
        triggerPrice: Number(stopLoss.price.toFixed(4)),
        size: Number(positionSize.adjusted.toFixed(6)),
        orderType: 'MARKET',
        metadata: {
          lossPercent: stopLoss.percent,
          maxLoss: stopLoss.distance * positionSize.adjusted
        }
      });
    }
    
    return orders;
  }
  
  /**
   * Generate comprehensive analysis
   */
  generateAnalysis(entryDetails, exitDetails, decision) {
    const feeInfo = this.exitOptimizer.getFeeProgressionInfo();
    
    return {
      // Entry analysis
      entry: {
        priceImprovement: `${entryDetails.improvementPercent.toFixed(3)}%`,
        components: entryDetails.components,
        reasoning: `Entry offset based on: futures signal (${(entryDetails.components.futures * 100).toFixed(2)}%), temporal bias (${(entryDetails.components.temporal * 100).toFixed(2)}%), micro-timing adjustment`
      },
      
      // Exit analysis
      exit: {
        strategy: exitDetails.strategy.type,
        tiers: exitDetails.strategy.tiers.length,
        averageTarget: `${(exitDetails.strategy.effectiveProfit * 100).toFixed(3)}%`,
        breakEven: `${(exitDetails.costs.totalCost * 100).toFixed(3)}%`,
        expectedROI: `${(exitDetails.expectedProfit.roi * 100).toFixed(1)}%`,
        reasoning: exitDetails.recommendation
      },
      
      // Fee analysis
      fees: {
        roundTripCost: `${(exitDetails.costs.totalCost * 100).toFixed(3)}%`,
        costBreakdown: {
          buyFee: `${(exitDetails.costs.buyFee * 100).toFixed(3)}%`,
          sellFee: `${(exitDetails.costs.sellFee * 100).toFixed(3)}%`,
          slippage: `${(exitDetails.costs.slippage * 100).toFixed(3)}%`
        },
        tierProgression: feeInfo
      },
      
      // Risk analysis
      risk: {
        confidence: decision.confidence,
        signals: {
          futures: decision.futuresSignal?.direction || 'neutral',
          temporal: decision.temporalBias?.combinedBias > 0 ? 'positive' : 'negative',
          microTiming: decision.adjustments?.timing?.urgency || 0
        }
      },
      
      // Recommendations
      recommendations: [
        exitDetails.recommendation.warning,
        this.config.volumeBuildingMode ? 'Volume building mode active - accepting lower profits' : null,
        decision.confidence > 0.8 ? 'High confidence - consider larger position' : null
      ].filter(Boolean)
    };
  }
}

// Example usage
export function createOrderCalculator(config = {}) {
  return new IntegratedOrderCalculator({
    volumeBuildingMode: config.volumeBuildingMode || false,
    entry: {
      baseEntryOffset: config.baseEntryOffset || 0.002,
      baseProfitTarget: config.baseProfitTarget || 0.008
    },
    exit: {
      minProfitMultiplier: config.minProfitMultiplier || 1.5,
      targetProfitMultiplier: config.targetProfitMultiplier || 3.0
    }
  });
}

export default IntegratedOrderCalculator;