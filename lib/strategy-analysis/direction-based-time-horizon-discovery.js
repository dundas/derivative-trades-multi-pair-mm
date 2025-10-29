#!/usr/bin/env node

/**
 * Direction-Based Time Horizon Discovery
 * 
 * Analyzes price movements at market direction switches to determine optimal:
 * - Buy offsets based on median down movements
 * - Sell targets based on median up movements  
 * - TTL calculations based on time to reach optimal points
 * 
 * Uses 1-minute candles (12 hours of data from Kraken API)
 */

import { KrakenRESTClient } from '../../../lib/exchanges/KrakenRESTClient.js';
import fs from 'fs';

class DirectionBasedTimeHorizonDiscovery {
  constructor(config = {}) {
    this.logger = config.logger || {
      info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
      warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
      error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
      debug: (msg, data) => {} // Silent debug by default
    };
    
    this.krakenClient = new KrakenRESTClient({
      baseUrl: config.krakenBaseUrl || process.env.KRAKEN_BASE_URL || 'https://api.kraken.com',
      apiKey: config.krakenApiKey || process.env.KRAKEN_API_KEY,
      apiSecret: config.krakenApiSecret || process.env.KRAKEN_API_SECRET,
      logger: this.logger
    });
    
    // Full configuration with all parameters configurable
    this.config = {
      // Pair discovery settings
      maxPairs: config.maxPairs,
      minVolume24h: config.minVolume24h,
      quoteCurrency: config.quoteCurrency,
      excludeDerivatives: config.excludeDerivatives,
      tradingPairs: config.tradingPairs, // null = auto-discover
      
      // Analysis parameters
      maPeriod: config.maPeriod, // Moving average period for direction detection
      minDirectionSwitches: config.minDirectionSwitches, // Minimum switches needed
      minDataCandles: config.minDataCandles, // Minimum candles for analysis
      
      // Stop loss testing
      stopLossValues: config.stopLossValues, // Array of stop loss values to test
      
      // Profit target calculations
      conservativeTargetPercentile: config.conservativeTargetPercentile, // Percentile for up movements
      targetMultiplier: config.targetMultiplier, // Multiplier for conservative target
      minProfitMultiplier: config.minProfitMultiplier, // Minimum profit as multiple of fees
      
      // TTL calculations
      ttlBufferMultiplier: config.ttlBufferMultiplier, // Buffer for TTL calculation
      maxHoldDurationMultiplier: config.maxHoldDurationMultiplier, // Max hold duration multiplier
      
      // Timeframe settings
      timeframeInterval: config.timeframeInterval,
      timeframeName: config.timeframeName,
      timeframeDescription: config.timeframeDescription,
      dataHours: config.dataHours, // Hours of data to fetch
      
      // Fee configuration
      makerFee: config.makerFee,
      roundTripFeeMultiplier: config.roundTripFeeMultiplier,
      
      ...config
    };
    
    // Set defaults only if not provided
    this.applyDefaults();
    
    // Create timeframe object
    this.timeframe = {
      interval: this.config.timeframeInterval,
      name: this.config.timeframeName,
      description: this.config.timeframeDescription
    };
    
    // Create fees object
    this.fees = {
      maker: this.config.makerFee,
      round_trip: this.config.makerFee * this.config.roundTripFeeMultiplier
    };
  }
  
  /**
   * Apply default values only where config values are not provided
   */
  applyDefaults() {
    const defaults = {
      // Pair discovery
      maxPairs: 10,
      minVolume24h: 1000000,
      quoteCurrency: 'USD',
      excludeDerivatives: true,
      
      // Analysis parameters
      maPeriod: 10,
      minDirectionSwitches: 4,
      minDataCandles: 50,
      minMovements: 1,
      
      // Stop loss testing
      stopLossValues: [0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05],
      enableThreeDimensionalOptimization: false, // Disabled by default for backward compatibility
      
      // Profit targets
      conservativeTargetPercentile: 80,
      targetMultiplier: 0.8,
      minProfitMultiplier: 1.5,
      
      // TTL
      ttlBufferMultiplier: 1.1,
      maxHoldDurationMultiplier: 2,
      
      // Timeframe
      timeframeInterval: 1,
      timeframeName: '1m',
      timeframeDescription: '1-minute candles',
      dataHours: 12,
      
      // Fees
      makerFee: 0.002,
      roundTripFeeMultiplier: 2
    };
    
    // Apply defaults only for undefined values
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (this.config[key] === undefined) {
        this.config[key] = defaultValue;
      }
    }
  }

  /**
   * Discover top trading pairs by volume using KrakenRESTClient
   */
  async discoverTopTradingPairs() {
    try {
      this.logger.info('🔍 Discovering top trading pairs by volume...');
      
      const topPairsResult = await this.krakenClient.getTopPairsByVolume({
        count: this.config.maxPairs,
        quoteCurrency: this.config.quoteCurrency,
        excludeDerivatives: this.config.excludeDerivatives,
        minVolume: this.config.minVolume24h
      });
      
      if (!topPairsResult.topPairs || topPairsResult.topPairs.length === 0) {
        this.logger.warn('⚠️  No pairs found from volume discovery');
        throw new Error('No trading pairs found');
      }
      
      // Convert to standard format for direction-based analysis
      const discoveredPairs = topPairsResult.topPairs.map(pairData => pairData.pair);
      
      this.logger.info('📊 Top pairs by volume:');
      topPairsResult.topPairs.forEach((pairData, i) => {
        const volumeM = (pairData.volumeInQuote / 1000000).toFixed(1);
        const spreadBps = pairData.spreadBps.toFixed(2);
        console.log(`  ${i + 1}. ${pairData.pair}: $${volumeM}M volume, ${spreadBps} BPS spread`);
      });
      
      this.logger.info(`📈 Market Summary:`);
      console.log(`  • Total pairs analyzed: ${topPairsResult.summary.totalPairsAnalyzed}`);
      console.log(`  • Selected pairs: ${topPairsResult.summary.topPairsReturned}`);
      console.log(`  • Total market volume: $${(topPairsResult.summary.totalMarketVolume / 1000000).toFixed(1)}M`);
      console.log(`  • Selected pairs volume: $${(topPairsResult.summary.topPairsVolume / 1000000).toFixed(1)}M`);
      console.log(`  • Market share: ${topPairsResult.summary.marketSharePercent.toFixed(1)}%`);
      console.log(`  • Average spread: ${topPairsResult.summary.avgSpreadBps.toFixed(2)} BPS`);
      
      return discoveredPairs;
      
    } catch (error) {
      this.logger.error('❌ Failed to discover trading pairs:', error.message);
      throw error;
    }
  }

  /**
   * Fetch OHLC data - 1-minute candles only
   */
  async fetchOHLC(pair) {
    try {
      // Kraken API returns max 720 candles, for 1-minute = 12 hours
      const response = await this.krakenClient.getOHLCData(pair, this.timeframe.interval);
      
      if (response) {
        const dataKey = Object.keys(response).find(key => key !== 'last');
        const rawData = dataKey ? response[dataKey] || [] : [];
        
        return rawData.map(candle => ({
          timestamp: candle[0] * 1000,
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[6])
        }));
      }
      return [];
    } catch (error) {
      this.logger.error(`Failed to fetch OHLC for ${pair}:`, error.message);
      return [];
    }
  }

  /**
   * Calculate moving average for trend detection
   */
  calculateMA(candles, period, endIndex) {
    if (endIndex < period - 1) return null;
    
    const startIndex = endIndex - period + 1;
    const sum = candles.slice(startIndex, endIndex + 1)
      .reduce((acc, candle) => acc + candle.close, 0);
    
    return sum / period;
  }

  /**
   * Identify market direction switches using moving average crossovers
   */
  identifyDirectionSwitches(candles) {
    const switches = [];
    const maPeriod = this.config.maPeriod; // MA period for direction changes
    
    for (let i = maPeriod + 1; i < candles.length - 1; i++) {
      const ma = this.calculateMA(candles, maPeriod, i);
      const prevMA = this.calculateMA(candles, maPeriod, i - 1);
      
      if (!ma || !prevMA) continue;
      
      const currentDirection = candles[i].close > ma ? 'up' : 'down';
      const prevDirection = candles[i - 1].close > prevMA ? 'up' : 'down';
      
      if (currentDirection !== prevDirection) {
        switches.push({
          index: i,
          timestamp: candles[i].timestamp,
          from: prevDirection,
          to: currentDirection,
          price: candles[i].close,
          ma: ma
        });
      }
    }
    
    return switches;
  }

  /**
   * Analyze movements from direction switches
   */
  analyzeMovementsFromSwitches(candles, switches) {
    const downMovements = [];
    const upMovements = [];
    
    for (let i = 0; i < switches.length - 1; i++) {
      const currentSwitch = switches[i];
      const nextSwitch = switches[i + 1];
      
      const startPrice = candles[currentSwitch.index].close;
      
      if (currentSwitch.to === 'down') {
        // Find the lowest point before next switch
        let lowestPrice = startPrice;
        let lowestIndex = currentSwitch.index;
        
        for (let j = currentSwitch.index + 1; j <= nextSwitch.index && j < candles.length; j++) {
          if (candles[j].low < lowestPrice) {
            lowestPrice = candles[j].low;
            lowestIndex = j;
          }
        }
        
        const movement = (lowestPrice - startPrice) / startPrice;
        const duration = lowestIndex - currentSwitch.index;
        
        downMovements.push({
          movement: Math.abs(movement), // Store as positive for easier calculation
          duration: duration,
          startIndex: currentSwitch.index,
          endIndex: lowestIndex,
          startPrice: startPrice,
          endPrice: lowestPrice,
          switchTimestamp: currentSwitch.timestamp,
          endTimestamp: candles[lowestIndex].timestamp
        });
        
      } else if (currentSwitch.to === 'up') {
        // Find the highest point before next switch
        let highestPrice = startPrice;
        let highestIndex = currentSwitch.index;
        
        for (let j = currentSwitch.index + 1; j <= nextSwitch.index && j < candles.length; j++) {
          if (candles[j].high > highestPrice) {
            highestPrice = candles[j].high;
            highestIndex = j;
          }
        }
        
        const movement = (highestPrice - startPrice) / startPrice;
        const duration = highestIndex - currentSwitch.index;
        
        upMovements.push({
          movement: movement,
          duration: duration,
          startIndex: currentSwitch.index,
          endIndex: highestIndex,
          startPrice: startPrice,
          endPrice: highestPrice,
          switchTimestamp: currentSwitch.timestamp,
          endTimestamp: candles[highestIndex].timestamp
        });
      }
    }
    
    return { downMovements, upMovements };
  }

  /**
   * Calculate median of an array
   */
  calculateMedian(values) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  /**
   * Calculate price movement diversity (unique price levels)
   * Higher diversity indicates more actual price movement vs oscillation
   */
  calculatePriceMovementDiversity(candles) {
    if (!candles || candles.length === 0) return { diversity: 0, uniquePrices: 0, priceRange: 0 };
    
    // Get all close prices
    const closePrices = candles.map(c => c.close);
    
    // Find min and max for range calculation
    const minPrice = Math.min(...closePrices);
    const maxPrice = Math.max(...closePrices);
    const priceRange = (maxPrice - minPrice) / minPrice;
    
    // Calculate price buckets (0.1% granularity)
    const bucketSize = minPrice * 0.001; // 0.1% of min price
    const priceBuckets = new Set();
    
    closePrices.forEach(price => {
      const bucket = Math.floor(price / bucketSize);
      priceBuckets.add(bucket);
    });
    
    // Calculate diversity score (unique buckets / total candles)
    const diversity = priceBuckets.size / candles.length;
    
    return {
      diversity: diversity,
      uniquePrices: priceBuckets.size,
      priceRange: priceRange,
      minPrice: minPrice,
      maxPrice: maxPrice,
      totalCandles: candles.length
    };
  }

  /**
   * Count take-profit opportunity windows
   * Identifies periods where price rises by at least the target percentage
   */
  countTakeProfitOpportunities(candles, targetPercentage) {
    if (!candles || candles.length < 2) return { count: 0, percentage: 0, avgDuration: 0 };
    
    const windows = [];
    let inWindow = false;
    let windowStart = null;
    let basePrice = null;
    
    for (let i = 1; i < candles.length; i++) {
      const currentPrice = candles[i].close;
      const prevPrice = candles[i-1].close;
      
      // Look for potential entry points (local lows)
      if (!inWindow && i > 0 && i < candles.length - 1) {
        const isLocalLow = prevPrice > candles[i].low && candles[i].low < candles[i+1].low;
        
        if (isLocalLow) {
          basePrice = candles[i].low;
          windowStart = i;
        }
      }
      
      // Check if we've hit take-profit target from base price
      if (basePrice && currentPrice >= basePrice * (1 + targetPercentage)) {
        if (!inWindow && windowStart !== null) {
          inWindow = true;
          windows.push({
            startIndex: windowStart,
            entryIndex: i,
            duration: i - windowStart,
            basePrice: basePrice,
            targetPrice: basePrice * (1 + targetPercentage),
            actualPrice: currentPrice
          });
        }
      }
      
      // Reset when price drops back below base
      if (basePrice && currentPrice < basePrice) {
        inWindow = false;
        basePrice = null;
        windowStart = null;
      }
    }
    
    const totalDuration = windows.reduce((sum, w) => sum + w.duration, 0);
    
    return {
      count: windows.length,
      percentage: windows.length / candles.length,
      avgDuration: windows.length > 0 ? totalDuration / windows.length : 0,
      windows: windows
    };
  }

  /**
   * Calculate percentile of an array
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Test all permutations of buy offset, sell target, and optionally stop loss
   */
  async testBuySellPermutations(candles, movements, stopLoss = null) {
    const isThreeDimensional = stopLoss === null && this.config.enableThreeDimensionalOptimization;
    
    if (isThreeDimensional) {
      console.log('\n🔄 Testing All Buy/Sell/Stop Loss Permutations (3D optimization):');
      return this.testThreeDimensionalPermutations(candles, movements);
    } else {
      console.log('\n🔄 Testing All Buy/Sell Permutations (1bps increments):');
    }
    
    // Calculate median movements as reference points (less affected by outliers)
    const medianDownMove = this.calculateMedian(movements.downMovements.map(m => m.movement));
    const medianUpMove = this.calculateMedian(movements.upMovements.map(m => m.movement));
    
    // Also calculate averages for comparison
    const avgDownMove = movements.downMovements.reduce((sum, m) => sum + m.movement, 0) / movements.downMovements.length;
    const avgUpMove = movements.upMovements.reduce((sum, m) => sum + m.movement, 0) / movements.upMovements.length;
    
    console.log(`   Median down movement: ${(medianDownMove * 100).toFixed(2)}% (avg: ${(avgDownMove * 100).toFixed(2)}%)`);
    console.log(`   Median up movement: ${(medianUpMove * 100).toFixed(2)}% (avg: ${(avgUpMove * 100).toFixed(2)}%)`);
    console.log(`   Testing buy offsets: 0% to ${(medianDownMove * 1.2 * 100).toFixed(2)}%`);
    console.log(`   Testing sell targets: ${(this.fees.round_trip * 100).toFixed(2)}% to ${(medianUpMove * 1.2 * 100).toFixed(2)}%`);
    
    const results = [];
    const step = 0.0001; // 1 basis point
    
    // Test buy offsets from 0 to 120% of median down movement
    let maxBuyOffset = medianDownMove * 1.2;
    
    // Test sell targets from round-trip fees to 120% of median up movement
    const minSellTarget = this.fees.round_trip;
    let maxSellTarget = medianUpMove * 1.2;

    // Normalize ranges to avoid empty loops
    if (!Number.isFinite(maxBuyOffset) || maxBuyOffset < 0) {
      maxBuyOffset = 0;
    }
    if (!Number.isFinite(maxSellTarget)) {
      maxSellTarget = minSellTarget;
    }
    if (maxSellTarget < minSellTarget) {
      maxSellTarget = minSellTarget;
    }
    
    let totalTested = 0;
    let bestEV = -Infinity;
    let bestConfig = null;
    
    console.log('\n   Buy % | Sell % | Spread | Trades | Win % | EV % | P.F. | Fill % | Net Best');
    console.log('   ------|--------|--------|--------|-------|------|------|--------|----------');
    
    // Test all combinations
    for (let buyOffset = 0; buyOffset <= maxBuyOffset; buyOffset += step) {
      for (let sellTarget = minSellTarget; sellTarget <= maxSellTarget; sellTarget += step) {
        totalTested++;
        
        // Calculate total spread needed
        const totalSpread = buyOffset + sellTarget;
        
        // Create test configuration
        const testOptimal = {
          buyOffset: buyOffset,
          sellTarget: sellTarget,
          minSellTarget: sellTarget,
          avgDownDuration: movements.downMovements.reduce((sum, m) => sum + m.duration, 0) / movements.downMovements.length,
          avgUpDuration: movements.upMovements.reduce((sum, m) => sum + m.duration, 0) / movements.upMovements.length,
          avgValleyToTarget: 10,
          suggestedBuyTTL: 15
        };
        
        // Run backtest
        const trades = this.backtestDirectionStrategy(candles, testOptimal, stopLoss);
        const performance = this.calculatePerformance(trades, testOptimal);
        
        // Calculate fill rate
        const switches = this.identifyDirectionSwitches(candles);
        const downSwitches = switches.filter(s => s.to === 'down').length;
        const fillRate = downSwitches > 0 ? (trades.length / downSwitches) : 0;
        
        const result = {
          buyOffset: buyOffset,
          sellTarget: sellTarget,
          totalSpread: totalSpread,
          fillRate: fillRate,
          ...performance
        };
        
        results.push(result);
        
        // Track best by expected value (including negative values and zero trades)
        if (performance.expectedValue > bestEV) {
          bestEV = performance.expectedValue;
          bestConfig = result;
        }
        
        // Log every 50 bps (0.5%) on both axes, or if it's the new best
        const shouldLog = (buyOffset % 0.005 < 0.0001 && sellTarget % 0.005 < 0.0001) || 
                         (result === bestConfig);
        
        if (shouldLog) {
          const marker = result === bestConfig ? '✓' : ' ';
          console.log(
            `   ${(buyOffset * 100).toFixed(1).padStart(5)} | ${(sellTarget * 100).toFixed(1).padStart(6)} | ${(totalSpread * 100).toFixed(1).padStart(6)} | ${performance.totalTrades.toString().padStart(6)} | ${(performance.winRate * 100).toFixed(0).padStart(4)} | ${(performance.expectedValue * 100).toFixed(2).padStart(5)} | ${performance.profitFactor.toFixed(1).padStart(4)} | ${(fillRate * 100).toFixed(0).padStart(5)} | ${marker}`
          );
        }
      }
      
      // Show progress every 20 bps
      if (buyOffset % 0.002 < 0.0001) {
        process.stdout.write(`\r   Progress: ${((buyOffset / maxBuyOffset) * 100).toFixed(0)}%`);
      }
    }
    
    console.log(`\r   Tested ${totalTested} combinations\n`);
    
    // Find various optimal configurations
    const validResults = results.filter(r => r.totalTrades > 0);
    
    // Best by expected value
    const bestByEV = validResults.reduce((best, current) => 
      current.expectedValue > best.expectedValue ? current : best,
      validResults[0]
    );
    
    // Best by Sharpe ratio (risk-adjusted returns)
    const bestBySharpe = validResults.reduce((best, current) => 
      (current.profitFactor > best.profitFactor) ? current : best,
      validResults[0]
    );
    
    // Best by fill rate with positive EV
    const positiveEVResults = validResults.filter(r => r.expectedValue > 0);
    const bestByFillRate = positiveEVResults.length > 0 
      ? positiveEVResults.reduce((best, current) =>
          current.fillRate > best.fillRate ? current : best,
          positiveEVResults[0])
      : null;
    
    // Most conservative profitable strategy
    const profitableResults = validResults.filter(r => r.expectedValue > 0);
    const mostConservative = profitableResults.length > 0
      ? profitableResults.reduce((best, current) =>
          current.totalSpread < best.totalSpread ? current : best,
          profitableResults[0])
      : null;
    
    console.log('\n🏆 Optimal Configurations:');
    if (bestByEV) {
      console.log(`\n   Best Expected Value:`);
      console.log(`   Buy: ${(bestByEV.buyOffset * 100).toFixed(2)}%, Sell: ${(bestByEV.sellTarget * 100).toFixed(2)}%`);
      console.log(`   Total spread needed: ${(bestByEV.totalSpread * 100).toFixed(2)}%`);
      console.log(`   Expected Value: ${(bestByEV.expectedValue * 100).toFixed(3)}%`);
      console.log(`   Win Rate: ${(bestByEV.winRate * 100).toFixed(1)}%, Trades: ${bestByEV.totalTrades}`);
    }
    
    if (mostConservative && mostConservative !== bestByEV) {
      console.log(`\n   Most Conservative Profitable:`);
      console.log(`   Buy: ${(mostConservative.buyOffset * 100).toFixed(2)}%, Sell: ${(mostConservative.sellTarget * 100).toFixed(2)}%`);
      console.log(`   Total spread needed: ${(mostConservative.totalSpread * 100).toFixed(2)}%`);
      console.log(`   Expected Value: ${(mostConservative.expectedValue * 100).toFixed(3)}%`);
      console.log(`   Win Rate: ${(mostConservative.winRate * 100).toFixed(1)}%, Trades: ${mostConservative.totalTrades}`);
    }
    
    if (!bestByEV || bestByEV.expectedValue <= 0) {
      console.log('\n   ⚠️  No profitable configuration found after fees!');
    }
    
    return {
      allResults: results,
      bestByEV: bestByEV,
      bestBySharpe: bestBySharpe,
      bestByFillRate: bestByFillRate,
      mostConservative: mostConservative,
      totalTested: totalTested,
      avgDownMove: avgDownMove,
      avgUpMove: avgUpMove
    };
  }

  /**
   * Test all combinations of buy offset, sell target, and stop loss (3D optimization)
   */
  async testThreeDimensionalPermutations(candles, movements) {
    console.log('\n🔄 Three-Dimensional Optimization (Buy/Sell/Stop Loss):');
    
    // Calculate median movements as reference points
    const medianDownMove = this.calculateMedian(movements.downMovements.map(m => m.movement));
    const medianUpMove = this.calculateMedian(movements.upMovements.map(m => m.movement));
    
    console.log(`   Median down movement: ${(medianDownMove * 100).toFixed(2)}%`);
    console.log(`   Median up movement: ${(medianUpMove * 100).toFixed(2)}%`);
    console.log(`   Testing ${this.config.stopLossValues.length} stop loss values`);
    
    const results = [];
    const step = 0.0001; // 1 basis point
    
    // Test ranges
    let maxBuyOffset = medianDownMove * 1.2;
    const minSellTarget = this.fees.round_trip;
    let maxSellTarget = medianUpMove * 1.2;

    // Normalize ranges to ensure at least one combination
    if (!Number.isFinite(maxBuyOffset) || maxBuyOffset < 0) {
      maxBuyOffset = 0;
    }
    if (!Number.isFinite(maxSellTarget)) {
      maxSellTarget = minSellTarget;
    }
    if (maxSellTarget < minSellTarget) {
      maxSellTarget = minSellTarget;
    }
    
    let totalTested = 0;
    let bestByEV = null;
    let bestEV = -Infinity;
    
    console.log(`   Testing buy offsets: 0% to ${(maxBuyOffset * 100).toFixed(2)}%`);
    console.log(`   Testing sell targets: ${(minSellTarget * 100).toFixed(2)}% to ${(maxSellTarget * 100).toFixed(2)}%`);
    console.log(`   Testing stop losses: ${this.config.stopLossValues.map(sl => (sl * 100).toFixed(1) + '%').join(', ')}`);
    
    // Three-dimensional loop
    for (const stopLoss of this.config.stopLossValues) {
      console.log(`\n   Testing stop loss: ${(stopLoss * 100).toFixed(1)}%`);
      
      for (let buyOffset = 0; buyOffset <= maxBuyOffset; buyOffset += step) {
        for (let sellTarget = minSellTarget; sellTarget <= maxSellTarget; sellTarget += step) {
          totalTested++;
          
          // Create test configuration
          const testOptimal = {
            buyOffset: buyOffset,
            sellTarget: sellTarget,
            minSellTarget: sellTarget,
            avgHoldTime: 30, // Will be calculated properly later
            suggestedBuyTTL: 8,
            timeToTarget: 16,
            fillRate: 0.8,
            medianDownMove: medianDownMove,
            medianUpMove: medianUpMove
          };
          
          // Run backtest with this combination
          const trades = this.backtestDirectionStrategy(candles, testOptimal, stopLoss);
          const performance = this.calculatePerformance(trades, testOptimal);
          
          const result = {
            buyOffset: buyOffset,
            sellTarget: sellTarget,
            stopLoss: stopLoss,
            totalSpread: buyOffset + sellTarget,
            ...performance
          };
          
          results.push(result);
          
          // Track best by expected value (including negative values and zero trades)
          if (performance.expectedValue > bestEV) {
            bestEV = performance.expectedValue;
            bestByEV = result;
          }
          
          // Progress indicator for large searches
          if (totalTested % 1000 === 0) {
            console.log(`     Tested ${totalTested} combinations, best EV: ${(bestEV * 100).toFixed(3)}%`);
          }
        }
      }
    }
    
    console.log(`\n✅ Three-dimensional optimization complete:`);
    console.log(`   Total combinations tested: ${totalTested.toLocaleString()}`);
    if (bestByEV) {
      console.log(`   Best configuration found:`);
      console.log(`     Buy offset: ${(bestByEV.buyOffset * 100).toFixed(2)}%`);
      console.log(`     Sell target: ${(bestByEV.sellTarget * 100).toFixed(2)}%`);
      console.log(`     Stop loss: ${(bestByEV.stopLoss * 100).toFixed(1)}%`);
      console.log(`     Expected value: ${(bestByEV.expectedValue * 100).toFixed(3)}%`);
      console.log(`     Win rate: ${(bestByEV.winRate * 100).toFixed(1)}%`);
      console.log(`     Total trades: ${bestByEV.totalTrades}`);
    } else {
      console.log(`   No profitable configurations found`);
    }
    
    return {
      allResults: results,
      bestByEV: bestByEV,
      totalTested: totalTested,
      threeDimensional: true,
      avgDownMove: medianDownMove,
      avgUpMove: medianUpMove
    };
  }

  /**
   * Test different buy offsets to find optimal entry point
   */
  async testBuyOffsets(candles, movements, sellTarget, stopLoss) {
    console.log('\n📊 Testing Buy Offset Values (1bps increments):');
    console.log('Buy Offset | Trades | Win Rate | Expected Value | Profit Factor | Avg Hold | Fill Rate');
    console.log('-----------|--------|----------|----------------|---------------|----------|----------');
    
    const results = [];
    const maxOffset = 0.05; // Test up to 5%
    const step = 0.0001; // 1 basis point = 0.01%
    
    // Start from 0 and increment
    for (let offset = 0; offset <= maxOffset; offset += step) {
      // Create optimal config with current offset
      const testOptimal = {
        buyOffset: offset,
        sellTarget: sellTarget,
        minSellTarget: sellTarget,
        avgDownDuration: movements.downMovements.reduce((sum, m) => sum + m.duration, 0) / movements.downMovements.length,
        avgUpDuration: movements.upMovements.reduce((sum, m) => sum + m.duration, 0) / movements.upMovements.length,
        avgValleyToTarget: 10, // Will be calculated properly later
        suggestedBuyTTL: 15 // Default TTL
      };
      
      // Run backtest with this offset
      const trades = this.backtestDirectionStrategy(candles, testOptimal, stopLoss);
      const performance = this.calculatePerformance(trades, testOptimal);
      
      // Calculate fill rate
      const switches = this.identifyDirectionSwitches(candles);
      const downSwitches = switches.filter(s => s.to === 'down').length;
      const fillRate = downSwitches > 0 ? (trades.length / downSwitches) : 0;
      
      results.push({
        buyOffset: offset,
        buyOffsetPercent: (offset * 100).toFixed(2) + '%',
        fillRate: fillRate,
        ...performance
      });
      
      // Log every 10 bps (0.1%)
      if (offset % 0.001 < 0.0001 || offset === 0) {
        console.log(
          `${(offset * 100).toFixed(2).padStart(9)}% | ${performance.totalTrades.toString().padStart(6)} | ${(performance.winRate * 100).toFixed(1).padStart(7)}% | ${(performance.expectedValue * 100).toFixed(3).padStart(13)}% | ${performance.profitFactor.toFixed(2).padStart(12)} | ${performance.avgHoldTime.toFixed(0).padStart(7)}m | ${(fillRate * 100).toFixed(1).padStart(8)}%`
        );
      }
      
      // Stop early if no trades for 10 consecutive offsets
      if (results.length >= 10 && results.slice(-10).every(r => r.totalTrades === 0)) {
        console.log('   ... (stopping - no trades for 10 consecutive offsets)');
        break;
      }
    }
    
    // Find best by expected value with at least some trades
    const validResults = results.filter(r => r.totalTrades > 0);
    const bestByExpectedValue = validResults.reduce((best, current) => 
      current.expectedValue > best.expectedValue ? current : best,
      validResults[0] || results[0]
    );
    
    // Find best by fill rate (most trades executed)
    const bestByFillRate = validResults.reduce((best, current) =>
      current.fillRate > best.fillRate ? current : best,
      validResults[0] || results[0]
    );
    
    console.log('\n🏆 Optimal Buy Offset Results:');
    console.log(`   Best by Expected Value: ${bestByExpectedValue.buyOffsetPercent} (EV: ${(bestByExpectedValue.expectedValue * 100).toFixed(3)}%)`);
    console.log(`   Best by Fill Rate: ${bestByFillRate.buyOffsetPercent} (Fill: ${(bestByFillRate.fillRate * 100).toFixed(1)}%)`);
    
    return {
      allResults: results,
      optimalOffset: bestByExpectedValue.buyOffset,
      bestByExpectedValue,
      bestByFillRate
    };
  }

  /**
   * Find optimal entry/exit points based on direction movements
   */
  findOptimalPoints(movements) {
    const downMovements = movements.downMovements;
    const upMovements = movements.upMovements;
    
    // Calculate median movements
    const medianDownMove = this.calculateMedian(downMovements.map(m => m.movement));
    const medianUpMove = this.calculateMedian(upMovements.map(m => m.movement));
    
    // Calculate percentile for conservative targets
    const conservativeUpTarget = this.calculatePercentile(upMovements.map(m => m.movement), this.config.conservativeTargetPercentile);
    
    // Calculate average durations in minutes
    const avgDownDuration = downMovements.length > 0 
      ? downMovements.reduce((sum, m) => sum + m.duration, 0) / downMovements.length
      : 0;
    
    const avgUpDuration = upMovements.length > 0
      ? upMovements.reduce((sum, m) => sum + m.duration, 0) / upMovements.length
      : 0;
    
    // Calculate time from valley to optimal exit
    const valleyToTargetTimes = [];
    
    for (const down of downMovements) {
      // Find corresponding up movement that starts after this down
      const subsequentUp = upMovements.find(up => up.startIndex > down.endIndex);
      
      if (subsequentUp) {
        const timeToTarget = subsequentUp.endIndex - down.endIndex;
        valleyToTargetTimes.push(timeToTarget);
      }
    }
    
    const avgValleyToTarget = valleyToTargetTimes.length > 0
      ? valleyToTargetTimes.reduce((sum, t) => sum + t, 0) / valleyToTargetTimes.length
      : avgUpDuration;
    
    // Calculate buy offset (median down movement)
    const buyOffset = medianDownMove;
    
    // Calculate sell target (configured multiplier of percentile up movement)
    const sellTarget = conservativeUpTarget * this.config.targetMultiplier;
    
    // Ensure sell target is at least configured multiple of fees
    const minSellTarget = this.fees.round_trip * this.config.minProfitMultiplier;
    const finalSellTarget = Math.max(sellTarget, minSellTarget);
    
    // Calculate TTL: configured buffer on average valley to target time
    const suggestedBuyTTL = Math.ceil(avgValleyToTarget * this.config.ttlBufferMultiplier);
    
    return {
      buyOffset: buyOffset,
      sellTarget: finalSellTarget,
      minSellTarget: minSellTarget,
      avgDownDuration: avgDownDuration,
      avgUpDuration: avgUpDuration,
      avgValleyToTarget: avgValleyToTarget,
      suggestedBuyTTL: suggestedBuyTTL,
      totalDownMoves: downMovements.length,
      totalUpMoves: upMovements.length,
      // Additional stats
      medianDownMove: medianDownMove,
      medianUpMove: medianUpMove,
      conservativeUpTarget: conservativeUpTarget,
      valleyToTargetSamples: valleyToTargetTimes.length
    };
  }

  /**
   * Backtest the direction-based strategy with custom stop loss
   */
  backtestDirectionStrategy(candles, optimal, customStopLoss = null) {
    const trades = [];
    let position = null;
    
    const switches = this.identifyDirectionSwitches(candles);
    
    this.logger.info(`Starting backtest with ${switches.length} direction switches`);
    
    for (let i = 0; i < switches.length; i++) {
      const switchPoint = switches[i];
      
      if (!position && switchPoint.to === 'down') {
        // Look for entry opportunity during down movement
        const entryPrice = switchPoint.price * (1 - optimal.buyOffset);
        
        // Check if we hit our entry price in subsequent candles
        for (let j = switchPoint.index + 1; j < candles.length && j < switchPoint.index + optimal.avgDownDuration * this.config.maxHoldDurationMultiplier; j++) {
          if (candles[j].low <= entryPrice) {
            const fillTime = j - switchPoint.index; // Time from signal to fill
            position = {
              entryPrice: entryPrice,
              entryIndex: j,
              entryTime: new Date(candles[j].timestamp).toISOString(),
              targetPrice: entryPrice * (1 + optimal.sellTarget),
              stopPrice: entryPrice * (1 - (customStopLoss || this.config.stopLossValues[3])), // Custom or default stop loss
              ttlCandles: optimal.suggestedBuyTTL,
              signalIndex: switchPoint.index,
              signalTime: new Date(switchPoint.timestamp).toISOString(),
              fillTimeMinutes: fillTime // Minutes from signal to fill
            };
            
            this.logger.info(`ENTRY: Signal at ${switchPoint.index}, Filled at ${j} (${fillTime}m later), Price ${entryPrice.toFixed(6)}, Target ${position.targetPrice.toFixed(6)}, Stop ${position.stopPrice.toFixed(6)}`);
            break;
          }
        }
      } else if (position) {
        // Check for exit
        const currentCandle = candles[switchPoint.index];
        const holdTime = switchPoint.index - position.entryIndex;
        
        let exitPrice = null;
        let exitReason = null;
        
        if (currentCandle.high >= position.targetPrice) {
          exitPrice = position.targetPrice;
          exitReason = 'target_reached';
        } else if (currentCandle.low <= position.stopPrice) {
          exitPrice = position.stopPrice;
          exitReason = 'stop_loss';
        }
        
        if (exitPrice) {
          const grossProfit = (exitPrice - position.entryPrice) / position.entryPrice;
          const netProfit = grossProfit - this.fees.round_trip;
          
          trades.push({
            entryPrice: position.entryPrice,
            exitPrice,
            entryTime: position.entryTime,
            exitTime: new Date(currentCandle.timestamp).toISOString(),
            holdTimeCandles: holdTime,
            holdTimeMinutes: holdTime, // 1-minute candles
            grossProfit,
            netProfit,
            exitReason,
            profitable: netProfit > 0,
            signalTime: position.signalTime,
            fillTimeMinutes: position.fillTimeMinutes
          });
          
          this.logger.info(`EXIT: ${exitReason}, Gross: ${(grossProfit * 100).toFixed(3)}%, Net: ${(netProfit * 100).toFixed(3)}%`);
          
          position = null;
        }
      }
    }
    
    return trades;
  }

  /**
   * Calculate strategy performance
   */
  calculatePerformance(trades, optimal) {
    if (trades.length === 0) {
      return {
        timeframe: this.timeframe.name,
        totalTrades: 0,
        winRate: 0,
        expectedValue: 0,
        avgNetProfit: 0,
        profitFactor: 0,
        avgHoldTime: 0,
        avgFillTime: 0,
        optimal
      };
    }
    
    const winningTrades = trades.filter(t => t.netProfit > 0);
    const losingTrades = trades.filter(t => t.netProfit <= 0);
    
    const totalNetProfit = trades.reduce((sum, t) => sum + t.netProfit, 0);
    const avgNetProfit = totalNetProfit / trades.length;
    
    const grossWins = winningTrades.reduce((sum, t) => sum + t.netProfit, 0);
    const grossLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.netProfit, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? 999 : 0);
    
    const avgHoldTime = trades.reduce((sum, t) => sum + t.holdTimeMinutes, 0) / trades.length;
    const avgFillTime = trades.reduce((sum, t) => sum + t.fillTimeMinutes, 0) / trades.length;
    
    return {
      timeframe: this.timeframe.name,
      totalTrades: trades.length,
      winRate: winningTrades.length / trades.length,
      expectedValue: avgNetProfit,
      avgNetProfit,
      profitFactor,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      avgHoldTime,
      avgFillTime,
      optimal,
      trades: trades.slice(0, 5) // Include first 5 trades for review
    };
  }

  /**
   * Test multiple stop loss values to find optimal
   */
  testStopLossValues(candles, optimal) {
    const stopLossValues = this.config.stopLossValues;
    const results = [];
    
    console.log('\n📊 Testing Stop Loss Values:');
    console.log('Stop Loss | Trades | Win Rate | Expected Value | Profit Factor | Avg Hold Time | Avg Fill Time');
    console.log('----------|--------|----------|----------------|---------------|-------------|-------------');
    
    for (const stopLoss of stopLossValues) {
      const trades = this.backtestDirectionStrategy(candles, optimal, stopLoss);
      const performance = this.calculatePerformance(trades, optimal);
      
      results.push({
        stopLoss: stopLoss,
        stopLossPercent: (stopLoss * 100).toFixed(1) + '%',
        ...performance
      });
      
      console.log(
        `${(stopLoss * 100).toFixed(1).padStart(8)}% | ${performance.totalTrades.toString().padStart(6)} | ${(performance.winRate * 100).toFixed(1).padStart(7)}% | ${(performance.expectedValue * 100).toFixed(3).padStart(13)}% | ${performance.profitFactor.toFixed(2).padStart(12)} | ${performance.avgHoldTime.toFixed(1).padStart(10)}m | ${performance.avgFillTime.toFixed(1).padStart(12)}m`
      );
    }
    
    // Find best by expected value
    const bestByExpectedValue = results.reduce((best, current) => 
      current.expectedValue > best.expectedValue ? current : best
    );
    
    console.log('\n🏆 Best Stop Loss by Expected Value:');
    console.log(`   Stop Loss: ${bestByExpectedValue.stopLossPercent}`);
    console.log(`   Expected Value: ${(bestByExpectedValue.expectedValue * 100).toFixed(3)}%`);
    console.log(`   Win Rate: ${(bestByExpectedValue.winRate * 100).toFixed(1)}%`);
    console.log(`   Profit Factor: ${bestByExpectedValue.profitFactor.toFixed(2)}`);
    console.log(`   Total Trades: ${bestByExpectedValue.totalTrades}`);
    
    return {
      allResults: results,
      bestStopLoss: bestByExpectedValue.stopLoss,
      bestPerformance: bestByExpectedValue
    };
  }

  /**
   * Discover direction-based strategies for a pair
   * This is the main method that should be called from workflows
   */
  async discoverDirectionStrategies(pair) {
    console.log(`\n🔍 DIRECTION-BASED TIME HORIZON DISCOVERY: ${pair}`);
    console.log('================================================================================');
    
    const results = [];
    
    // Run the full analysis for this pair
    const result = await this.discoverOptimalParameters(pair);
    if (result) {
      results.push(result);
    }
    
    return results;
  }

  /**
   * Discover optimal parameters for a pair
   */
  async discoverOptimalParameters(pair) {
    console.log(`   Analyzing ${pair} with direction-based strategy...`);
    console.log(`   Using ${this.config.timeframeInterval}-minute candles (${this.config.dataHours} hours of data)`);
    
    const candles = await this.fetchOHLC(pair);
    
    if (candles.length < this.config.minDataCandles) {
      console.log(`❌ Insufficient data: ${candles.length} candles (need ${this.config.minDataCandles})`);
      return null;
    }
    
    console.log(`✅ Fetched ${candles.length} candles (${(candles.length / 60).toFixed(1)} hours)`);
    
    // Calculate price movement diversity
    const priceDiversity = this.calculatePriceMovementDiversity(candles);
    console.log(`📊 Price Movement Analysis:`);
    console.log(`   Diversity Score: ${(priceDiversity.diversity * 100).toFixed(1)}%`);
    console.log(`   Unique Price Levels: ${priceDiversity.uniquePrices} (in ${priceDiversity.totalCandles} candles)`);
    console.log(`   Price Range: ${(priceDiversity.priceRange * 100).toFixed(2)}%`);
    console.log(`   Price Min/Max: $${priceDiversity.minPrice.toFixed(5)} - $${priceDiversity.maxPrice.toFixed(5)}`);
    
    // Calculate take-profit opportunity windows
    const takeProfitTarget = this.config.minProfitMultiplier * 0.002; // Default 1.5x fees = 0.3%
    const takeProfitWindows = this.countTakeProfitOpportunities(candles, takeProfitTarget);
    console.log(`   Take-Profit Windows: ${takeProfitWindows.count} opportunities (${(takeProfitWindows.percentage * 100).toFixed(1)}% of time)`);
    console.log(`   Avg Window Duration: ${takeProfitWindows.avgDuration ? takeProfitWindows.avgDuration.toFixed(1) : 0} minutes`);
    
    // Use diversity as a scoring multiplier instead of hard filter
    const diversityMultiplier = priceDiversity.diversity; // 0 to 1
    const opportunityScore = takeProfitWindows.percentage * diversityMultiplier;
    
    console.log(`   Opportunity Score: ${(opportunityScore * 100).toFixed(2)}% (diversity × take-profit windows)`);
    
    // Store these metrics for later use
    priceDiversity.takeProfitWindows = takeProfitWindows;
    priceDiversity.opportunityScore = opportunityScore;
    
    // Identify direction switches
    const switches = this.identifyDirectionSwitches(candles);
    console.log(`📍 Found ${switches.length} direction switches`);
    
    if (switches.length < this.config.minDirectionSwitches) {
      console.log(`❌ Not enough direction switches for analysis (need ${this.config.minDirectionSwitches})`);
      return null;
    }
    
    // Analyze movements
    const movements = this.analyzeMovementsFromSwitches(candles, switches);
    console.log(`📉 Analyzed ${movements.downMovements.length} down movements`);
    console.log(`📈 Analyzed ${movements.upMovements.length} up movements`);
    
    if (movements.downMovements.length < this.config.minMovements || movements.upMovements.length < this.config.minMovements) {
      console.log(`❌ Not enough movement data for analysis (need ${this.config.minMovements} each)`);
      return null;
    }
    
    // Find optimal points
    const optimal = this.findOptimalPoints(movements);
    
    console.log('\n🎯 Optimal Parameters:');
    console.log(`   Buy Offset: ${(optimal.buyOffset * 100).toFixed(2)}% (median down movement)`);
    console.log(`   Sell Target: ${(optimal.sellTarget * 100).toFixed(2)}% (${(this.config.targetMultiplier * 100).toFixed(0)}% of ${this.config.conservativeTargetPercentile}th percentile up)`);
    console.log(`   Min Sell Target: ${(optimal.minSellTarget * 100).toFixed(2)}% (${this.config.minProfitMultiplier}x fees)`);
    console.log(`   Avg Down Duration: ${optimal.avgDownDuration.toFixed(1)} minutes`);
    console.log(`   Avg Up Duration: ${optimal.avgUpDuration.toFixed(1)} minutes`);
    console.log(`   Avg Valley to Target: ${optimal.avgValleyToTarget.toFixed(1)} minutes`);
    console.log(`   Suggested Buy TTL: ${optimal.suggestedBuyTTL} minutes`);
    
    // Check if three-dimensional optimization is enabled
    let stopLossAnalysis;
    let permutationAnalysis;
    let finalStopLoss;
    
    if (this.config.enableThreeDimensionalOptimization) {
      // Use 3D optimization to find optimal buy/sell/stop loss combination
      console.log('\n🔄 Using Three-Dimensional Optimization...');
      
      // Call testBuySellPermutations with stopLoss=null to trigger 3D optimization
      permutationAnalysis = await this.testBuySellPermutations(
        candles, 
        movements, 
        null // This triggers 3D optimization
      );
      
      // Handle the results from 3D optimization
      if (permutationAnalysis.threeDimensional && permutationAnalysis.bestByEV) {
        // Update optimal configuration with best combination from 3D optimization
        optimal.buyOffset = permutationAnalysis.bestByEV.buyOffset;
        optimal.sellTarget = permutationAnalysis.bestByEV.sellTarget;
        optimal.minSellTarget = permutationAnalysis.bestByEV.sellTarget;
        finalStopLoss = permutationAnalysis.bestByEV.stopLoss;
        
        // Create a stop loss analysis object for compatibility
        stopLossAnalysis = {
          bestStopLoss: finalStopLoss,
          bestPerformance: permutationAnalysis.bestByEV,
          allResults: [] // 3D results are in permutationAnalysis.allResults
        };
        
        console.log('\n✅ 3D Optimization Results:');
        console.log(`   Optimal Buy Offset: ${(optimal.buyOffset * 100).toFixed(2)}%`);
        console.log(`   Optimal Sell Target: ${(optimal.sellTarget * 100).toFixed(2)}%`);
        console.log(`   Optimal Stop Loss: ${(finalStopLoss * 100).toFixed(1)}%`);
        console.log(`   Expected Value: ${(permutationAnalysis.bestByEV.expectedValue * 100).toFixed(3)}%`);
        
      } else {
        // 3D optimization didn't find a profitable configuration
        console.log('\n⚠️  3D optimization did not find profitable configuration');
        console.log('   Falling back to traditional 2D optimization...');
        
        // Fall back to traditional approach
        stopLossAnalysis = this.testStopLossValues(candles, optimal);
        permutationAnalysis = await this.testBuySellPermutations(
          candles, 
          movements, 
          stopLossAnalysis.bestStopLoss
        );
        finalStopLoss = stopLossAnalysis.bestStopLoss;
        
        // Update optimal with the best configuration from 2D optimization
        if (permutationAnalysis.bestByEV) {
          optimal.buyOffset = permutationAnalysis.bestByEV.buyOffset;
          optimal.sellTarget = permutationAnalysis.bestByEV.sellTarget;
          optimal.minSellTarget = permutationAnalysis.bestByEV.sellTarget;
        }
      }
    } else {
      // Traditional approach: test stop loss values first, then buy/sell permutations
      console.log('\n🔄 Using Traditional 2D Optimization...');
      
      // Test different stop loss values first to find best stop loss
      stopLossAnalysis = this.testStopLossValues(candles, optimal);
      
      // Test all buy/sell permutations with the optimal stop loss
      permutationAnalysis = await this.testBuySellPermutations(
        candles, 
        movements, 
        stopLossAnalysis.bestStopLoss
      );
      
      finalStopLoss = stopLossAnalysis.bestStopLoss;
      
      // Update optimal with the best configuration
      if (permutationAnalysis.bestByEV) {
        optimal.buyOffset = permutationAnalysis.bestByEV.buyOffset;
        optimal.sellTarget = permutationAnalysis.bestByEV.sellTarget;
        optimal.minSellTarget = permutationAnalysis.bestByEV.sellTarget;
      }
    }
    
    // Use the best settings for final performance
    const trades = this.backtestDirectionStrategy(candles, optimal, finalStopLoss);
    const performance = this.calculatePerformance(trades, optimal);
    
    performance.pair = pair;
    performance.optimalStopLoss = finalStopLoss;
    performance.stopLossAnalysis = stopLossAnalysis;
    performance.permutationAnalysis = permutationAnalysis;
    performance.dataHours = this.config.dataHours; // Add hours of data analyzed
    performance.threeDimensionalOptimized = this.config.enableThreeDimensionalOptimization && permutationAnalysis.threeDimensional;
    performance.priceDiversity = priceDiversity; // Add price diversity metrics
    
    console.log('\n📊 Final Backtest Results (with optimal configuration):');
    console.log(`   Optimization Method: ${this.config.enableThreeDimensionalOptimization && permutationAnalysis.threeDimensional ? '3D (Buy/Sell/Stop Loss)' : '2D (Buy/Sell)'}`);
    console.log(`   Optimal Stop Loss: ${(finalStopLoss * 100).toFixed(1)}%`);
    console.log(`   Total Trades: ${performance.totalTrades}`);
    console.log(`   Win Rate: ${(performance.winRate * 100).toFixed(1)}%`);
    console.log(`   Expected Value: ${(performance.expectedValue * 100).toFixed(3)}%`);
    console.log(`   Profit Factor: ${performance.profitFactor.toFixed(2)}`);
    console.log(`   Avg Hold Time: ${performance.avgHoldTime.toFixed(1)} minutes`);
    console.log(`   Avg Fill Time: ${performance.avgFillTime.toFixed(1)} minutes`);
    
    return performance;
  }

  /**
   * Generate direction-based analysis report
   */
  generateDirectionReport(results) {
    console.log('\n🎯 DIRECTION-BASED TIME HORIZON DISCOVERY RESULTS');
    console.log('================================================================================');
    
    const validResults = results.filter(r => r !== null);
    
    if (validResults.length === 0) {
      console.log('❌ No valid results found');
      return {
        totalTested: 0,
        profitable: 0,
        bestStrategy: null,
        topStrategies: [],
        allResults: [],
        analysisType: 'direction_based_movement'
      };
    }
    
    const profitable = validResults.filter(r => r.expectedValue > 0);
    // Sort by composite score: opportunity score * expected value
    // This prioritizes pairs with both good movement diversity AND profitability
    const sortedResults = validResults.sort((a, b) => {
      const aCompositeScore = (a.priceDiversity?.opportunityScore || 1) * a.expectedValue;
      const bCompositeScore = (b.priceDiversity?.opportunityScore || 1) * b.expectedValue;
      return bCompositeScore - aCompositeScore;
    });
    
    console.log(`\n📊 Analysis Summary:`);
    console.log(`   Total pairs analyzed: ${validResults.length}`);
    console.log(`   Profitable strategies: ${profitable.length}`);
    console.log(`   Success rate: ${((profitable.length / validResults.length) * 100).toFixed(1)}%`);
    
    console.log('\n🏆 STRATEGIES (Sorted by Opportunity Score × Expected Value):');
    console.log('Rank | Pair     | Trades | Win Rate | Expected Value | Opp Score | Composite | Buy Offset | Sell Target | Buy TTL');
    console.log('-----|----------|--------|----------|----------------|-----------|-----------|------------|-------------|--------');
    
    sortedResults.forEach((result, index) => {
      const profitIndicator = result.expectedValue > 0 ? '✓' : '▼';
      const oppScore = result.priceDiversity?.opportunityScore || 0;
      const compositeScore = oppScore * result.expectedValue;
      console.log(
        `${(index + 1).toString().padStart(4)} | ${result.pair.padEnd(8)} | ${result.totalTrades.toString().padStart(6)} | ${(result.winRate * 100).toFixed(1).padStart(7)}% | ${profitIndicator}${(result.expectedValue * 100).toFixed(3).padStart(11)}% | ${(oppScore * 100).toFixed(2).padStart(8)}% | ${(compositeScore * 100).toFixed(3).padStart(9)}% | ${(result.optimal.buyOffset * 100).toFixed(2).padStart(9)}% | ${(result.optimal.sellTarget * 100).toFixed(2).padStart(10)}% | ${result.optimal.suggestedBuyTTL.toString().padStart(6)}m`
      );
    });
    
    const best = sortedResults[0];
    if (best) {
      console.log('\n🏆 BEST STRATEGY (BY COMPOSITE SCORE):');
      console.log(`   Pair: ${best.pair}`);
      console.log(`   Optimization Method: ${best.threeDimensionalOptimized ? '3D (Buy/Sell/Stop Loss)' : '2D (Buy/Sell)'}`);
      console.log(`   Expected Value: ${(best.expectedValue * 100).toFixed(3)}%`);
      console.log(`   Opportunity Score: ${((best.priceDiversity?.opportunityScore || 0) * 100).toFixed(2)}%`);
      console.log(`   Composite Score: ${(((best.priceDiversity?.opportunityScore || 1) * best.expectedValue) * 100).toFixed(3)}%`);
      console.log(`   Price Diversity: ${((best.priceDiversity?.diversity || 0) * 100).toFixed(1)}% unique prices`);
      console.log(`   Take-Profit Windows: ${best.priceDiversity?.takeProfitWindows?.count || 0} opportunities`);
      console.log(`   Win Rate: ${(best.winRate * 100).toFixed(1)}%`);
      console.log(`   Profit Factor: ${best.profitFactor.toFixed(2)}`);
      console.log(`   Avg Hold Time: ${best.avgHoldTime.toFixed(1)} minutes`);
      console.log(`   Optimal Stop Loss: ${(best.optimalStopLoss * 100).toFixed(1)}%`);
      console.log('\n   Optimal Parameters:');
      console.log(`   - Buy Offset: ${(best.optimal.buyOffset * 100).toFixed(2)}%`);
      console.log(`   - Sell Target: ${(best.optimal.sellTarget * 100).toFixed(2)}%`);
      console.log(`   - Stop Loss: ${(best.optimalStopLoss * 100).toFixed(1)}%`);
      console.log(`   - Buy TTL: ${best.optimal.suggestedBuyTTL} minutes`);
      console.log(`   - Sell TTL: Can be session length (refreshed by settlement)`);
      
      if (best.expectedValue <= 0) {
        console.log('\n⚠️  Note: Best strategy shows negative expected value.');
        console.log('   Consider for volume building or when market conditions improve.');
      }
    } else {
      console.log('\n❌ NO STRATEGIES FOUND');
      console.log('   No trading opportunities identified in current market conditions');
    }
    
    // Enhance best strategy with configuration fields for workflow compatibility
    if (sortedResults[0]) {
      const bestStrategy = sortedResults[0];
      // Ensure all required fields are present for workflow integration
      bestStrategy.strategy = 'Direction-Based';
      bestStrategy.timeframe = this.timeframe.name;
      bestStrategy.entryThreshold = bestStrategy.optimal.buyOffset;
      bestStrategy.profitTarget = bestStrategy.optimal.sellTarget;
      bestStrategy.stopLoss = bestStrategy.optimalStopLoss;
      bestStrategy.maxHoldCandles = Math.ceil(bestStrategy.avgHoldTime); // Convert minutes to candles
      bestStrategy.strategyConfig = {
        entryThreshold: bestStrategy.optimal.buyOffset,
        profitTarget: bestStrategy.optimal.sellTarget,
        stopLoss: bestStrategy.optimalStopLoss,
        maxHoldCandles: Math.ceil(bestStrategy.avgHoldTime),
        buyTTL: bestStrategy.optimal.suggestedBuyTTL,
        analysisMethod: 'direction_switches'
      };
      bestStrategy.maxDrawdown = bestStrategy.stopLossAnalysis?.bestStopLoss || bestStrategy.optimalStopLoss;
    }
    
    return {
      totalTested: validResults.length,
      profitable: profitable.length,
      bestStrategy: sortedResults[0] || null,
      topStrategies: sortedResults.slice(0, 5), // Return top 5 strategies for more options
      allResults: sortedResults,
      analysisType: 'direction_based_movement'
    };
  }

  /**
   * Save results to file
   */
  saveResults(report) {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `direction-based-time-horizon-discovery-${timestamp}.json`;
    
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(`\n💾 Analysis saved to: ${filename}`);
    
    return filename;
  }
}

/**
 * Main execution
 */
async function main() {
  const discovery = new DirectionBasedTimeHorizonDiscovery();
  
  console.log('🚀 DIRECTION-BASED TIME HORIZON DISCOVERY');
  console.log('================================================================================');
  console.log('Analyzing market direction switches to find optimal entry/exit points');
  console.log(`Using ${discovery.config.timeframeInterval}-minute candles (${discovery.config.dataHours} hours of data from Kraken API)`);
  
  // Step 0: Discover trading pairs if not specified
  let pairs;
  if (!discovery.config.tradingPairs) {
    console.log('🔍 Auto-discovering top trading pairs by volume...');
    pairs = await discovery.discoverTopTradingPairs();
    console.log(`✅ Selected ${pairs.length} top pairs: ${pairs.join(', ')}`);
  } else {
    pairs = discovery.config.tradingPairs;
    console.log(`📋 Using configured pairs: ${pairs.join(', ')}`);
  }
  
  const allResults = [];
  
  for (const pair of pairs) {
    try {
      const result = await discovery.discoverOptimalParameters(pair);
      allResults.push(result);
    } catch (error) {
      console.error(`❌ Failed to analyze ${pair}:`, error.message);
      allResults.push(null);
    }
  }
  
  const report = discovery.generateDirectionReport(allResults);
  discovery.saveResults(report);
  
  console.log('\n✅ DIRECTION-BASED DISCOVERY COMPLETE');
  
  return report;
}

export { DirectionBasedTimeHorizonDiscovery, main };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Discovery failed:', error.message);
    process.exit(1);
  });
}