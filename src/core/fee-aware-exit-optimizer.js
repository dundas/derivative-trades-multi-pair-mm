/**
 * Fee-Aware Exit Optimizer for Multi-Pair Market Maker
 * 
 * Calculates optimal exit points considering:
 * - Current fee tier (maker/taker rates)
 * - Round-trip costs
 * - Break-even points
 * - Dynamic profit targets based on market conditions
 * - Volume building objectives
 */

import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'FeeAwareExitOptimizer' });

export class FeeAwareExitOptimizer {
  constructor(config = {}) {
    this.config = {
      // Fee defaults (will be updated with actual rates)
      defaultMakerFee: 0.0026,  // 0.26% Kraken default
      defaultTakerFee: 0.0040,  // 0.40% Kraken default
      
      // Profit targets
      minProfitMultiplier: 1.5,  // Min profit = 1.5x round-trip fees
      targetProfitMultiplier: 3.0, // Target profit = 3x round-trip fees
      maxProfitMultiplier: 5.0,   // Max profit = 5x round-trip fees
      
      // Volume building mode
      volumeBuildingMode: false,
      volumeBuildingMinProfit: 0.0001, // 0.01% min profit in volume mode
      
      // Market condition adjustments
      volatilityScaling: true,
      momentumScaling: true,
      liquidityScaling: true,
      
      ...config
    };
    
    this.currentFees = {
      maker: this.config.defaultMakerFee,
      taker: this.config.defaultTakerFee,
      tierName: 'Default',
      volume30d: 0
    };
  }
  
  /**
   * Update current fee rates from exchange
   * @param {Object} feeInfo Fee information from exchange
   */
  updateFeeRates(feeInfo) {
    this.currentFees = {
      maker: feeInfo.makerFee || feeInfo.maker || this.config.defaultMakerFee,
      taker: feeInfo.takerFee || feeInfo.taker || this.config.defaultTakerFee,
      tierName: feeInfo.tierName || 'Unknown',
      volume30d: feeInfo.volume30d || 0,
      nextTier: feeInfo.nextTier || null
    };
    
    logger.info('Updated fee rates:', {
      maker: `${(this.currentFees.maker * 100).toFixed(3)}%`,
      taker: `${(this.currentFees.taker * 100).toFixed(3)}%`,
      tier: this.currentFees.tierName,
      volume30d: this.currentFees.volume30d
    });
  }
  
  /**
   * Calculate round-trip cost including fees and spread
   * @param {Object} marketData Current market data
   * @param {boolean} useMakerOnly Whether to assume maker-only execution
   * @returns {Object} Cost breakdown
   */
  calculateRoundTripCost(marketData, useMakerOnly = true) {
    // Fee costs
    const buyFee = useMakerOnly ? this.currentFees.maker : this.currentFees.taker;
    const sellFee = useMakerOnly ? this.currentFees.maker : this.currentFees.taker;
    const totalFeeCost = buyFee + sellFee;
    
    // Spread cost (if crossing spread)
    const spread = marketData.ask - marketData.bid;
    const spreadPercent = spread / marketData.bid;
    const spreadCost = useMakerOnly ? 0 : spreadPercent; // No spread cost for maker orders
    
    // Slippage estimate
    const slippage = this.estimateSlippage(marketData);
    
    // Total round-trip cost
    const totalCost = totalFeeCost + spreadCost + slippage;
    
    return {
      buyFee,
      sellFee,
      totalFeeCost,
      spreadCost,
      slippage,
      totalCost,
      breakEvenPrice: marketData.price * (1 + totalCost),
      costInBps: totalCost * 10000
    };
  }
  
  /**
   * Calculate optimal exit price based on fees and market conditions
   * @param {Object} entryDetails Entry price calculation details
   * @param {Object} marketData Current market data
   * @param {Object} decision Trading decision with signals
   * @param {Object} options Additional options
   * @returns {Object} Optimal exit details
   */
  calculateOptimalExit(entryDetails, marketData, decision, options = {}) {
    const entryPrice = entryDetails.price;
    
    // 1. Calculate round-trip costs
    const costs = this.calculateRoundTripCost(marketData, options.useMakerOnly !== false);
    
    // 2. Determine minimum profitable exit
    const minProfitableExit = this.calculateMinProfitableExit(entryPrice, costs, decision.direction);
    
    // 3. Calculate target exit based on market conditions
    const targetExit = this.calculateTargetExit(
      entryPrice, 
      costs, 
      decision, 
      marketData,
      options
    );
    
    // 4. Calculate maximum exit (stretch target)
    const maxExit = this.calculateMaxExit(
      entryPrice,
      costs,
      decision,
      marketData
    );
    
    // 5. Determine optimal exit strategy
    const optimalStrategy = this.determineExitStrategy(
      minProfitableExit,
      targetExit,
      maxExit,
      marketData,
      decision
    );
    
    return {
      entryPrice,
      costs,
      minProfitableExit,
      targetExit,
      maxExit,
      strategy: optimalStrategy,
      expectedProfit: this.calculateExpectedProfit(entryPrice, optimalStrategy, costs),
      recommendation: this.generateRecommendation(optimalStrategy, decision)
    };
  }
  
  /**
   * Calculate minimum profitable exit price
   */
  calculateMinProfitableExit(entryPrice, costs, direction) {
    // In volume building mode, accept minimal profit
    const minProfitTarget = this.config.volumeBuildingMode ? 
      this.config.volumeBuildingMinProfit : 
      costs.totalCost * this.config.minProfitMultiplier;
    
    const price = direction === 'buy' ?
      entryPrice * (1 + costs.totalCost + minProfitTarget) :
      entryPrice * (1 - costs.totalCost - minProfitTarget);
    
    return {
      price,
      profit: minProfitTarget,
      profitPercent: minProfitTarget * 100,
      profitAfterFees: minProfitTarget * entryPrice,
      multiplierOverFees: minProfitTarget / costs.totalCost
    };
  }
  
  /**
   * Calculate target exit based on market conditions
   */
  calculateTargetExit(entryPrice, costs, decision, marketData, options) {
    // Base target
    let targetMultiplier = this.config.targetProfitMultiplier;
    
    // Adjust for market conditions
    if (this.config.volatilityScaling && marketData.volatility) {
      const volAdjustment = Math.sqrt(marketData.volatility.relative || 1);
      targetMultiplier *= volAdjustment;
    }
    
    // Adjust for signal strength
    if (decision.confidence > 0.8) {
      targetMultiplier *= 1.2;
    } else if (decision.confidence < 0.6) {
      targetMultiplier *= 0.8;
    }
    
    // Adjust for futures signal
    if (decision.futuresSignal && decision.futuresSignal.magnitude > 0.001) {
      targetMultiplier *= (1 + decision.futuresSignal.magnitude * 10);
    }
    
    // Apply user preferences
    if (options.conservativeExit) {
      targetMultiplier *= 0.7;
    } else if (options.aggressiveExit) {
      targetMultiplier *= 1.3;
    }
    
    const targetProfit = costs.totalCost * targetMultiplier;
    
    const price = decision.direction === 'buy' ?
      entryPrice * (1 + costs.totalCost + targetProfit) :
      entryPrice * (1 - costs.totalCost - targetProfit);
    
    return {
      price,
      profit: targetProfit,
      profitPercent: targetProfit * 100,
      profitAfterFees: targetProfit * entryPrice,
      multiplierOverFees: targetMultiplier,
      adjustments: {
        volatility: marketData.volatility?.relative || 1,
        confidence: decision.confidence,
        futuresSignal: decision.futuresSignal?.magnitude || 0
      }
    };
  }
  
  /**
   * Calculate maximum exit (stretch target)
   */
  calculateMaxExit(entryPrice, costs, decision, marketData) {
    // Use historical data if available
    const historicalMax = marketData.patterns?.maxProfitTarget || 
                         costs.totalCost * this.config.maxProfitMultiplier;
    
    // Consider intraday range
    const intradayRange = marketData.high24h && marketData.low24h ?
      (marketData.high24h - marketData.low24h) / marketData.price : 0.02;
    
    const maxProfit = Math.max(historicalMax, intradayRange * 0.5);
    
    const price = decision.direction === 'buy' ?
      entryPrice * (1 + costs.totalCost + maxProfit) :
      entryPrice * (1 - costs.totalCost - maxProfit);
    
    return {
      price,
      profit: maxProfit,
      profitPercent: maxProfit * 100,
      profitAfterFees: maxProfit * entryPrice,
      multiplierOverFees: maxProfit / costs.totalCost,
      probability: this.estimateProbability(maxProfit, marketData)
    };
  }
  
  /**
   * Determine optimal exit strategy
   */
  determineExitStrategy(minExit, targetExit, maxExit, marketData, decision) {
    // Multi-tier exit strategy
    const strategy = {
      type: 'multi_tier',
      tiers: []
    };
    
    // Tier 1: Quick profit (25% of position)
    if (!this.config.volumeBuildingMode) {
      strategy.tiers.push({
        level: 1,
        price: minExit.price,
        sizePercent: 0.25,
        reason: 'Quick profit to reduce risk',
        expectedFillTime: '5-15 minutes'
      });
    }
    
    // Tier 2: Target profit (50% of position)
    strategy.tiers.push({
      level: 2,
      price: targetExit.price,
      sizePercent: this.config.volumeBuildingMode ? 1.0 : 0.5,
      reason: 'Primary profit target',
      expectedFillTime: '30-60 minutes'
    });
    
    // Tier 3: Stretch target (25% of position)
    if (!this.config.volumeBuildingMode && maxExit.probability > 0.2) {
      strategy.tiers.push({
        level: 3,
        price: maxExit.price,
        sizePercent: 0.25,
        reason: 'Capture extended moves',
        expectedFillTime: '2-4 hours'
      });
    }
    
    // Calculate weighted average exit
    let totalWeight = 0;
    let weightedPrice = 0;
    
    strategy.tiers.forEach(tier => {
      totalWeight += tier.sizePercent;
      weightedPrice += tier.price * tier.sizePercent;
    });
    
    strategy.averageExit = weightedPrice / totalWeight;
    strategy.effectiveProfit = (strategy.averageExit - marketData.price) / marketData.price;
    
    return strategy;
  }
  
  /**
   * Calculate expected profit from strategy
   */
  calculateExpectedProfit(entryPrice, strategy, costs) {
    const grossProfit = Math.abs(strategy.averageExit - entryPrice);
    const grossProfitPercent = grossProfit / entryPrice;
    const netProfit = grossProfitPercent - costs.totalCost;
    const netProfitValue = netProfit * entryPrice;
    
    return {
      gross: grossProfitPercent,
      net: netProfit,
      netValue: netProfitValue,
      roi: netProfit / costs.totalCost,
      breakEvenDistance: Math.abs(entryPrice * (1 + costs.totalCost) - entryPrice)
    };
  }
  
  /**
   * Generate exit recommendation
   */
  generateRecommendation(strategy, decision) {
    const tiers = strategy.tiers;
    const primaryTier = tiers.find(t => t.sizePercent >= 0.5) || tiers[0];
    
    return {
      primaryTarget: primaryTier.price,
      method: this.config.volumeBuildingMode ? 'volume_building' : 'profit_optimization',
      confidence: decision.confidence,
      timeHorizon: primaryTier.expectedFillTime,
      orderType: 'POST_ONLY', // Always use maker orders for better fees
      warning: strategy.effectiveProfit < 0.001 ? 
        'Low profit margin - consider waiting for better entry' : null
    };
  }
  
  /**
   * Estimate slippage based on market conditions
   */
  estimateSlippage(marketData) {
    const baseSlippage = 0.0001; // 0.01% base
    
    // Adjust for volume
    const volumeFactor = marketData.volume24h < 1000000 ? 2 : 1;
    
    // Adjust for volatility
    const volatilityFactor = marketData.volatility?.current > 0.02 ? 1.5 : 1;
    
    return baseSlippage * volumeFactor * volatilityFactor;
  }
  
  /**
   * Estimate probability of reaching price level
   */
  estimateProbability(profitTarget, marketData) {
    // Simple probability model based on volatility
    const dailyVolatility = marketData.volatility?.daily || 0.02;
    const targetMoves = profitTarget / dailyVolatility;
    
    // Use normal distribution approximation
    if (targetMoves < 0.5) return 0.7;
    if (targetMoves < 1.0) return 0.5;
    if (targetMoves < 1.5) return 0.3;
    if (targetMoves < 2.0) return 0.2;
    return 0.1;
  }
  
  /**
   * Get fee tier progression info
   */
  getFeeProgressionInfo() {
    if (!this.currentFees.nextTier) {
      return null;
    }
    
    const volumeNeeded = this.currentFees.nextTier.volumeThreshold - this.currentFees.volume30d;
    const currentRate = this.currentFees.maker;
    const nextRate = this.currentFees.nextTier.makerFee;
    const feeReduction = currentRate - nextRate;
    const reductionPercent = (feeReduction / currentRate) * 100;
    
    return {
      currentTier: this.currentFees.tierName,
      nextTier: this.currentFees.nextTier.name,
      volumeNeeded,
      volumeProgress: this.currentFees.volume30d / this.currentFees.nextTier.volumeThreshold,
      currentMakerFee: currentRate,
      nextMakerFee: nextRate,
      feeReduction,
      reductionPercent,
      estimatedSavingsPerTrade: feeReduction * 2 // Round-trip savings
    };
  }
}

export default FeeAwareExitOptimizer;