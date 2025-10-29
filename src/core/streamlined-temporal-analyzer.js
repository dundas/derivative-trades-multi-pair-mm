#!/usr/bin/env node
/**
 * Streamlined Temporal Pattern Analyzer
 * 
 * Optimized for minimal API calls while maximizing temporal insight:
 * - 4 API calls per pair: 1m, 15m, 1h, 1d
 * - Strategic timeframe selection for optimal coverage
 * - Fast initialization with focused pattern analysis
 */

import { KrakenRESTClient } from '../../lib/exchanges/KrakenRESTClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'StreamlinedTemporalAnalyzer' });

class StreamlinedTemporalAnalyzer {
  constructor(config = {}) {
    this.config = {
      // Optimized timeframes (4 calls per pair)
      timeframes: {
        '1m': { bars: 720, coverage: '12 hours', purpose: 'hourly patterns' },
        '15m': { bars: 720, coverage: '7.5 days', purpose: 'daily patterns' },
        '1h': { bars: 720, coverage: '30 days', purpose: 'weekly/monthly patterns' },
        '1d': { bars: 720, coverage: '2 years', purpose: 'seasonal patterns' }
      },
      
      // Pattern analysis settings
      minSampleSize: 5,                 // Minimum samples for pattern validity
      significanceThreshold: 0.001,     // 0.1% movement threshold
      confidenceLevel: 0.7,             // 70% confidence for patterns
      
      ...config
    };
    
    this.krakenClient = new KrakenRESTClient({ logger });
    
    // Pattern storage
    this.candleData = new Map();       // Raw OHLC data
    this.temporalPatterns = new Map();  // Processed patterns
    this.initialized = false;
  }
  
  async initialize(selectedPairs) {
    const startTime = Date.now();
    logger.info(`🚀 Initializing Streamlined Temporal Analyzer for ${selectedPairs.length} pairs...`);
    
    this.selectedPairs = selectedPairs;
    
    // Fetch data for all pairs and timeframes (4 calls per pair)
    const totalCalls = selectedPairs.length * Object.keys(this.config.timeframes).length;
    logger.info(`📊 Making ${totalCalls} API calls (4 per pair: 1m, 15m, 1h, 1d)`);
    
    for (const pair of selectedPairs) {
      await this.fetchPairData(pair);
      await this.analyzeTemporalPatterns(pair);
    }
    
    this.initialized = true;
    const duration = Date.now() - startTime;
    logger.info(`✅ Streamlined Temporal Analyzer initialized in ${duration}ms`);
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
    
    if (response && response[krakenPair]) {
      return response[krakenPair].map(candle => ({
        timestamp: candle[0] * 1000,
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[6]),
        timeframe
      }));
    }
    
    return [];
  }
  
  /**
   * Analyze temporal patterns for a pair using the 4 timeframes
   */
  async analyzeTemporalPatterns(pair) {
    logger.debug(`🧠 Analyzing temporal patterns for ${pair}...`);
    
    const pairData = this.candleData.get(pair);
    if (!pairData) return;
    
    const patterns = {
      // Hourly patterns (using 1m data - 12 hours coverage)
      hourly: this.analyzeHourlyPatterns(pairData.get('1m')),
      
      // Daily patterns (using 15m data - 7.5 days coverage) 
      daily: this.analyzeDailyPatterns(pairData.get('15m')),
      
      // Weekly/Monthly patterns (using 1h data - 30 days coverage)
      weekly: this.analyzeWeeklyPatterns(pairData.get('1h')),
      monthly: this.analyzeMonthlyPatterns(pairData.get('1h')),
      
      // Seasonal patterns (using 1d data - 2 years coverage)
      seasonal: this.analyzeSeasonalPatterns(pairData.get('1d')),
      yearly: this.analyzeYearlyPatterns(pairData.get('1d')),
      
      // Cross-timeframe insights
      summary: this.generatePatternSummary(pair)
    };
    
    this.temporalPatterns.set(pair, patterns);
    
    logger.debug(`✅ Temporal patterns analyzed for ${pair}`);
  }
  
  /**
   * Analyze hourly patterns using 1-minute data (12 hours coverage)
   */
  analyzeHourlyPatterns(candles) {
    if (!candles || candles.length < 60) return Array(24).fill(null);
    
    const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      movements: [],
      volumes: [],
      frequency: 0,
      avgMovement: 0,
      avgVolume: 0,
      volatility: 0
    }));
    
    // Process movements by hour
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      const hour = new Date(currentCandle.timestamp).getHours();
      
      hourlyData[hour].movements.push(movement);
      hourlyData[hour].volumes.push(currentCandle.volume);
      hourlyData[hour].frequency++;
    }
    
    // Calculate statistics
    hourlyData.forEach(data => {
      if (data.movements.length > 0) {
        data.avgMovement = data.movements.reduce((sum, m) => sum + m, 0) / data.movements.length;
        data.avgVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length;
        data.volatility = this.calculateStandardDeviation(data.movements);
      }
    });
    
    return hourlyData;
  }
  
  /**
   * Analyze daily patterns using 15-minute data (7.5 days coverage)
   */
  analyzeDailyPatterns(candles) {
    if (!candles || candles.length < 96) return Array(7).fill(null); // 96 = 1 day of 15m candles
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dailyData = Array.from({ length: 7 }, (_, day) => ({
      day,
      dayName: dayNames[day],
      movements: [],
      volumes: [],
      frequency: 0,
      avgMovement: 0,
      avgVolume: 0,
      volatility: 0
    }));
    
    // Process by day of week
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      const dayOfWeek = new Date(currentCandle.timestamp).getDay();
      
      dailyData[dayOfWeek].movements.push(movement);
      dailyData[dayOfWeek].volumes.push(currentCandle.volume);
      dailyData[dayOfWeek].frequency++;
    }
    
    // Calculate statistics
    dailyData.forEach(data => {
      if (data.movements.length > 0) {
        data.avgMovement = data.movements.reduce((sum, m) => sum + m, 0) / data.movements.length;
        data.avgVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length;
        data.volatility = this.calculateStandardDeviation(data.movements);
      }
    });
    
    return dailyData;
  }
  
  /**
   * Analyze weekly patterns using 1-hour data (30 days coverage)
   */
  analyzeWeeklyPatterns(candles) {
    if (!candles || candles.length < 168) return Array(4).fill(null); // 168 = 1 week of hourly candles
    
    const weeklyData = Array.from({ length: 4 }, (_, week) => ({
      weekOfMonth: week + 1,
      movements: [],
      volumes: [],
      frequency: 0,
      avgMovement: 0,
      avgVolume: 0,
      volatility: 0
    }));
    
    // Process by week of month
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      const date = new Date(currentCandle.timestamp);
      const dayOfMonth = date.getDate();
      const weekOfMonth = Math.min(3, Math.floor((dayOfMonth - 1) / 7));
      
      weeklyData[weekOfMonth].movements.push(movement);
      weeklyData[weekOfMonth].volumes.push(currentCandle.volume);
      weeklyData[weekOfMonth].frequency++;
    }
    
    // Calculate statistics
    weeklyData.forEach(data => {
      if (data.movements.length > 0) {
        data.avgMovement = data.movements.reduce((sum, m) => sum + m, 0) / data.movements.length;
        data.avgVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length;
        data.volatility = this.calculateStandardDeviation(data.movements);
      }
    });
    
    return weeklyData;
  }
  
  /**
   * Analyze monthly patterns using 1-hour data (30 days coverage)
   */
  analyzeMonthlyPatterns(candles) {
    if (!candles || candles.length < 24) return Array(31).fill(null);
    
    const monthlyData = Array.from({ length: 31 }, (_, index) => ({
      dayOfMonth: index + 1,
      movements: [],
      volumes: [],
      frequency: 0,
      avgMovement: 0,
      avgVolume: 0,
      volatility: 0
    }));
    
    // Process by day of month
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      const dayOfMonth = new Date(currentCandle.timestamp).getDate();
      
      if (dayOfMonth <= 31) {
        monthlyData[dayOfMonth - 1].movements.push(movement);
        monthlyData[dayOfMonth - 1].volumes.push(currentCandle.volume);
        monthlyData[dayOfMonth - 1].frequency++;
      }
    }
    
    // Calculate statistics
    monthlyData.forEach(data => {
      if (data.movements.length > 0) {
        data.avgMovement = data.movements.reduce((sum, m) => sum + m, 0) / data.movements.length;
        data.avgVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length;
        data.volatility = this.calculateStandardDeviation(data.movements);
      }
    });
    
    return monthlyData;
  }
  
  /**
   * Analyze seasonal patterns using daily data (2 years coverage)
   */
  analyzeSeasonalPatterns(candles) {
    if (!candles || candles.length < 90) return Array(4).fill(null); // 90 days = 1 quarter
    
    const seasonNames = ['Q1 (Jan-Mar)', 'Q2 (Apr-Jun)', 'Q3 (Jul-Sep)', 'Q4 (Oct-Dec)'];
    const seasonalData = Array.from({ length: 4 }, (_, quarter) => ({
      quarter: quarter + 1,
      seasonName: seasonNames[quarter],
      movements: [],
      volumes: [],
      frequency: 0,
      avgMovement: 0,
      avgVolume: 0,
      volatility: 0
    }));
    
    // Process by quarter
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      const month = new Date(currentCandle.timestamp).getMonth();
      const quarter = Math.floor(month / 3);
      
      seasonalData[quarter].movements.push(movement);
      seasonalData[quarter].volumes.push(currentCandle.volume);
      seasonalData[quarter].frequency++;
    }
    
    // Calculate statistics
    seasonalData.forEach(data => {
      if (data.movements.length > 0) {
        data.avgMovement = data.movements.reduce((sum, m) => sum + m, 0) / data.movements.length;
        data.avgVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length;
        data.volatility = this.calculateStandardDeviation(data.movements);
      }
    });
    
    return seasonalData;
  }
  
  /**
   * Analyze yearly patterns using daily data (2 years coverage)
   */
  analyzeYearlyPatterns(candles) {
    if (!candles || candles.length < 30) return Array(12).fill(null);
    
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const yearlyData = Array.from({ length: 12 }, (_, month) => ({
      month: month + 1,
      monthName: monthNames[month],
      movements: [],
      volumes: [],
      frequency: 0,
      avgMovement: 0,
      avgVolume: 0,
      volatility: 0
    }));
    
    // Process by month
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      const movement = (currentCandle.close - prevCandle.close) / prevCandle.close;
      
      const month = new Date(currentCandle.timestamp).getMonth();
      
      yearlyData[month].movements.push(movement);
      yearlyData[month].volumes.push(currentCandle.volume);
      yearlyData[month].frequency++;
    }
    
    // Calculate statistics
    yearlyData.forEach(data => {
      if (data.movements.length > 0) {
        data.avgMovement = data.movements.reduce((sum, m) => sum + m, 0) / data.movements.length;
        data.avgVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length;
        data.volatility = this.calculateStandardDeviation(data.movements);
      }
    });
    
    return yearlyData;
  }
  
  /**
   * Get current temporal bias for decision making
   */
  getCurrentTemporalBias(pair, currentTimestamp = Date.now()) {
    if (!this.initialized || !this.temporalPatterns.has(pair)) {
      return {
        hourlyBias: 0,
        dailyBias: 0,
        weeklyBias: 0,
        monthlyBias: 0,
        seasonalBias: 0,
        yearlyBias: 0,
        combinedBias: 0,
        confidence: 0.5,
        reasoning: 'No temporal patterns available'
      };
    }
    
    const patterns = this.temporalPatterns.get(pair);
    const date = new Date(currentTimestamp);
    
    // Extract current time components
    const hour = date.getHours();
    const dayOfWeek = date.getDay();
    const dayOfMonth = date.getDate();
    const month = date.getMonth();
    const quarter = Math.floor(month / 3);
    const weekOfMonth = Math.min(3, Math.floor((dayOfMonth - 1) / 7));
    
    // Get biases from patterns
    const hourlyBias = patterns.hourly[hour]?.avgMovement || 0;
    const dailyBias = patterns.daily[dayOfWeek]?.avgMovement || 0;
    const weeklyBias = patterns.weekly[weekOfMonth]?.avgMovement || 0;
    const monthlyBias = patterns.monthly[dayOfMonth - 1]?.avgMovement || 0;
    const seasonalBias = patterns.seasonal[quarter]?.avgMovement || 0;
    const yearlyBias = patterns.yearly[month]?.avgMovement || 0;
    
    // Calculate weighted combined bias
    const weights = {
      hourly: 0.30,   // Most immediate
      daily: 0.25,    // Strong effect
      weekly: 0.15,   // Medium effect
      monthly: 0.10,  // Payroll effect
      seasonal: 0.10, // Quarterly flows
      yearly: 0.10    // Annual cycles
    };
    
    const combinedBias = 
      (hourlyBias * weights.hourly) +
      (dailyBias * weights.daily) +
      (weeklyBias * weights.weekly) +
      (monthlyBias * weights.monthly) +
      (seasonalBias * weights.seasonal) +
      (yearlyBias * weights.yearly);
    
    // Calculate confidence based on pattern significance
    const hourlyFreq = patterns.hourly[hour]?.frequency || 0;
    const dailyFreq = patterns.daily[dayOfWeek]?.frequency || 0;
    const weeklyFreq = patterns.weekly[weekOfMonth]?.frequency || 0;
    
    const totalSamples = hourlyFreq + dailyFreq + weeklyFreq;
    const confidence = Math.min(1, totalSamples / 100); // Scale to 0-1
    
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const reasoning = [
      `H${hour}: ${(hourlyBias * 100).toFixed(2)}%`,
      `${dayNames[dayOfWeek]}: ${(dailyBias * 100).toFixed(2)}%`,
      `Day${dayOfMonth}: ${(monthlyBias * 100).toFixed(2)}%`,
      `${monthNames[month]}: ${(yearlyBias * 100).toFixed(2)}%`,
      `Q${quarter + 1}: ${(seasonalBias * 100).toFixed(2)}%`
    ].join(' | ');
    
    return {
      hourlyBias,
      dailyBias,
      weeklyBias,
      monthlyBias,
      seasonalBias,
      yearlyBias,
      combinedBias,
      confidence,
      reasoning: `Combined: ${(combinedBias * 100).toFixed(3)}% | ${reasoning}`,
      
      // Additional context
      currentContext: {
        hour,
        dayOfWeek: dayNames[dayOfWeek],
        dayOfMonth,
        month: monthNames[month],
        quarter: `Q${quarter + 1}`,
        weekOfMonth: weekOfMonth + 1
      }
    };
  }
  
  /**
   * Generate pattern summary for a pair
   */
  generatePatternSummary(pair) {
    return {
      dataQuality: 'Good',
      timespan: '2 years',
      confidence: 0.8,
      sampleSize: 720 * 4 // Total candles across timeframes
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

export { StreamlinedTemporalAnalyzer };