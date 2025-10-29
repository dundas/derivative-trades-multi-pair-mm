/**
 * Optimal Exit Finder for Multi-Pair Market Maker
 * 
 * Combines multiple methods to find the best exit points:
 * 1. Historical price movement analysis (like 3D optimization)
 * 2. Real-time market microstructure
 * 3. Fee-aware profit optimization
 * 4. Dynamic resistance level detection
 */

import { LoggerFactory } from '../../utils/logger-factory.js';
import { KrakenRESTClient } from '../../lib/exchanges/KrakenRESTClient.js';

const logger = LoggerFactory.createLogger({ component: 'OptimalExitFinder' });

export class OptimalExitFinder {
  constructor(config = {}) {
    this.config = {
      // Historical analysis settings
      historicalLookback: 12 * 60, // 12 hours in minutes
      minDataPoints: 100,
      
      // Price movement percentiles
      conservativePercentile: 50,  // Median
      targetPercentile: 75,        // 75th percentile
      aggressivePercentile: 90,    // 90th percentile
      
      // Microstructure analysis
      orderBookLevels: 20,
      resistanceSensitivity: 0.001, // 0.1% price levels
      
      // Fee considerations
      minProfitMultiplier: 1.5,    // Min 1.5x fees
      targetProfitMultiplier: 3.0,  // Target 3x fees
      
      // Multi-tier strategy
      enableMultiTier: true,
      tierSplits: [0.25, 0.5, 0.25], // 25%, 50%, 25%
      
      ...config
    };
    
    this.krakenClient = null;
    this.historicalData = new Map();
    this.resistanceLevels = new Map();
  }
  
  async initialize() {
    this.krakenClient = new KrakenRESTClient({
      apiKey: process.env.KRAKEN_API_KEY,
      apiSecret: process.env.KRAKEN_API_SECRET
    });
  }
  
  /**
   * Find optimal exit points using all available data
   * @param {Object} entryDetails Entry price and context
   * @param {Object} marketData Current market data
   * @param {Object} decision Trading decision with signals
   * @param {Object} feeInfo Current fee information
   * @returns {Object} Optimal exit strategy
   */
  async findOptimalExits(entryDetails, marketData, decision, feeInfo) {
    const pair = decision.pair;
    const entryPrice = entryDetails.price;
    const direction = decision.direction;
    
    logger.info(`Finding optimal exits for ${pair} entry at ${entryPrice}`);
    
    // 1. Analyze historical price movements
    const historicalExits = await this.analyzeHistoricalExits(
      pair, 
      entryPrice, 
      direction,
      feeInfo
    );
    
    // 2. Detect resistance levels from order book and price action
    const resistanceLevels = await this.detectResistanceLevels(
      pair,
      marketData,
      direction
    );
    
    // 3. Calculate microstructure-based exits
    const microstructureExits = this.analyzeMicrostructure(
      marketData,
      entryPrice,
      direction
    );
    
    // 4. Apply multi-signal optimization
    const optimalExits = this.optimizeExitLevels(
      entryPrice,
      direction,
      {
        historical: historicalExits,
        resistance: resistanceLevels,
        microstructure: microstructureExits,
        signals: decision,
        fees: feeInfo
      }
    );
    
    // 5. Generate execution strategy
    const strategy = this.generateExitStrategy(optimalExits, feeInfo);
    
    return strategy;
  }
  
  /**
   * Analyze historical price movements to find optimal exit levels
   * Similar to the 3D optimization approach but more efficient
   */
  async analyzeHistoricalExits(pair, entryPrice, direction, feeInfo) {
    try {
      // Fetch historical data
      const ohlcData = await this.krakenClient.getOHLCData(pair, 1); // 1-minute
      const candles = this.parseOHLCData(ohlcData);
      
      // Analyze price movements after similar entry conditions
      const movements = this.analyzePostEntryMovements(
        candles, 
        entryPrice,
        direction
      );
      
      // Calculate percentile-based exits
      const roundTripFee = feeInfo.maker * 2;
      
      return {
        conservative: {
          target: movements.percentiles.p50,
          probability: 0.50,
          expectedTime: movements.timeToTarget.p50,
          profitable: movements.percentiles.p50 > roundTripFee
        },
        target: {
          target: movements.percentiles.p75,
          probability: 0.25,
          expectedTime: movements.timeToTarget.p75,
          profitable: movements.percentiles.p75 > roundTripFee
        },
        aggressive: {
          target: movements.percentiles.p90,
          probability: 0.10,
          expectedTime: movements.timeToTarget.p90,
          profitable: movements.percentiles.p90 > roundTripFee
        },
        optimal: {
          target: movements.optimal,
          winRate: movements.winRate,
          avgHoldTime: movements.avgHoldTime
        }
      };
      
    } catch (error) {
      logger.warn(`Failed to analyze historical exits: ${error.message}`);
      
      // Fallback to fee-based targets
      const roundTripFee = feeInfo.maker * 2;
      return {
        conservative: { target: roundTripFee * 1.5, probability: 0.7 },
        target: { target: roundTripFee * 3, probability: 0.5 },
        aggressive: { target: roundTripFee * 5, probability: 0.3 },
        optimal: { target: roundTripFee * 3, winRate: 0.5 }
      };
    }
  }
  
  /**
   * Analyze price movements after entry conditions
   */
  analyzePostEntryMovements(candles, referencePrice, direction) {
    const movements = [];
    const timesToTarget = new Map();
    
    // Find similar price levels in history
    for (let i = 0; i < candles.length - 1; i++) {
      const candle = candles[i];
      const priceLevel = parseFloat(candle.close);
      
      // Skip if price is too far from reference
      if (Math.abs(priceLevel - referencePrice) / referencePrice > 0.001) {
        continue;
      }
      
      // Track subsequent price movement
      let maxMove = 0;
      let timeToMax = 0;
      
      for (let j = i + 1; j < Math.min(i + 120, candles.length); j++) {
        const futureCandle = candles[j];
        const futurePrice = parseFloat(futureCandle.close);
        
        const move = direction === 'buy' ? 
          (futurePrice - priceLevel) / priceLevel :
          (priceLevel - futurePrice) / priceLevel;
        
        if (move > maxMove) {
          maxMove = move;
          timeToMax = j - i;
        }
      }
      
      if (maxMove > 0) {
        movements.push(maxMove);
        
        // Track time to different profit levels
        for (const target of [0.001, 0.002, 0.003, 0.005, 0.01]) {
          if (maxMove >= target) {
            if (!timesToTarget.has(target)) {
              timesToTarget.set(target, []);
            }
            timesToTarget.get(target).push(timeToMax);
          }
        }
      }
    }
    
    // Calculate percentiles
    const sortedMovements = movements.sort((a, b) => a - b);
    const p50 = this.getPercentile(sortedMovements, 50);
    const p75 = this.getPercentile(sortedMovements, 75);
    const p90 = this.getPercentile(sortedMovements, 90);
    
    // Calculate optimal target (best risk/reward)
    const optimal = this.findOptimalTarget(movements, timesToTarget);
    
    return {
      movements,
      percentiles: { p50, p75, p90 },
      timeToTarget: {
        p50: this.getAverageTime(timesToTarget, p50),
        p75: this.getAverageTime(timesToTarget, p75),
        p90: this.getAverageTime(timesToTarget, p90)
      },
      optimal: optimal.target,
      winRate: optimal.winRate,
      avgHoldTime: optimal.avgHoldTime
    };
  }
  
  /**
   * Find optimal target based on risk/reward
   */
  findOptimalTarget(movements, timesToTarget) {
    let bestScore = -Infinity;
    let bestTarget = 0.003; // Default 0.3%
    let bestWinRate = 0;
    let bestAvgTime = 30;
    
    // Test different targets
    for (const [target, times] of timesToTarget.entries()) {
      const winRate = times.length / movements.length;
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      
      // Score based on win rate and time efficiency
      const score = (winRate * target) / Math.sqrt(avgTime);
      
      if (score > bestScore) {
        bestScore = score;
        bestTarget = target;
        bestWinRate = winRate;
        bestAvgTime = avgTime;
      }
    }
    
    return {
      target: bestTarget,
      winRate: bestWinRate,
      avgHoldTime: bestAvgTime,
      score: bestScore
    };
  }
  
  /**
   * Detect resistance levels from order book and price history
   */
  async detectResistanceLevels(pair, marketData, direction) {
    const levels = [];
    const currentPrice = marketData.price;
    
    // 1. Order book resistance
    if (marketData.orderbook) {
      const book = direction === 'buy' ? marketData.orderbook.asks : marketData.orderbook.bids;
      
      // Find significant walls
      let cumulativeVolume = 0;
      const avgVolume = book.reduce((sum, level) => sum + level[1], 0) / book.length;
      
      for (const [price, volume] of book) {
        cumulativeVolume += volume;
        
        // Significant wall detection
        if (volume > avgVolume * 2) {
          const distance = Math.abs(price - currentPrice) / currentPrice;
          levels.push({
            price: parseFloat(price),
            strength: volume / avgVolume,
            distance,
            type: 'orderbook_wall'
          });
        }
      }
    }
    
    // 2. Historical price levels (support/resistance)
    const roundLevels = this.findRoundNumberLevels(currentPrice, direction);
    levels.push(...roundLevels);
    
    // 3. Previous highs/lows
    if (marketData.high24h && marketData.low24h) {
      if (direction === 'buy') {
        levels.push({
          price: marketData.high24h,
          strength: 2,
          distance: (marketData.high24h - currentPrice) / currentPrice,
          type: '24h_high'
        });
      } else {
        levels.push({
          price: marketData.low24h,
          strength: 2,
          distance: (currentPrice - marketData.low24h) / currentPrice,
          type: '24h_low'
        });
      }
    }
    
    // Sort by distance
    return levels.sort((a, b) => a.distance - b.distance);
  }
  
  /**
   * Find psychological round number levels
   */
  findRoundNumberLevels(currentPrice, direction) {
    const levels = [];
    const increment = direction === 'buy' ? 1 : -1;
    
    // Determine round number intervals based on price magnitude
    let interval;
    if (currentPrice > 10000) interval = 100;
    else if (currentPrice > 1000) interval = 10;
    else if (currentPrice > 100) interval = 1;
    else if (currentPrice > 10) interval = 0.1;
    else if (currentPrice > 1) interval = 0.01;
    else interval = 0.001;
    
    // Find next 5 round levels
    const startLevel = Math.ceil(currentPrice / interval) * interval;
    
    for (let i = 0; i < 5; i++) {
      const level = startLevel + (i * interval * increment);
      if (level === currentPrice) continue;
      
      const distance = Math.abs(level - currentPrice) / currentPrice;
      if (distance > 0.05) break; // Max 5% away
      
      levels.push({
        price: level,
        strength: 1,
        distance,
        type: 'round_number'
      });
    }
    
    return levels;
  }
  
  /**
   * Analyze market microstructure for exit opportunities
   */
  analyzeMicrostructure(marketData, entryPrice, direction) {
    const exits = [];
    
    // 1. Spread-based exits
    if (marketData.bid && marketData.ask) {
      const spread = marketData.ask - marketData.bid;
      const spreadPercent = spread / marketData.bid;
      
      // Tight spread = can exit closer to mid
      // Wide spread = need larger profit margin
      const spreadMultiplier = Math.max(1, spreadPercent * 100);
      
      exits.push({
        type: 'spread_based',
        target: spreadPercent * spreadMultiplier,
        confidence: 0.8
      });
    }
    
    // 2. Volume-based exits
    if (marketData.volume24h) {
      // Higher volume = tighter exits possible
      const volumeScore = Math.min(1, marketData.volume24h / 10000000);
      const volumeTarget = 0.002 / volumeScore; // Inverse relationship
      
      exits.push({
        type: 'volume_based',
        target: volumeTarget,
        confidence: volumeScore
      });
    }
    
    // 3. Volatility-based exits
    if (marketData.volatility) {
      const volTarget = marketData.volatility.current * 0.5; // Half the current volatility
      
      exits.push({
        type: 'volatility_based',
        target: volTarget,
        confidence: 0.7
      });
    }
    
    return exits;
  }
  
  /**
   * Optimize exit levels using all signals
   */
  optimizeExitLevels(entryPrice, direction, data) {
    const { historical, resistance, microstructure, signals, fees } = data;
    
    // Calculate fee-aware minimum
    const roundTripFee = fees.maker * 2;
    const minProfitable = roundTripFee * this.config.minProfitMultiplier;
    
    // Weight different signals
    const weights = {
      historical: 0.4,
      resistance: 0.2,
      microstructure: 0.1,
      signals: 0.3
    };
    
    // Calculate weighted targets
    const targets = [];
    
    // 1. Conservative target (high probability)
    const conservativeTarget = Math.max(
      minProfitable,
      historical.conservative.target * weights.historical +
      (resistance[0]?.distance || minProfitable) * weights.resistance +
      minProfitable * weights.signals
    );
    
    targets.push({
      level: 'conservative',
      target: conservativeTarget,
      price: direction === 'buy' ? 
        entryPrice * (1 + conservativeTarget) :
        entryPrice * (1 - conservativeTarget),
      probability: 0.7,
      size: 0.25
    });
    
    // 2. Primary target (balanced)
    const primaryTarget = Math.max(
      roundTripFee * this.config.targetProfitMultiplier,
      historical.target.target * weights.historical +
      (resistance[1]?.distance || roundTripFee * 3) * weights.resistance +
      (signals.expectedValue || 0.005) * weights.signals
    );
    
    targets.push({
      level: 'primary',
      target: primaryTarget,
      price: direction === 'buy' ?
        entryPrice * (1 + primaryTarget) :
        entryPrice * (1 - primaryTarget),
      probability: 0.5,
      size: 0.5
    });
    
    // 3. Aggressive target (capture big moves)
    const aggressiveTarget = Math.max(
      primaryTarget * 1.5,
      historical.aggressive.target * weights.historical +
      (resistance[2]?.distance || primaryTarget * 2) * weights.resistance
    );
    
    targets.push({
      level: 'aggressive',
      target: aggressiveTarget,
      price: direction === 'buy' ?
        entryPrice * (1 + aggressiveTarget) :
        entryPrice * (1 - aggressiveTarget),
      probability: 0.2,
      size: 0.25
    });
    
    return targets;
  }
  
  /**
   * Generate complete exit strategy
   */
  generateExitStrategy(targets, feeInfo) {
    // Calculate weighted average exit
    let weightedTarget = 0;
    let totalWeight = 0;
    
    for (const target of targets) {
      weightedTarget += target.target * target.size;
      totalWeight += target.size;
    }
    
    const averageTarget = weightedTarget / totalWeight;
    const roundTripFee = feeInfo.maker * 2;
    const netProfit = averageTarget - roundTripFee;
    
    return {
      targets,
      averageTarget,
      netProfit,
      profitableTargets: targets.filter(t => t.target > roundTripFee).length,
      recommendation: this.generateRecommendation(targets, netProfit),
      summary: {
        conservative: targets[0],
        primary: targets[1],
        aggressive: targets[2],
        breakeven: roundTripFee,
        expectedProfit: netProfit
      }
    };
  }
  
  /**
   * Generate execution recommendation
   */
  generateRecommendation(targets, netProfit) {
    if (netProfit < 0) {
      return {
        action: 'skip',
        reason: 'No profitable exit found',
        confidence: 0
      };
    }
    
    const profitableCount = targets.filter(t => t.probability > 0.5).length;
    
    if (profitableCount >= 2) {
      return {
        action: 'execute',
        reason: 'Multiple high-probability profitable exits',
        confidence: 0.8,
        strategy: 'multi_tier'
      };
    } else if (profitableCount === 1) {
      return {
        action: 'execute',
        reason: 'Single reliable profit target',
        confidence: 0.6,
        strategy: 'single_target'
      };
    } else {
      return {
        action: 'execute_cautious',
        reason: 'Low probability targets only',
        confidence: 0.4,
        strategy: 'conservative_exit'
      };
    }
  }
  
  // Helper methods
  
  parseOHLCData(ohlcResponse) {
    const dataKey = Object.keys(ohlcResponse).find(key => 
      key !== 'last' && Array.isArray(ohlcResponse[key])
    );
    return ohlcResponse[dataKey] || [];
  }
  
  getPercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }
  
  getAverageTime(timesToTarget, targetLevel) {
    let closestTimes = [];
    let closestDiff = Infinity;
    
    for (const [target, times] of timesToTarget.entries()) {
      const diff = Math.abs(target - targetLevel);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestTimes = times;
      }
    }
    
    if (closestTimes.length === 0) return 30; // Default 30 minutes
    return closestTimes.reduce((a, b) => a + b, 0) / closestTimes.length;
  }
}

export default OptimalExitFinder;