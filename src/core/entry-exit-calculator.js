/**
 * Entry/Exit Price Calculator for Multi-Pair Market Maker
 * 
 * Calculates optimal entry and take-profit prices using:
 * - Futures premium/discount signals
 * - Temporal pattern biases
 * - Intra-hour micro-timing
 * - Volatility-adjusted targets
 */

export class EntryExitCalculator {
  constructor(config = {}) {
    this.config = {
      // Base offsets (can be from historical analysis)
      baseEntryOffset: 0.002,      // 0.2% default
      baseProfitTarget: 0.008,     // 0.8% default
      
      // Adjustment ranges
      maxEntryAdjustment: 0.003,   // Max 0.3% additional offset
      maxProfitAdjustment: 0.005,  // Max 0.5% additional profit
      
      // Volatility scaling
      volatilityMultiplier: 1.5,   // Scale targets by volatility
      
      ...config
    };
  }
  
  /**
   * Calculate optimal entry price
   * @param {Object} marketData Current market data
   * @param {Object} decision Weighted decision from engine
   * @param {Object} patterns Optional historical patterns
   * @returns {Object} Entry price details
   */
  calculateEntryPrice(marketData, decision, patterns = null) {
    const currentPrice = marketData.price;
    
    // 1. Start with base offset (from historical analysis or default)
    let entryOffset = patterns?.buyOffset || this.config.baseEntryOffset;
    
    // 2. Apply futures signal adjustment
    // Stronger futures signal = more aggressive entry
    if (decision.futuresSignal) {
      const futuresAdjustment = decision.futuresSignal.magnitude * 
                               decision.futuresSignal.confidence * 
                               this.config.maxEntryAdjustment;
      entryOffset += futuresAdjustment;
    }
    
    // 3. Apply temporal bias adjustment
    // Positive bias = expect price to rise, be more aggressive
    if (decision.temporalBias) {
      const temporalAdjustment = decision.temporalBias.combinedBias * 
                                decision.temporalBias.confidence * 
                                this.config.maxEntryAdjustment * 0.5;
      entryOffset -= temporalAdjustment; // Reduce offset if expecting rise
    }
    
    // 4. Apply micro-timing adjustment from weighted engine
    // This is already calculated in the weighted decision
    if (decision.adjustments?.price?.adjustment) {
      entryOffset += Math.abs(decision.adjustments.price.adjustment);
    }
    
    // 5. Apply volatility scaling
    if (marketData.volatility?.relative) {
      entryOffset *= Math.sqrt(marketData.volatility.relative);
    }
    
    // Calculate final entry price
    const entryPrice = decision.direction === 'buy' ? 
      currentPrice * (1 - entryOffset) : 
      currentPrice * (1 + entryOffset);
    
    return {
      price: entryPrice,
      offset: entryOffset,
      currentPrice,
      priceImprovement: currentPrice - entryPrice,
      improvementPercent: entryOffset * 100,
      components: {
        base: patterns?.buyOffset || this.config.baseEntryOffset,
        futures: decision.futuresSignal?.magnitude || 0,
        temporal: decision.temporalBias?.combinedBias || 0,
        microTiming: decision.adjustments?.price?.adjustment || 0,
        volatility: marketData.volatility?.relative || 1
      }
    };
  }
  
  /**
   * Calculate optimal take-profit price
   * @param {Object} entryDetails Entry price calculation results
   * @param {Object} decision Weighted decision from engine
   * @param {Object} patterns Optional historical patterns
   * @returns {Object} Take-profit price details
   */
  calculateTakeProfitPrice(entryDetails, decision, patterns = null) {
    const entryPrice = entryDetails.price;
    
    // 1. Start with base profit target
    let profitTarget = patterns?.sellTarget || this.config.baseProfitTarget;
    
    // 2. Scale by confidence
    // Higher confidence = larger profit target
    profitTarget *= (0.5 + decision.confidence * 0.5);
    
    // 3. Adjust for expected value
    // Better expected value = can aim for higher profits
    if (decision.expectedValue > 0.01) {
      profitTarget *= 1.2;
    } else if (decision.expectedValue < 0.005) {
      profitTarget *= 0.8;
    }
    
    // 4. Apply temporal horizon adjustment
    // If temporal patterns suggest extended favorable period
    if (decision.temporalBias && decision.direction === 'buy') {
      if (decision.temporalBias.combinedBias > 0) {
        profitTarget *= (1 + decision.temporalBias.combinedBias * 10);
      }
    }
    
    // 5. Volatility adjustment
    if (entryDetails.components.volatility > 1) {
      profitTarget *= Math.sqrt(entryDetails.components.volatility);
    }
    
    // Calculate take-profit price
    const takeProfitPrice = decision.direction === 'buy' ?
      entryPrice * (1 + profitTarget) :
      entryPrice * (1 - profitTarget);
    
    return {
      price: takeProfitPrice,
      target: profitTarget,
      entryPrice,
      expectedProfit: Math.abs(takeProfitPrice - entryPrice),
      expectedProfitPercent: profitTarget * 100,
      riskRewardRatio: this.calculateRiskReward(entryDetails, profitTarget, patterns),
      components: {
        base: patterns?.sellTarget || this.config.baseProfitTarget,
        confidence: decision.confidence,
        expectedValue: decision.expectedValue,
        temporal: decision.temporalBias?.combinedBias || 0,
        volatility: entryDetails.components.volatility
      }
    };
  }
  
  /**
   * Calculate stop-loss price
   * @param {Object} entryDetails Entry price calculation results
   * @param {Object} patterns Optional historical patterns
   * @returns {Object} Stop-loss price details
   */
  calculateStopLossPrice(entryDetails, patterns = null) {
    const entryPrice = entryDetails.price;
    
    // Use historical stop loss or default
    const stopLossPercent = patterns?.optimalStopLoss || 0.02; // 2% default
    
    // Scale by volatility
    const adjustedStopLoss = stopLossPercent * 
      Math.sqrt(entryDetails.components.volatility || 1);
    
    const stopLossPrice = entryDetails.offset > 0 ? // Buy order
      entryPrice * (1 - adjustedStopLoss) :
      entryPrice * (1 + adjustedStopLoss);
    
    return {
      price: stopLossPrice,
      percent: adjustedStopLoss,
      distance: Math.abs(entryPrice - stopLossPrice),
      distancePercent: adjustedStopLoss * 100
    };
  }
  
  /**
   * Calculate risk/reward ratio
   */
  calculateRiskReward(entryDetails, profitTarget, patterns) {
    const stopLoss = patterns?.optimalStopLoss || 0.02;
    const adjustedStopLoss = stopLoss * 
      Math.sqrt(entryDetails.components.volatility || 1);
    
    return profitTarget / adjustedStopLoss;
  }
  
  /**
   * Get complete order parameters
   * @param {Object} marketData Current market data
   * @param {Object} decision Weighted decision
   * @param {Object} patterns Historical patterns
   * @returns {Object} Complete order parameters
   */
  getOrderParameters(marketData, decision, patterns = null) {
    // Skip if confidence too low
    if (decision.confidence < 0.65) {
      return null;
    }
    
    // Calculate all prices
    const entry = this.calculateEntryPrice(marketData, decision, patterns);
    const takeProfit = this.calculateTakeProfitPrice(entry, decision, patterns);
    const stopLoss = this.calculateStopLossPrice(entry, patterns);
    
    // Calculate TTL based on timing urgency
    const buyTTL = decision.timingUrgency > 0.7 ? 
      60 : // 1 minute for urgent
      Math.round(300 - (decision.timingUrgency * 240)); // 1-5 minutes based on urgency
    
    const sellTTL = patterns?.suggestedSellTTL || buyTTL * 2;
    
    return {
      pair: decision.pair,
      direction: decision.direction,
      
      // Entry order
      entry: {
        price: entry.price,
        size: decision.adjustedSize,
        ttl: buyTTL,
        offset: entry.offset,
        improvement: entry.improvementPercent
      },
      
      // Take-profit order
      takeProfit: {
        price: takeProfit.price,
        target: takeProfit.target,
        ttl: sellTTL,
        expectedProfit: takeProfit.expectedProfitPercent,
        riskReward: takeProfit.riskRewardRatio
      },
      
      // Stop-loss order
      stopLoss: {
        price: stopLoss.price,
        percent: stopLoss.percent,
        distance: stopLoss.distancePercent
      },
      
      // Metadata
      confidence: decision.confidence,
      expectedValue: decision.expectedValue,
      reasoning: decision.reasoning,
      timestamp: Date.now()
    };
  }
}

export default EntryExitCalculator;