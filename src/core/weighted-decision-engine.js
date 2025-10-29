#!/usr/bin/env node
/**
 * Weighted Decision Engine for Multi-Pair Market Maker
 * 
 * Implements continuous weighting functions for micro-timing adjustments
 * without arbitrary thresholds. All signals contribute proportionally.
 */

import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'WeightedDecisionEngine' });

class WeightedDecisionEngine {
  constructor(config = {}) {
    this.config = {
      // Confidence weighting parameters
      confidence: {
        maxAdjustment: 0.15,        // ±15% max confidence change
        normalizationFactor: 0.01,  // 1% micro-bias = full strength
        microWeight: 0.2            // 20% weight for micro-timing in overall confidence
      },
      
      // Price adjustment parameters
      price: {
        maxAdjustment: 0.0005,      // 0.05% max price change
        sigmoidSteepness: 500,      // How quickly price adjustment scales
        adverseRatio: 0.5,          // Penalty for adverse price adjustments
        microWeight: 0.1            // 10% weight for micro-timing in price
      },
      
      // Timing urgency parameters
      timing: {
        volatilityImpact: 1.0,      // How much volatility affects timing
        maxUrgencyChange: 0.5,      // ±0.5 from base 0.5
        baseUrgency: 0.5            // Neutral starting point
      },
      
      // Position sizing parameters
      position: {
        minConfidence: 0.65,        // Minimum to trade
        baseMultiplier: 1.0,        // Standard position size
        maxMultiplier: 1.5,         // Maximum position size
        scalingPower: 2.0           // How aggressively to scale
      },
      
      ...config
    };
  }
  
  /**
   * Apply weighted micro-timing adjustments to a trading decision
   */
  applyWeightedAdjustments(basePlan, microTimingData) {
    const { intraHourBias, temporalBias, futuresSignal } = microTimingData;
    
    // Calculate all weighted components
    const confidenceAdjustment = this.calculateWeightedConfidence(
      basePlan, intraHourBias, temporalBias, futuresSignal
    );
    
    const priceAdjustment = this.calculateWeightedPrice(
      basePlan, intraHourBias, temporalBias
    );
    
    const timingUrgency = this.calculateWeightedTiming(
      basePlan, intraHourBias, temporalBias
    );
    
    const positionMultiplier = this.calculateWeightedPosition(
      basePlan.confidence + confidenceAdjustment
    );
    
    // Build enhanced decision
    const enhancedDecision = {
      // Core decision
      pair: basePlan.pair,
      direction: basePlan.direction,
      
      // Adjusted values
      confidence: Math.max(0, Math.min(1, basePlan.confidence + confidenceAdjustment)),
      entryPrice: basePlan.basePrice * (1 + priceAdjustment),
      
      // Execution parameters
      timingUrgency,
      executionDelay: this.urgencyToDelay(timingUrgency),
      orderType: this.confidenceToOrderType(basePlan.confidence + confidenceAdjustment, timingUrgency),
      
      // Position sizing
      baseSize: basePlan.size,
      adjustedSize: basePlan.size * positionMultiplier,
      
      // Transparency
      adjustments: {
        confidence: {
          base: basePlan.confidence,
          adjustment: confidenceAdjustment,
          final: basePlan.confidence + confidenceAdjustment
        },
        price: {
          base: basePlan.basePrice,
          adjustment: priceAdjustment,
          final: basePlan.basePrice * (1 + priceAdjustment)
        },
        timing: {
          urgency: timingUrgency,
          delayMs: this.urgencyToDelay(timingUrgency)
        },
        position: {
          multiplier: positionMultiplier,
          reason: this.explainPositionSize(positionMultiplier)
        }
      },
      
      // Decision reasoning
      reasoning: this.generateWeightedReasoning(
        basePlan, intraHourBias, temporalBias, 
        confidenceAdjustment, priceAdjustment, timingUrgency
      )
    };
    
    return enhancedDecision;
  }
  
  /**
   * Calculate weighted confidence adjustment
   */
  calculateWeightedConfidence(basePlan, intraHourBias, temporalBias, futuresSignal) {
    // 1. Micro-timing component
    const microBias = intraHourBias.combinedIntraHourBias || 0;
    const microConfidence = intraHourBias.confidence || 0.5;
    const microStrength = Math.min(Math.abs(microBias) / this.config.confidence.normalizationFactor, 1.0);
    const microAlignment = this.getAlignmentFactor(microBias, basePlan.direction);
    const microComponent = microStrength * microAlignment * microConfidence * this.config.confidence.maxAdjustment;
    
    // 2. Temporal bias component (hourly/daily)
    const temporalStrength = Math.min(Math.abs(temporalBias.combinedBias) / 0.02, 1.0); // 2% normalized
    const temporalAlignment = this.getAlignmentFactor(temporalBias.combinedBias, basePlan.direction);
    const temporalConfidence = temporalBias.confidence || 0.5;
    const temporalComponent = temporalStrength * temporalAlignment * temporalConfidence * this.config.confidence.maxAdjustment * 0.5;
    
    // 3. Futures signal strength component
    const futuresStrength = futuresSignal.confidence || 0.7;
    const futuresComponent = (futuresStrength - 0.7) * 0.3; // Convert to adjustment
    
    // Weight and combine all components
    const weights = {
      micro: this.config.confidence.microWeight,
      temporal: 0.3,
      futures: 0.5
    };
    
    const totalWeight = weights.micro + weights.temporal + weights.futures;
    
    const weightedAdjustment = (
      (microComponent * weights.micro) +
      (temporalComponent * weights.temporal) +
      (futuresComponent * weights.futures)
    ) / totalWeight;
    
    return weightedAdjustment;
  }
  
  /**
   * Calculate weighted price adjustment
   */
  calculateWeightedPrice(basePlan, intraHourBias, temporalBias) {
    const microBias = intraHourBias.combinedIntraHourBias || 0;
    const signalStrength = Math.abs(microBias);
    
    // Sigmoid function for smooth scaling
    const k = this.config.price.sigmoidSteepness;
    const sigmoid = 1 / (1 + Math.exp(-k * (signalStrength - 0.002)));
    
    // Direction-aware adjustment
    let priceAdjustment = 0;
    
    if (basePlan.direction === 'down' || basePlan.direction === 'buy') {
      // Buying scenario
      if (microBias > 0) {
        // Price going up short-term - wait for better price
        priceAdjustment = sigmoid * this.config.price.maxAdjustment;
      } else {
        // Price going down - may accept slightly worse price for immediate execution
        priceAdjustment = -sigmoid * this.config.price.maxAdjustment * this.config.price.adverseRatio;
      }
    } else {
      // Selling scenario - inverse logic
      if (microBias < 0) {
        priceAdjustment = sigmoid * this.config.price.maxAdjustment;
      } else {
        priceAdjustment = -sigmoid * this.config.price.maxAdjustment * this.config.price.adverseRatio;
      }
    }
    
    // Weight micro-timing against broader temporal patterns
    const temporalPriceImpact = Math.sign(temporalBias.combinedBias) === Math.sign(microBias) ? 1.2 : 0.8;
    
    return priceAdjustment * temporalPriceImpact * this.config.price.microWeight;
  }
  
  /**
   * Calculate weighted timing urgency (0 = wait, 1 = execute now)
   */
  calculateWeightedTiming(basePlan, intraHourBias, temporalBias) {
    const microBias = intraHourBias.combinedIntraHourBias || 0;
    const signalStrength = Math.abs(microBias);
    const alignment = this.getAlignmentFactor(microBias, basePlan.direction);
    
    // Volatility factor
    const volatilityContext = intraHourBias.volatilityContext || { relativeVolatility: 1.0 };
    const volatilityWeight = 1 / (1 + volatilityContext.relativeVolatility * this.config.timing.volatilityImpact);
    
    // Base urgency
    let urgency = this.config.timing.baseUrgency;
    
    // Adjust based on alignment and strength
    const urgencyAdjustment = signalStrength * 100 * volatilityWeight * alignment * this.config.timing.maxUrgencyChange;
    urgency += urgencyAdjustment;
    
    // Consider temporal alignment
    const temporalAlignment = this.getAlignmentFactor(temporalBias.combinedBias, basePlan.direction);
    const temporalUrgency = temporalAlignment > 0 ? 0.1 : -0.1;
    urgency += temporalUrgency;
    
    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, urgency));
  }
  
  /**
   * Calculate position size multiplier based on confidence
   */
  calculateWeightedPosition(finalConfidence) {
    if (finalConfidence < this.config.position.minConfidence) {
      return 0; // Don't trade
    }
    
    // Exponential scaling for position size
    const confidenceRange = finalConfidence - this.config.position.minConfidence;
    const maxRange = 1.0 - this.config.position.minConfidence;
    const normalized = confidenceRange / maxRange;
    
    // Apply scaling power for non-linear growth
    const scaled = Math.pow(normalized, this.config.position.scalingPower);
    
    const multiplier = this.config.position.baseMultiplier + 
      (scaled * (this.config.position.maxMultiplier - this.config.position.baseMultiplier));
    
    return Math.min(multiplier, this.config.position.maxMultiplier);
  }
  
  /**
   * Helper: Get alignment factor between signal and intended direction
   */
  getAlignmentFactor(bias, direction) {
    if (direction === 'down' || direction === 'buy') {
      // Buying - negative bias is aligned (price going down)
      return bias < 0 ? 1.0 : -1.0;
    } else {
      // Selling - positive bias is aligned (price going up)
      return bias > 0 ? 1.0 : -1.0;
    }
  }
  
  /**
   * Convert urgency to execution delay in milliseconds
   */
  urgencyToDelay(urgency) {
    const maxDelay = 120000; // 2 minutes max
    const minDelay = 0;      // Execute immediately
    
    // Exponential decay for more immediate execution at high urgency
    const delay = maxDelay * Math.pow(1 - urgency, 2);
    
    return Math.round(Math.max(minDelay, Math.min(maxDelay, delay)));
  }
  
  /**
   * Determine order type based on confidence and urgency
   */
  confidenceToOrderType(confidence, urgency) {
    if (confidence > 0.85 && urgency > 0.8) {
      return 'AGGRESSIVE_LIMIT'; // Cross spread up to 0.05%
    } else if (confidence > 0.75 && urgency > 0.6) {
      return 'STANDARD_LIMIT';   // Standard limit at best bid/ask
    } else if (confidence > 0.70) {
      return 'PASSIVE_LIMIT';    // Join the book, don't cross
    } else {
      return 'POST_ONLY';        // Maker only, cancel if would take
    }
  }
  
  /**
   * Explain position size decision
   */
  explainPositionSize(multiplier) {
    if (multiplier === 0) return 'No trade - confidence too low';
    if (multiplier < 0.7) return 'Reduced size - low confidence';
    if (multiplier < 1.0) return 'Conservative size - moderate confidence';
    if (multiplier === 1.0) return 'Standard size - good confidence';
    if (multiplier < 1.3) return 'Increased size - high confidence';
    return 'Maximum size - very high confidence';
  }
  
  /**
   * Generate human-readable reasoning for the weighted decision
   */
  generateWeightedReasoning(basePlan, intraHourBias, temporalBias, confAdj, priceAdj, urgency) {
    const parts = [];
    
    // Confidence reasoning
    if (Math.abs(confAdj) > 0.01) {
      parts.push(`Confidence ${confAdj > 0 ? 'boosted' : 'reduced'} ${(Math.abs(confAdj) * 100).toFixed(1)}% by micro-timing`);
    }
    
    // Price reasoning
    if (Math.abs(priceAdj) > 0.0001) {
      parts.push(`Price adjusted ${(priceAdj * 100).toFixed(3)}% for ${priceAdj > 0 ? 'better entry' : 'immediate execution'}`);
    }
    
    // Timing reasoning
    if (urgency > 0.7) {
      parts.push('High urgency - execute quickly');
    } else if (urgency < 0.3) {
      parts.push('Low urgency - wait for better timing');
    }
    
    // Micro-timing context
    const microMinute = new Date().getMinutes();
    const microQuarter = Math.floor(microMinute / 15) + 1;
    parts.push(`Minute ${microMinute} (Q${microQuarter}): ${(intraHourBias.combinedIntraHourBias * 100).toFixed(3)}% bias`);
    
    return parts.join(' | ');
  }
}

export { WeightedDecisionEngine };