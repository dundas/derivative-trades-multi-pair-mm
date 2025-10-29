#!/usr/bin/env node
/**
 * Futures-Enhanced Entry Point Optimizer
 * 
 * Combines futures leading signals with multi-timeframe historical analysis
 * to optimize entry points for maximum profit potential.
 * 
 * Key Features:
 * - Uses futures signals to detect optimal trading pairs
 * - Analyzes 12 hours of 1m and 15m candles for movement patterns
 * - Calculates expected up/down movements based on time of day/week
 * - Optimizes entry timing using micro-movements and volume patterns
 * - Provides confidence-scored entry recommendations
 */

import { DirectionBasedTimeHorizonDiscovery } from '../../trading-agent/strategy-analysis/direction-based-time-horizon-discovery.js';
import { StreamlinedTemporalAnalyzer } from './streamlined-temporal-analyzer.js';
import { KrakenRESTClient } from '../../lib/exchanges/KrakenRESTClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';
import fs from 'fs';

const logger = LoggerFactory.createLogger({ component: 'FuturesEnhancedEntryOptimizer' });

class FuturesEnhancedEntryOptimizer {
  constructor(config = {}) {
    this.config = {
      // Historical analysis window
      lookbackHours: 12,               // 12 hours of historical data
      timeframes: ['1m', '15m'],       // Minute and 15-minute candles
      
      // Movement pattern analysis
      minMovementThreshold: 0.001,     // 0.1% minimum movement to track
      maxMovementWindow: 60,           // 60 minute max movement window
      volumeConfirmationFactor: 1.2,   // 20% above average volume for confirmation
      
      // Entry optimization
      entryWindowMinutes: 5,           // 5 minute entry window after signal
      priceImprovementTarget: 0.0005,  // 0.05% price improvement target
      confidenceThreshold: 0.7,        // 70% minimum confidence
      
      // Time-based patterns
      hourlyPatternWeight: 0.3,        // Weight for hour-of-day patterns
      dayOfWeekPatternWeight: 0.2,     // Weight for day-of-week patterns
      recentPatternWeight: 0.5,        // Weight for recent movement patterns
      
      ...config
    };
    
    this.krakenClient = new KrakenRESTClient({ logger });
    this.discovery = null;
    this.temporalAnalyzer = null;
    
    // Cache for historical data and patterns  
    this.candleCache = new Map();
    this.movementPatterns = new Map();
    this.timePatterns = new Map();
    this.volumeProfiles = new Map();
  }
  
  async initialize(selectedPairs) {
    logger.info('🚀 Initializing Futures-Enhanced Entry Optimizer...');
    
    this.selectedPairs = selectedPairs;
    
    // Initialize direction-based discovery for base strategy analysis
    this.discovery = new DirectionBasedTimeHorizonDiscovery({
      maxPairs: selectedPairs.length,
      tradingPairs: selectedPairs,
      maPeriod: 10,
      dataHours: this.config.lookbackHours,
      timeframes: ['5m', '15m', '1h'], // Use standard timeframes for base analysis
      logger: {
        info: (msg) => logger.debug(msg),
        warn: (msg) => logger.warn(msg),
        error: (msg) => logger.error(msg),
        debug: () => {}
      }
    });
    
    // Initialize streamlined temporal analyzer (exactly 4 API calls per pair)
    this.temporalAnalyzer = new StreamlinedTemporalAnalyzer({
      minSampleSize: 5,
      significanceThreshold: 0.001,
      confidenceLevel: 0.7
    });
    
    await this.temporalAnalyzer.initialize(selectedPairs);
    
    // Pre-load historical data for all pairs (legacy support)
    await this.preloadHistoricalData();
    
    logger.info('✅ Futures-Enhanced Entry Optimizer initialized');
  }
  
  /**
   * Pre-load and cache historical candle data for all pairs
   */
  async preloadHistoricalData() {
    logger.info('📊 Pre-loading historical data for movement pattern analysis...');
    
    for (const pair of this.selectedPairs) {
      for (const timeframe of this.config.timeframes) {
        try {
          const candles = await this.fetchHistoricalCandles(pair, timeframe);
          const cacheKey = `${pair}_${timeframe}`;
          this.candleCache.set(cacheKey, candles);
          
          logger.debug(`📈 Loaded ${candles.length} ${timeframe} candles for ${pair}`);
        } catch (error) {
          logger.warn(`⚠️ Failed to load ${timeframe} data for ${pair}: ${error.message}`);
        }
      }
      
      // Analyze movement patterns for this pair
      await this.analyzeMovementPatterns(pair);
      await this.analyzeTimePatterns(pair);
    }
  }
  
  /**
   * Fetch historical OHLC data from Kraken
   */
  async fetchHistoricalCandles(pair, timeframe) {
    const krakenPair = this.mapToKrakenPair(pair);
    const intervalMinutes = this.parseTimeframeToMinutes(timeframe);
    const since = Date.now() - (this.config.lookbackHours * 60 * 60 * 1000);
    
    try {
      const response = await this.krakenClient.getOHLCData(krakenPair, intervalMinutes, since);
      
      if (response && response[krakenPair]) {
        return response[krakenPair].map(candle => ({
          timestamp: candle[0] * 1000, // Convert to milliseconds
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[6])
        }));
      }
      
      return [];
    } catch (error) {
      logger.error(`❌ Failed to fetch ${timeframe} data for ${pair}: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Analyze historical movement patterns for a pair
   */
  async analyzeMovementPatterns(pair) {
    const patterns = {
      upMovements: [],
      downMovements: [],
      avgUpMove: 0,
      avgDownMove: 0,
      maxUpMove: 0,
      maxDownMove: 0,
      movementDistribution: {},
      volumeCorrelation: 0
    };
    
    // Analyze 1-minute movements
    const oneMinCandles = this.candleCache.get(`${pair}_1m`) || [];
    
    for (let i = 1; i < oneMinCandles.length; i++) {
      const prevCandle = oneMinCandles[i - 1];
      const currentCandle = oneMinCandles[i];
      
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      const volumeRatio = currentCandle.volume / this.calculateAverageVolume(oneMinCandles, i);
      
      if (Math.abs(movement) >= this.config.minMovementThreshold) {
        const moveData = {
          movement,
          volumeRatio,
          timestamp: currentCandle.timestamp,
          hour: new Date(currentCandle.timestamp).getHours(),
          dayOfWeek: new Date(currentCandle.timestamp).getDay()
        };
        
        if (movement > 0) {
          patterns.upMovements.push(moveData);
        } else {
          patterns.downMovements.push(moveData);
        }
      }
    }
    
    // Calculate statistics
    patterns.avgUpMove = patterns.upMovements.length > 0 ? 
      patterns.upMovements.reduce((sum, m) => sum + m.movement, 0) / patterns.upMovements.length : 0;
    
    patterns.avgDownMove = patterns.downMovements.length > 0 ? 
      patterns.downMovements.reduce((sum, m) => sum + Math.abs(m.movement), 0) / patterns.downMovements.length : 0;
    
    patterns.maxUpMove = patterns.upMovements.length > 0 ? 
      Math.max(...patterns.upMovements.map(m => m.movement)) : 0;
    
    patterns.maxDownMove = patterns.downMovements.length > 0 ? 
      Math.max(...patterns.downMovements.map(m => Math.abs(m.movement))) : 0;
    
    // Store patterns
    this.movementPatterns.set(pair, patterns);
    
    logger.debug(`📊 Movement patterns for ${pair}: ↑${(patterns.avgUpMove * 100).toFixed(3)}% ↓${(patterns.avgDownMove * 100).toFixed(3)}%`);
  }
  
  /**
   * Analyze time-based patterns (hour of day, day of week)
   */
  async analyzeTimePatterns(pair) {
    const oneMinCandles = this.candleCache.get(`${pair}_1m`) || [];
    
    const hourlyPatterns = {};
    const dailyPatterns = {};
    
    // Initialize patterns
    for (let hour = 0; hour < 24; hour++) {
      hourlyPatterns[hour] = { upMoves: [], downMoves: [], avgMovement: 0, frequency: 0 };
    }
    
    for (let day = 0; day < 7; day++) {
      dailyPatterns[day] = { upMoves: [], downMoves: [], avgMovement: 0, frequency: 0 };
    }
    
    // Analyze movements by time
    for (let i = 1; i < oneMinCandles.length; i++) {
      const prevCandle = oneMinCandles[i - 1];
      const currentCandle = oneMinCandles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      if (Math.abs(movement) >= this.config.minMovementThreshold) {
        const date = new Date(currentCandle.timestamp);
        const hour = date.getHours();
        const dayOfWeek = date.getDay();
        
        // Hour-based patterns
        hourlyPatterns[hour].frequency++;
        if (movement > 0) {
          hourlyPatterns[hour].upMoves.push(movement);
        } else {
          hourlyPatterns[hour].downMoves.push(Math.abs(movement));
        }
        
        // Day-based patterns
        dailyPatterns[dayOfWeek].frequency++;
        if (movement > 0) {
          dailyPatterns[dayOfWeek].upMoves.push(movement);
        } else {
          dailyPatterns[dayOfWeek].downMoves.push(Math.abs(movement));
        }
      }
    }
    
    // Calculate averages
    for (let hour = 0; hour < 24; hour++) {
      const pattern = hourlyPatterns[hour];
      const allMoves = [...pattern.upMoves, ...pattern.downMoves.map(m => -m)];
      pattern.avgMovement = allMoves.length > 0 ? 
        allMoves.reduce((sum, m) => sum + m, 0) / allMoves.length : 0;
    }
    
    for (let day = 0; day < 7; day++) {
      const pattern = dailyPatterns[day];
      const allMoves = [...pattern.upMoves, ...pattern.downMoves.map(m => -m)];
      pattern.avgMovement = allMoves.length > 0 ? 
        allMoves.reduce((sum, m) => sum + m, 0) / allMoves.length : 0;
    }
    
    this.timePatterns.set(pair, { hourly: hourlyPatterns, daily: dailyPatterns });
    
    logger.debug(`⏰ Time patterns analyzed for ${pair}`);
  }
  
  /**
   * Main method: Optimize entry point using futures signal and historical patterns
   */
  async optimizeEntryPoint(futuresSignal, currentPrice, pair) {
    logger.info(`🎯 Optimizing entry point for ${pair} based on futures signal`);
    
    try {
      // 1. Get base strategy from direction-based analysis
      const baseStrategy = await this.getBaseStrategy(pair);
      
      // 2. Analyze current market snapshot
      const marketSnapshot = await this.getCurrentMarketSnapshot(pair, currentPrice);
      
      // 3. Calculate expected movements based on historical patterns
      const expectedMovements = this.calculateExpectedMovements(pair, marketSnapshot);
      
      // 4. Optimize entry timing using micro-patterns
      const entryOptimization = this.optimizeEntryTiming(
        futuresSignal, 
        expectedMovements, 
        marketSnapshot,
        baseStrategy
      );
      
      // 5. Generate confidence-scored recommendation
      const recommendation = this.generateEntryRecommendation(
        pair,
        currentPrice,
        futuresSignal,
        entryOptimization,
        expectedMovements,
        baseStrategy
      );
      
      return recommendation;
      
    } catch (error) {
      logger.error(`❌ Failed to optimize entry point for ${pair}: ${error.message}`);
      return this.generateFallbackRecommendation(pair, currentPrice, futuresSignal);
    }
  }
  
  /**
   * Get base strategy using direction-based discovery
   */
  async getBaseStrategy(pair) {
    try {
      const results = await this.discovery.discoverDirectionStrategies(pair);
      
      if (results && results.length > 0) {
        return {
          expectedReturn: results[0].expectedValue,
          winRate: results[0].winRate,
          buyOffset: results[0].optimal.buyOffset,
          sellTarget: results[0].optimal.sellTarget,
          confidence: results[0].confidence || 0.7
        };
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to get base strategy for ${pair}: ${error.message}`);
    }
    
    // Fallback strategy
    return {
      expectedReturn: 0.005,
      winRate: 0.55,
      buyOffset: 0.002,
      sellTarget: 0.008,
      confidence: 0.6
    };
  }
  
  /**
   * Get current market snapshot for analysis
   */
  async getCurrentMarketSnapshot(pair, currentPrice) {
    const now = Date.now();
    const currentHour = new Date(now).getHours();
    const currentDay = new Date(now).getDay();
    
    // Get recent volume data
    const oneMinCandles = this.candleCache.get(`${pair}_1m`) || [];
    const recentCandles = oneMinCandles.slice(-10); // Last 10 minutes
    
    const avgVolume = recentCandles.length > 0 ? 
      recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentCandles.length : 1;
    
    const recentVolatility = this.calculateRecentVolatility(recentCandles);
    
    return {
      pair,
      currentPrice,
      timestamp: now,
      currentHour,
      currentDay,
      avgVolume,
      recentVolatility,
      recentCandles
    };
  }
  
  /**
   * Calculate expected movements using enhanced temporal patterns
   */
  calculateExpectedMovements(pair, marketSnapshot) {
    // Get comprehensive temporal bias using the new analyzer
    const temporalBias = this.temporalAnalyzer.getCurrentTemporalBias(pair, marketSnapshot.timestamp);
    
    // Get legacy movement patterns for base calculations
    const movementPatterns = this.movementPatterns.get(pair);
    
    if (!movementPatterns && !temporalBias) {
      return {
        expectedUpMove: 0.003,
        expectedDownMove: 0.003,
        confidence: 0.5,
        reasoning: 'No historical patterns available - using defaults'
      };
    }
    
    // Calculate base movements from historical data
    const baseUpMove = movementPatterns?.avgUpMove || 0.003;
    const baseDownMove = movementPatterns?.avgDownMove || 0.003;
    
    // Apply comprehensive temporal adjustments
    const temporalAdjustment = temporalBias.combinedBias;
    
    const expectedUpMove = Math.max(0.001, baseUpMove + Math.max(0, temporalAdjustment));
    const expectedDownMove = Math.max(0.001, baseDownMove + Math.max(0, -temporalAdjustment));
    
    // Enhanced confidence calculation
    const baseConfidence = movementPatterns ? 
      Math.min(1, (movementPatterns.upMovements.length + movementPatterns.downMovements.length) / 100) : 0.5;
    
    const temporalConfidence = temporalBias.confidence;
    const combinedConfidence = (baseConfidence * 0.6) + (temporalConfidence * 0.4);
    
    return {
      expectedUpMove,
      expectedDownMove,
      confidence: combinedConfidence,
      
      // Enhanced temporal insights
      temporalBias: {
        hourly: temporalBias.hourlyBias,
        daily: temporalBias.dailyBias,
        monthly: temporalBias.monthlyBias || temporalBias.yearlyBias,
        weekly: temporalBias.weeklyBias,
        seasonal: temporalBias.seasonalBias,
        combined: temporalBias.combinedBias
      },
      
      // Legacy compatibility
      hourlyBias: temporalBias.hourlyBias,
      dailyBias: temporalBias.dailyBias,
      patternStrength: baseConfidence,
      timePatternStrength: temporalConfidence,
      
      reasoning: `Enhanced temporal analysis: ${temporalBias.reasoning}`
    };
  }
  
  /**
   * Optimize entry timing using micro-movement patterns
   */
  optimizeEntryTiming(futuresSignal, expectedMovements, marketSnapshot, baseStrategy) {
    const signalDirection = futuresSignal.direction;
    const signalMagnitude = futuresSignal.magnitude;
    
    // Determine optimal entry strategy based on signal and patterns
    let entryStrategy = 'immediate';
    let priceImprovement = 0;
    let confidenceAdjustment = 0;
    let reasoning = '';
    
    if (signalDirection === 'down') {
      // Futures signal down - expect spot to drop
      // Strategy: Wait for dip, then buy aggressively
      const expectedDrop = expectedMovements.expectedDownMove;
      priceImprovement = Math.min(expectedDrop * 0.7, signalMagnitude * 0.5);
      entryStrategy = 'wait_for_dip';
      confidenceAdjustment = 0.1;
      reasoning = `Wait for ${(priceImprovement * 100).toFixed(3)}% dip before buying`;
      
    } else if (signalDirection === 'up') {
      // Futures signal up - expect spot to rise
      // Strategy: Buy immediately before price rises
      priceImprovement = -signalMagnitude * 0.2; // Slight premium for immediate execution
      entryStrategy = 'immediate';
      confidenceAdjustment = 0.05;
      reasoning = `Buy immediately before expected ${(expectedMovements.expectedUpMove * 100).toFixed(3)}% rise`;
    }
    
    // Adjust based on market volatility
    if (marketSnapshot.recentVolatility > 0.005) { // High volatility
      priceImprovement *= 1.5; // More aggressive in volatile markets
      confidenceAdjustment -= 0.1; // Lower confidence
      reasoning += ' (volatile market adjustment)';
    }
    
    // Time-based adjustments
    if (expectedMovements.hourlyBias !== 0) {
      const hourlyAdjustment = Math.abs(expectedMovements.hourlyBias) * 0.3;
      priceImprovement += expectedMovements.hourlyBias > 0 ? -hourlyAdjustment : hourlyAdjustment;
      reasoning += ` (hour-${marketSnapshot.currentHour} bias: ${(expectedMovements.hourlyBias * 100).toFixed(2)}%)`;
    }
    
    return {
      entryStrategy,
      priceImprovement,
      confidenceAdjustment,
      maxWaitTime: this.config.entryWindowMinutes * 60 * 1000, // Convert to ms
      reasoning
    };
  }
  
  /**
   * Generate final entry recommendation
   */
  generateEntryRecommendation(pair, currentPrice, futuresSignal, entryOptimization, expectedMovements, baseStrategy) {
    // Calculate optimized entry price
    const baseOffset = baseStrategy.buyOffset;
    const futuresAdjustment = entryOptimization.priceImprovement;
    const finalOffset = Math.max(0.0001, baseOffset + futuresAdjustment);
    
    const optimizedEntryPrice = currentPrice * (1 - finalOffset);
    
    // Calculate confidence score
    const baseConfidence = baseStrategy.confidence;
    const futuresConfidence = futuresSignal.confidence || 0.7;
    const patternConfidence = expectedMovements.confidence;
    const optimizationConfidence = baseConfidence + entryOptimization.confidenceAdjustment;
    
    const overallConfidence = (
      (baseConfidence * 0.3) +
      (futuresConfidence * 0.4) +
      (patternConfidence * 0.2) +
      (optimizationConfidence * 0.1)
    );
    
    // Calculate potential profit estimate
    const expectedProfit = baseStrategy.expectedReturn;
    const movementBoost = futuresSignal.direction === 'up' ? 
      expectedMovements.expectedUpMove * 0.5 : 
      expectedMovements.expectedDownMove * 0.3;
    
    const adjustedExpectedProfit = expectedProfit + movementBoost;
    
    return {
      pair,
      recommendation: overallConfidence >= this.config.confidenceThreshold ? 'BUY' : 'WAIT',
      
      // Entry details
      currentPrice,
      optimizedEntryPrice,
      priceImprovement: (currentPrice - optimizedEntryPrice) / currentPrice,
      entryStrategy: entryOptimization.entryStrategy,
      maxWaitTime: entryOptimization.maxWaitTime,
      
      // Confidence and expectations
      overallConfidence,
      expectedProfit: adjustedExpectedProfit,
      expectedMovements,
      
      // Signal details
      futuresSignal: {
        direction: futuresSignal.direction,
        magnitude: futuresSignal.magnitude,
        leadTime: futuresSignal.leadTime || 0
      },
      
      // Optimization details
      optimization: {
        baseOffset,
        futuresAdjustment,
        finalOffset,
        reasoning: entryOptimization.reasoning
      },
      
      // Metadata
      timestamp: Date.now(),
      source: 'futures_enhanced_entry_optimizer',
      
      // Detailed reasoning
      reasoning: this.generateDetailedReasoning(
        futuresSignal, 
        expectedMovements, 
        entryOptimization, 
        overallConfidence
      )
    };
  }
  
  /**
   * Generate detailed reasoning for the recommendation
   */
  generateDetailedReasoning(futuresSignal, expectedMovements, entryOptimization, confidence) {
    const parts = [
      `Futures signal: ${futuresSignal.direction} ${(futuresSignal.magnitude * 100).toFixed(4)}%`,
      `Expected movement: ↑${(expectedMovements.expectedUpMove * 100).toFixed(3)}% ↓${(expectedMovements.expectedDownMove * 100).toFixed(3)}%`,
      `Pattern confidence: ${(expectedMovements.confidence * 100).toFixed(1)}%`,
      `Entry strategy: ${entryOptimization.entryStrategy}`,
      `Overall confidence: ${(confidence * 100).toFixed(1)}%`
    ];
    
    if (expectedMovements.hourlyBias !== 0) {
      parts.push(`Hour bias: ${(expectedMovements.hourlyBias * 100).toFixed(2)}%`);
    }
    
    if (expectedMovements.dailyBias !== 0) {
      parts.push(`Day bias: ${(expectedMovements.dailyBias * 100).toFixed(2)}%`);
    }
    
    return parts.join(' | ');
  }
  
  /**
   * Generate fallback recommendation when optimization fails
   */
  generateFallbackRecommendation(pair, currentPrice, futuresSignal) {
    const fallbackOffset = 0.002; // 0.2% default offset
    const fallbackPrice = currentPrice * (1 - fallbackOffset);
    
    return {
      pair,
      recommendation: 'BUY',
      currentPrice,
      optimizedEntryPrice: fallbackPrice,
      priceImprovement: fallbackOffset,
      entryStrategy: 'immediate',
      maxWaitTime: 300000, // 5 minutes
      overallConfidence: 0.6,
      expectedProfit: 0.005,
      futuresSignal,
      source: 'fallback_strategy',
      reasoning: 'Using fallback strategy due to optimization failure',
      timestamp: Date.now()
    };
  }
  
  // Utility methods
  
  calculateAverageVolume(candles, endIndex, lookback = 20) {
    const start = Math.max(0, endIndex - lookback);
    const relevantCandles = candles.slice(start, endIndex);
    
    if (relevantCandles.length === 0) return 1;
    
    return relevantCandles.reduce((sum, c) => sum + c.volume, 0) / relevantCandles.length;
  }
  
  calculateRecentVolatility(candles) {
    if (candles.length < 2) return 0.001;
    
    const movements = [];
    for (let i = 1; i < candles.length; i++) {
      const movement = Math.abs((candles[i].close - candles[i-1].close) / candles[i-1].close);
      movements.push(movement);
    }
    
    return movements.reduce((sum, m) => sum + m, 0) / movements.length;
  }
  
  mapToKrakenPair(pair) {
    const mapping = {
      'BTC/USD': 'XBTUSD',
      'ETH/USD': 'ETHUSD',
      'XRP/USD': 'XRPUSD',
      'ADA/USD': 'ADAUSD',
      'LINK/USD': 'LINKUSD'
    };
    
    return mapping[pair] || pair.replace('/', '');
  }
  
  parseTimeframeToMinutes(timeframe) {
    const mapping = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '1h': 60,
      '4h': 240
    };
    
    return mapping[timeframe] || 1;
  }
}

export { FuturesEnhancedEntryOptimizer };