/**
 * Volume-Focused Exit Optimizer
 * 
 * Priority order:
 * 1. Profitability/Breakeven (must cover fees)
 * 2. Volume building (maximize trades)
 * 3. Speed (prefer faster exits when profit is equal)
 * 
 * Time horizon: Up to 4 hours
 */

import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'VolumeFocusedExitOptimizer' });

export class VolumeFocusedExitOptimizer {
  constructor(config = {}) {
    this.config = {
      // Time constraints
      maxHoldTime: 4 * 60, // 4 hours in minutes
      preferredExitTime: 30, // Prefer exits within 30 minutes
      
      // Profitability thresholds
      minAcceptableProfit: 0, // Breakeven after fees is acceptable
      targetProfit: 0.001, // 0.1% target (very modest)
      
      // Volume building settings
      volumeBuildingMode: true,
      acceptBreakeven: true,
      
      // Speed preference
      speedWeight: 0.3, // 30% weight to speed in scoring
      
      // Exit strategy
      singleExitPreferred: true, // Single exit for faster turnover
      
      ...config
    };
    
    this.feeRates = {
      maker: 0.0026,
      taker: 0.0040
    };
  }
  
  /**
   * Update current fee rates
   */
  updateFeeRates(feeInfo) {
    this.feeRates = {
      maker: feeInfo.makerFee || feeInfo.maker || 0.0026,
      taker: feeInfo.takerFee || feeInfo.taker || 0.0040
    };
    
    logger.info('Updated fee rates for volume optimization:', {
      maker: `${(this.feeRates.maker * 100).toFixed(3)}%`,
      taker: `${(this.feeRates.taker * 100).toFixed(3)}%`,
      roundTrip: `${(this.feeRates.maker * 2 * 100).toFixed(3)}%`
    });
  }
  
  /**
   * Find optimal exits prioritizing volume and speed
   * @param {Object} entryDetails Entry price information
   * @param {Object} marketData Current market conditions
   * @param {Object} historicalData Historical price movements
   * @param {Object} decision Trading decision context
   * @returns {Object} Optimized exit strategy
   */
  findVolumeOptimalExits(entryDetails, marketData, historicalData, decision) {
    const entryPrice = entryDetails.price;
    const direction = decision.direction;
    
    // Calculate absolute minimum (breakeven)
    const roundTripFee = this.feeRates.maker * 2;
    const breakeven = roundTripFee;
    
    logger.info(`Volume-focused exit optimization for ${decision.pair}:`, {
      entryPrice,
      breakeven: `${(breakeven * 100).toFixed(3)}%`,
      maxHoldTime: `${this.config.maxHoldTime} minutes`
    });
    
    // 1. Analyze historical exits with time consideration
    const timedExits = this.analyzeTimedExits(
      historicalData,
      breakeven,
      this.config.maxHoldTime
    );
    
    // 2. Find fastest profitable exits
    const speedOptimalExits = this.findSpeedOptimalExits(
      timedExits,
      breakeven
    );
    
    // 3. Determine resistance levels that might slow exits
    const resistanceLevels = this.identifyNearResistance(
      marketData,
      entryPrice,
      direction,
      breakeven
    );
    
    // 4. Generate volume-optimized strategy
    const strategy = this.generateVolumeStrategy(
      entryPrice,
      direction,
      speedOptimalExits,
      resistanceLevels,
      decision
    );
    
    return strategy;
  }
  
  /**
   * Analyze historical exits with time weighting
   */
  analyzeTimedExits(historicalData, minProfit, maxMinutes) {
    if (!historicalData || !historicalData.movements) {
      return this.getDefaultTimedExits(minProfit);
    }
    
    const timedExits = [];
    
    // Group exits by time buckets
    const timeBuckets = [
      { name: 'immediate', maxTime: 5, weight: 1.0 },
      { name: 'quick', maxTime: 15, weight: 0.9 },
      { name: 'standard', maxTime: 30, weight: 0.8 },
      { name: 'extended', maxTime: 60, weight: 0.6 },
      { name: 'patient', maxTime: 120, weight: 0.4 },
      { name: 'maximum', maxTime: 240, weight: 0.2 }
    ];
    
    for (const bucket of timeBuckets) {
      const bucketMovements = historicalData.movements.filter(m => 
        m.timeToTarget <= bucket.maxTime &&
        m.maxMove >= minProfit
      );
      
      if (bucketMovements.length > 0) {
        // Calculate percentiles for this time bucket
        const moves = bucketMovements.map(m => m.maxMove).sort((a, b) => a - b);
        
        timedExits.push({
          timeBucket: bucket.name,
          maxTime: bucket.maxTime,
          timeWeight: bucket.weight,
          count: bucketMovements.length,
          probability: bucketMovements.length / historicalData.movements.length,
          percentiles: {
            p25: this.getPercentile(moves, 25),
            p50: this.getPercentile(moves, 50),
            p75: this.getPercentile(moves, 75),
            p90: this.getPercentile(moves, 90)
          },
          avgMove: moves.reduce((a, b) => a + b, 0) / moves.length,
          minProfitableMove: Math.max(minProfit, moves[0])
        });
      }
    }
    
    return timedExits;
  }
  
  /**
   * Find exits that optimize for speed while maintaining profitability
   */
  findSpeedOptimalExits(timedExits, breakeven) {
    const speedOptimal = [];
    
    // Score each exit by profit/time ratio
    for (const exit of timedExits) {
      // Use conservative percentile (p25) for higher fill probability
      const conservativeProfit = exit.percentiles.p25;
      
      // Skip if not profitable
      if (conservativeProfit < breakeven) continue;
      
      // Calculate profit per minute (efficiency score)
      const profitPerMinute = conservativeProfit / exit.maxTime;
      
      // Combined score: profit efficiency + time weight
      const score = profitPerMinute * exit.timeWeight * exit.probability;
      
      speedOptimal.push({
        bucket: exit.timeBucket,
        targetProfit: conservativeProfit,
        expectedTime: exit.maxTime / 2, // Use midpoint of bucket
        probability: exit.probability,
        fillProbability: 0.75, // Using p25 gives us 75% fill probability
        score,
        profitPerMinute,
        netProfit: conservativeProfit - breakeven
      });
    }
    
    // Sort by score (best first)
    speedOptimal.sort((a, b) => b.score - a.score);
    
    // If no profitable exits found, create minimal profit targets
    if (speedOptimal.length === 0) {
      speedOptimal.push({
        bucket: 'minimum',
        targetProfit: breakeven * 1.1, // 10% above breakeven
        expectedTime: 60,
        probability: 0.5,
        fillProbability: 0.6,
        score: 0.1,
        profitPerMinute: breakeven * 0.1 / 60,
        netProfit: breakeven * 0.1
      });
    }
    
    return speedOptimal;
  }
  
  /**
   * Identify nearby resistance that could slow exits
   */
  identifyNearResistance(marketData, entryPrice, direction, minProfit) {
    const resistanceLevels = [];
    
    // Calculate minimum exit price
    const minExitPrice = direction === 'buy' ?
      entryPrice * (1 + minProfit) :
      entryPrice * (1 - minProfit);
    
    // Check order book for walls
    if (marketData.orderbook) {
      const book = direction === 'buy' ? 
        marketData.orderbook.asks : 
        marketData.orderbook.bids;
      
      const avgSize = book.reduce((sum, [_, size]) => sum + size, 0) / book.length;
      
      for (const [price, size] of book) {
        const priceNum = parseFloat(price);
        const distance = direction === 'buy' ?
          (priceNum - entryPrice) / entryPrice :
          (entryPrice - priceNum) / entryPrice;
        
        // Only consider levels beyond minimum profit
        if (distance >= minProfit && distance <= 0.02) { // Within 2%
          if (size > avgSize * 1.5) { // Significant wall
            resistanceLevels.push({
              price: priceNum,
              size,
              distance,
              strength: size / avgSize,
              impact: 'May slow exit at this level'
            });
          }
        }
      }
    }
    
    // Add psychological levels
    const psychLevels = this.getPsychologicalLevels(entryPrice, direction, minProfit);
    resistanceLevels.push(...psychLevels);
    
    return resistanceLevels.sort((a, b) => a.distance - b.distance);
  }
  
  /**
   * Generate volume-optimized trading strategy
   */
  generateVolumeStrategy(entryPrice, direction, speedOptimalExits, resistanceLevels, decision) {
    // Select primary exit based on best speed/profit score
    const primaryExit = speedOptimalExits[0];
    
    // Check if primary exit aligns with resistance
    const nearestResistance = resistanceLevels[0];
    let adjustedTarget = primaryExit.targetProfit;
    
    if (nearestResistance && nearestResistance.distance < primaryExit.targetProfit * 1.1) {
      // Place exit just before resistance for better fill
      adjustedTarget = nearestResistance.distance * 0.95;
      logger.info('Adjusted exit to avoid resistance:', {
        original: `${(primaryExit.targetProfit * 100).toFixed(3)}%`,
        adjusted: `${(adjustedTarget * 100).toFixed(3)}%`,
        resistance: `${(nearestResistance.distance * 100).toFixed(3)}%`
      });
    }
    
    // Calculate exit price
    const exitPrice = direction === 'buy' ?
      entryPrice * (1 + adjustedTarget) :
      entryPrice * (1 - adjustedTarget);
    
    // Single exit strategy for maximum turnover
    const strategy = {
      type: 'volume_optimized_single_exit',
      target: adjustedTarget,
      exitPrice,
      expectedTime: primaryExit.expectedTime,
      probability: primaryExit.probability * primaryExit.fillProbability,
      
      // Key metrics
      metrics: {
        netProfit: adjustedTarget - (this.feeRates.maker * 2),
        netProfitPercent: (adjustedTarget - (this.feeRates.maker * 2)) * 100,
        turnoversPerHour: 60 / primaryExit.expectedTime,
        volumePerHour: (60 / primaryExit.expectedTime) * decision.size * entryPrice,
        profitPerMinute: primaryExit.profitPerMinute,
        breakeven: this.feeRates.maker * 2
      },
      
      // Analysis
      analysis: {
        bucket: primaryExit.bucket,
        resistanceConsideration: nearestResistance ? 'Adjusted for resistance' : 'Clear path',
        speedScore: primaryExit.score,
        recommendation: this.getRecommendation(primaryExit, adjustedTarget)
      },
      
      // Alternative exits if needed
      alternatives: speedOptimalExits.slice(1, 3).map(exit => ({
        target: exit.targetProfit,
        expectedTime: exit.expectedTime,
        score: exit.score
      })),
      
      // Order parameters
      orderParams: {
        price: Number(exitPrice.toFixed(4)),
        size: decision.size,
        type: 'LIMIT',
        postOnly: true,
        ttl: Math.max(primaryExit.expectedTime * 2, 120) * 60, // TTL in seconds
        reduceOnly: true
      }
    };
    
    return strategy;
  }
  
  /**
   * Get recommendation based on exit quality
   */
  getRecommendation(exit, adjustedTarget) {
    const netProfit = adjustedTarget - (this.feeRates.maker * 2);
    
    if (exit.bucket === 'immediate' && netProfit > 0) {
      return {
        action: 'execute_immediate',
        confidence: 'high',
        reason: 'Quick profitable exit available'
      };
    } else if (exit.bucket === 'quick' && netProfit > 0) {
      return {
        action: 'execute_standard',
        confidence: 'high',
        reason: 'Fast exit with good profit'
      };
    } else if (netProfit > 0.0005) {
      return {
        action: 'execute_patient',
        confidence: 'medium',
        reason: 'Profitable but requires patience'
      };
    } else if (netProfit > 0) {
      return {
        action: 'execute_volume',
        confidence: 'medium',
        reason: 'Breakeven trade for volume building'
      };
    } else {
      return {
        action: 'skip',
        confidence: 'low',
        reason: 'No profitable exit within timeframe'
      };
    }
  }
  
  /**
   * Get psychological price levels
   */
  getPsychologicalLevels(price, direction, minDistance) {
    const levels = [];
    
    // Determine round increment based on price
    let increment;
    if (price > 10000) increment = 100;
    else if (price > 1000) increment = 10;
    else if (price > 100) increment = 1;
    else if (price > 10) increment = 0.1;
    else increment = 0.01;
    
    // Find next round level
    const nextRound = direction === 'buy' ?
      Math.ceil(price / increment) * increment :
      Math.floor(price / increment) * increment;
    
    const distance = Math.abs(nextRound - price) / price;
    
    if (distance >= minDistance) {
      levels.push({
        price: nextRound,
        distance,
        strength: 1,
        type: 'psychological',
        impact: 'Natural resistance point'
      });
    }
    
    return levels;
  }
  
  /**
   * Get default timed exits when no historical data
   */
  getDefaultTimedExits(minProfit) {
    return [
      {
        timeBucket: 'quick',
        maxTime: 15,
        timeWeight: 0.9,
        percentiles: {
          p25: minProfit * 1.2,
          p50: minProfit * 1.5,
          p75: minProfit * 2,
          p90: minProfit * 3
        },
        probability: 0.6
      },
      {
        timeBucket: 'standard',
        maxTime: 30,
        timeWeight: 0.8,
        percentiles: {
          p25: minProfit * 1.5,
          p50: minProfit * 2,
          p75: minProfit * 3,
          p90: minProfit * 4
        },
        probability: 0.4
      }
    ];
  }
  
  getPercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }
  
  /**
   * Calculate volume metrics for reporting
   */
  calculateVolumeMetrics(strategy, sessionLength = 240) {
    const tradesPerSession = sessionLength / strategy.expectedTime;
    const volumePerSession = tradesPerSession * strategy.orderParams.size * strategy.orderParams.price;
    
    return {
      expectedTrades: Math.floor(tradesPerSession),
      expectedVolume: volumePerSession,
      effectiveFeesReduced: volumePerSession * (this.feeRates.maker - this.getNextTierRate()),
      timeUtilization: Math.min(1, (tradesPerSession * strategy.expectedTime) / sessionLength)
    };
  }
  
  getNextTierRate() {
    // Kraken fee tiers (simplified)
    if (this.feeRates.maker <= 0.0010) return 0.0008;
    if (this.feeRates.maker <= 0.0012) return 0.0010;
    if (this.feeRates.maker <= 0.0014) return 0.0012;
    if (this.feeRates.maker <= 0.0016) return 0.0014;
    if (this.feeRates.maker <= 0.0020) return 0.0016;
    if (this.feeRates.maker <= 0.0025) return 0.0020;
    return 0.0024;
  }
}

export default VolumeFocusedExitOptimizer;