#!/usr/bin/env node
/**
 * Intra-Hour Temporal Pattern Analyzer
 * 
 * Enhanced version that analyzes patterns within each hour:
 * - Minute-level patterns (0-59 minutes)
 * - 15-minute interval patterns (4 quarters per hour)
 * - 5-minute interval patterns (12 intervals per hour)
 * 
 * Uses 1-minute data strategically to detect micro-timing patterns
 */

import { KrakenRESTClient } from '../../lib/exchanges/KrakenRESTClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'IntraHourTemporalAnalyzer' });

class IntraHourTemporalAnalyzer {
  constructor(config = {}) {
    this.config = {
      // Optimized timeframes (4 calls per pair)
      timeframes: {
        '1m': { bars: 720, coverage: '12 hours', purpose: 'minute-level patterns' },
        '15m': { bars: 720, coverage: '7.5 days', purpose: 'daily patterns' },
        '1h': { bars: 720, coverage: '30 days', purpose: 'weekly/monthly patterns' },
        '1d': { bars: 720, coverage: '2 years', purpose: 'seasonal patterns' }
      },
      
      // Pattern analysis settings
      minSampleSize: 3,                 // Minimum samples for intra-hour patterns
      significanceThreshold: 0.0005,    // 0.05% movement threshold for micro-patterns
      confidenceLevel: 0.6,             // 60% confidence for intra-hour patterns
      
      ...config
    };
    
    this.krakenClient = new KrakenRESTClient({ logger });
    
    // Pattern storage
    this.candleData = new Map();       // Raw OHLC data
    this.intraHourPatterns = new Map(); // Intra-hour patterns
    this.initialized = false;
  }
  
  async initialize(selectedPairs) {
    const startTime = Date.now();
    logger.info(`🚀 Initializing Intra-Hour Temporal Analyzer for ${selectedPairs.length} pairs...`);
    
    this.selectedPairs = selectedPairs;
    
    // Fetch data for all pairs and timeframes (4 calls per pair)
    const totalCalls = selectedPairs.length * Object.keys(this.config.timeframes).length;
    logger.info(`📊 Making ${totalCalls} API calls (4 per pair: 1m, 15m, 1h, 1d)`);
    
    for (const pair of selectedPairs) {
      await this.fetchPairData(pair);
      await this.analyzeIntraHourPatterns(pair);
    }
    
    this.initialized = true;
    const duration = Date.now() - startTime;
    logger.info(`✅ Intra-Hour Temporal Analyzer initialized in ${duration}ms`);
  }
  
  /**
   * Fetch all timeframe data for a single pair (4 API calls)
   */
  async fetchPairData(pair) {
    logger.debug(`📈 Fetching temporal data for ${pair}...`);
    
    const pairData = new Map();
    
    for (const [timeframe, config] of Object.entries(this.config.timeframes)) {
      try {
        const candles = await this.fetchTimeframeData(pair, timeframe);
        pairData.set(timeframe, candles);
        
        logger.debug(`  ✅ ${timeframe}: ${candles.length} candles (${config.coverage})`);
      } catch (error) {
        logger.warn(`  ❌ ${timeframe}: ${error.message}`);
        pairData.set(timeframe, []);
      }
    }
    
    this.candleData.set(pair, pairData);
  }
  
  async fetchTimeframeData(pair, timeframe) {
    const krakenPair = this.mapToKrakenPair(pair);
    const intervalMinutes = this.parseTimeframeToMinutes(timeframe);
    
    const response = await this.krakenClient.getOHLCData(krakenPair, intervalMinutes);
    
    if (response) {
      // Kraken returns data under various key formats, find the actual data key
      const dataKey = Object.keys(response).find(key => key !== 'last' && Array.isArray(response[key]));
      
      if (dataKey && response[dataKey]) {
        return response[dataKey].map(candle => ({
          timestamp: candle[0] * 1000,
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[6]),
          timeframe
        }));
      }
    }
    
    return [];
  }
  
  /**
   * Analyze intra-hour patterns for a pair using 1-minute data
   */
  async analyzeIntraHourPatterns(pair) {
    logger.debug(`🧠 Analyzing intra-hour patterns for ${pair}...`);
    
    const oneMinData = this.candleData.get(pair)?.get('1m') || [];
    
    if (oneMinData.length < 120) { // Need at least 2 hours of data
      logger.warn(`⚠️ Insufficient 1-minute data for ${pair}: ${oneMinData.length} candles`);
      return;
    }
    
    const patterns = {
      // Minute-level patterns (0-59)
      minutePatterns: this.analyzeMinuteLevelPatterns(oneMinData),
      
      // 15-minute quarter patterns (4 per hour)
      quarterHourPatterns: this.analyzeQuarterHourPatterns(oneMinData),
      
      // 5-minute interval patterns (12 per hour)
      fiveMinutePatterns: this.analyzeFiveMinutePatterns(oneMinData),
      
      // Intra-hour volatility profile
      volatilityProfile: this.analyzeIntraHourVolatility(oneMinData),
      
      // Volume distribution within hours
      volumeProfile: this.analyzeIntraHourVolume(oneMinData),
      
      // Summary statistics
      summary: this.generateIntraHourSummary(pair, oneMinData)
    };
    
    this.intraHourPatterns.set(pair, patterns);
    
    logger.debug(`✅ Intra-hour patterns analyzed for ${pair}`);
  }
  
  /**
   * Analyze patterns for each minute within an hour (0-59)
   */
  analyzeMinuteLevelPatterns(candles) {
    const minuteData = Array.from({ length: 60 }, (_, minute) => ({
      minute,
      movements: [],
      volumes: [],
      frequency: 0,
      avgMovement: 0,
      avgVolume: 0,
      volatility: 0,
      significance: 0
    }));
    
    // Process movements by minute within hour
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      const minute = new Date(currentCandle.timestamp).getMinutes();
      
      minuteData[minute].movements.push(movement);
      minuteData[minute].volumes.push(currentCandle.volume);
      minuteData[minute].frequency++;
    }
    
    // Calculate statistics
    minuteData.forEach(data => {
      if (data.movements.length >= this.config.minSampleSize) {
        data.avgMovement = data.movements.reduce((sum, m) => sum + m, 0) / data.movements.length;
        data.avgVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length;
        data.volatility = this.calculateStandardDeviation(data.movements);
        data.significance = Math.abs(data.avgMovement) * Math.sqrt(data.frequency);
      }
    });
    
    return minuteData;
  }
  
  /**
   * Analyze patterns for 15-minute quarters within each hour
   */
  analyzeQuarterHourPatterns(candles) {
    const quarterNames = ['Q1 (0-15)', 'Q2 (15-30)', 'Q3 (30-45)', 'Q4 (45-60)'];
    const quarterData = Array.from({ length: 4 }, (_, quarter) => ({
      quarter: quarter + 1,
      quarterName: quarterNames[quarter],
      minuteRange: `${quarter * 15}-${(quarter + 1) * 15}`,
      movements: [],
      volumes: [],
      frequency: 0,
      avgMovement: 0,
      avgVolume: 0,
      volatility: 0,
      significance: 0
    }));
    
    // Process by 15-minute quarters
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      const minute = new Date(currentCandle.timestamp).getMinutes();
      const quarter = Math.floor(minute / 15); // 0, 1, 2, 3
      
      quarterData[quarter].movements.push(movement);
      quarterData[quarter].volumes.push(currentCandle.volume);
      quarterData[quarter].frequency++;
    }
    
    // Calculate statistics
    quarterData.forEach(data => {
      if (data.movements.length >= this.config.minSampleSize) {
        data.avgMovement = data.movements.reduce((sum, m) => sum + m, 0) / data.movements.length;
        data.avgVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length;
        data.volatility = this.calculateStandardDeviation(data.movements);
        data.significance = Math.abs(data.avgMovement) * Math.sqrt(data.frequency);
      }
    });
    
    return quarterData;
  }
  
  /**
   * Analyze patterns for 5-minute intervals within each hour
   */
  analyzeFiveMinutePatterns(candles) {
    const intervalData = Array.from({ length: 12 }, (_, interval) => ({
      interval: interval + 1,
      minuteRange: `${interval * 5}-${(interval + 1) * 5}`,
      movements: [],
      volumes: [],
      frequency: 0,
      avgMovement: 0,
      avgVolume: 0,
      volatility: 0,
      significance: 0
    }));
    
    // Process by 5-minute intervals
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      const minute = new Date(currentCandle.timestamp).getMinutes();
      const interval = Math.floor(minute / 5); // 0-11
      
      if (interval < 12) {
        intervalData[interval].movements.push(movement);
        intervalData[interval].volumes.push(currentCandle.volume);
        intervalData[interval].frequency++;
      }
    }
    
    // Calculate statistics
    intervalData.forEach(data => {
      if (data.movements.length >= this.config.minSampleSize) {
        data.avgMovement = data.movements.reduce((sum, m) => sum + m, 0) / data.movements.length;
        data.avgVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length;
        data.volatility = this.calculateStandardDeviation(data.movements);
        data.significance = Math.abs(data.avgMovement) * Math.sqrt(data.frequency);
      }
    });
    
    return intervalData;
  }
  
  /**
   * Analyze volatility patterns within hours
   */
  analyzeIntraHourVolatility(candles) {
    const volatilityByMinute = Array(60).fill(0);
    const countByMinute = Array(60).fill(0);
    
    for (let i = 1; i < candles.length; i++) {
      const movement = Math.abs((candles[i].close - candles[i-1].close) / candles[i-1].close);
      const minute = new Date(candles[i].timestamp).getMinutes();
      
      volatilityByMinute[minute] += movement;
      countByMinute[minute]++;
    }
    
    // Calculate average volatility per minute
    const avgVolatilityByMinute = volatilityByMinute.map((vol, minute) => 
      countByMinute[minute] > 0 ? vol / countByMinute[minute] : 0
    );
    
    // Find peak volatility periods
    const avgVolatility = avgVolatilityByMinute.reduce((sum, vol) => sum + vol, 0) / 60;
    const highVolatilityMinutes = [];
    const lowVolatilityMinutes = [];
    
    avgVolatilityByMinute.forEach((vol, minute) => {
      if (vol > avgVolatility * 1.5) {
        highVolatilityMinutes.push(minute);
      } else if (vol < avgVolatility * 0.5 && vol > 0) {
        lowVolatilityMinutes.push(minute);
      }
    });
    
    return {
      volatilityByMinute: avgVolatilityByMinute,
      avgVolatility,
      highVolatilityMinutes,
      lowVolatilityMinutes,
      peakVolatilityMinute: avgVolatilityByMinute.indexOf(Math.max(...avgVolatilityByMinute)),
      quietestMinute: avgVolatilityByMinute.indexOf(Math.min(...avgVolatilityByMinute.filter(v => v > 0)))
    };
  }
  
  /**
   * Analyze volume patterns within hours
   */
  analyzeIntraHourVolume(candles) {
    const volumeByMinute = Array(60).fill(0);
    const countByMinute = Array(60).fill(0);
    
    candles.forEach(candle => {
      const minute = new Date(candle.timestamp).getMinutes();
      volumeByMinute[minute] += candle.volume;
      countByMinute[minute]++;
    });
    
    // Calculate average volume per minute
    const avgVolumeByMinute = volumeByMinute.map((vol, minute) => 
      countByMinute[minute] > 0 ? vol / countByMinute[minute] : 0
    );
    
    return {
      volumeByMinute: avgVolumeByMinute,
      avgVolume: avgVolumeByMinute.reduce((sum, vol) => sum + vol, 0) / 60
    };
  }
  
  /**
   * Get current intra-hour bias for the specific minute
   */
  getCurrentIntraHourBias(pair, currentTimestamp = Date.now()) {
    if (!this.initialized || !this.intraHourPatterns.has(pair)) {
      return {
        minuteBias: 0,
        quarterHourBias: 0,
        fiveMinuteBias: 0,
        combinedIntraHourBias: 0,
        confidence: 0.5,
        reasoning: 'No intra-hour patterns available'
      };
    }
    
    const patterns = this.intraHourPatterns.get(pair);
    const date = new Date(currentTimestamp);
    
    // Extract current time components
    const minute = date.getMinutes();
    const quarter = Math.floor(minute / 15); // 0-3
    const fiveMinInterval = Math.floor(minute / 5); // 0-11
    
    // Get biases from patterns
    const minuteBias = patterns.minutePatterns[minute]?.avgMovement || 0;
    const quarterHourBias = patterns.quarterHourPatterns[quarter]?.avgMovement || 0;
    const fiveMinuteBias = patterns.fiveMinutePatterns[fiveMinInterval]?.avgMovement || 0;
    
    // Calculate weighted combined bias for intra-hour
    const weights = {
      minute: 0.5,       // Most specific
      quarterHour: 0.3,  // Medium granularity
      fiveMinute: 0.2    // Intermediate granularity
    };
    
    const combinedIntraHourBias = 
      (minuteBias * weights.minute) +
      (quarterHourBias * weights.quarterHour) +
      (fiveMinuteBias * weights.fiveMinute);
    
    // Calculate confidence based on pattern frequency
    const minuteFreq = patterns.minutePatterns[minute]?.frequency || 0;
    const quarterFreq = patterns.quarterHourPatterns[quarter]?.frequency || 0;
    const fiveMinFreq = patterns.fiveMinutePatterns[fiveMinInterval]?.frequency || 0;
    
    const totalSamples = minuteFreq + quarterFreq + fiveMinFreq;
    const confidence = Math.min(1, totalSamples / 30); // Scale to 0-1
    
    const reasoning = [
      `Min${minute}: ${(minuteBias * 100).toFixed(3)}%`,
      `Q${quarter + 1}: ${(quarterHourBias * 100).toFixed(3)}%`,
      `5m${fiveMinInterval + 1}: ${(fiveMinuteBias * 100).toFixed(3)}%`
    ].join(' | ');
    
    // Additional context
    const volatilityProfile = patterns.volatilityProfile;
    const isHighVolatilityMinute = volatilityProfile.highVolatilityMinutes.includes(minute);
    const isLowVolatilityMinute = volatilityProfile.lowVolatilityMinutes.includes(minute);
    
    return {
      minuteBias,
      quarterHourBias,
      fiveMinuteBias,
      combinedIntraHourBias,
      confidence,
      reasoning: `Combined: ${(combinedIntraHourBias * 100).toFixed(3)}% | ${reasoning}`,
      
      // Additional context
      currentContext: {
        minute,
        quarter: quarter + 1,
        fiveMinInterval: fiveMinInterval + 1,
        quarterName: patterns.quarterHourPatterns[quarter]?.quarterName || 'Unknown',
        isHighVolatilityMinute,
        isLowVolatilityMinute
      },
      
      // Volatility insights
      volatilityContext: {
        currentMinuteVolatility: volatilityProfile.volatilityByMinute[minute] || 0,
        avgVolatility: volatilityProfile.avgVolatility,
        relativeVolatility: volatilityProfile.volatilityByMinute[minute] / volatilityProfile.avgVolatility
      }
    };
  }
  
  /**
   * Generate summary for intra-hour patterns
   */
  generateIntraHourSummary(pair, candles) {
    return {
      dataQuality: 'Good',
      timespan: '12 hours',
      confidence: 0.7,
      sampleSize: candles.length,
      coverage: 'Minute-level analysis'
    };
  }
  
  // Utility methods
  
  calculateStandardDeviation(values) {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDifferences.reduce((sum, val) => sum + val, 0) / values.length;
    
    return Math.sqrt(variance);
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
      '15m': 15,
      '1h': 60,
      '1d': 1440
    };
    
    return mapping[timeframe] || 1;
  }
}

export { IntraHourTemporalAnalyzer };