#!/usr/bin/env node

/**
 * Market Regime Detection Service
 * 
 * Classifies market conditions using multiple indicators:
 * - Price trend analysis (SMA crossovers)
 * - Volatility regimes (GARCH-like)
 * - Volume patterns
 * - Support/resistance levels
 * 
 * Outputs: BULL, BEAR, SIDEWAYS, VOLATILE_BULL, VOLATILE_BEAR
 */

import fetch from 'node-fetch';
import { calculateSMA, calculateStandardDeviation } from '../../../utils/technical-indicators.js';
import { analyzeTrend as sharedAnalyzeTrend } from '../../../utils/market-analysis.js';

export class MarketRegimeDetector {
  constructor(config = {}) {
    this.config = {
      // Trend detection parameters
      shortPeriod: config.shortPeriod || 20,    // Short-term MA
      longPeriod: config.longPeriod || 50,      // Long-term MA
      trendConfidence: config.trendConfidence || 0.02, // 2% minimum trend
      
      // Volatility thresholds (in BPS)
      lowVolatility: config.lowVolatility || 30,
      highVolatility: config.highVolatility || 80,
      
      // Volume analysis
      volumeWindow: config.volumeWindow || 14,
      volumeThreshold: config.volumeThreshold || 1.5, // 1.5x average volume
      
      // Support/resistance
      srWindow: config.srWindow || 100,
      srTolerance: config.srTolerance || 0.005, // 0.5% tolerance
      
      ...config
    };
    
    this.cache = new Map();
    this.lastUpdate = 0;
    this.cacheExpiry = 300000; // 5 minutes
  }

  /**
   * Detect market regime for a single pair
   */
  async detectRegime(pair, timeframe = '1h') {
    const cacheKey = `${pair}_${timeframe}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheExpiry) {
        return cached.regime;
      }
    }
    
    try {
      // Fetch OHLC data
      const ohlcData = await this.fetchOHLCData(pair, timeframe);
      
      if (ohlcData.length < this.config.longPeriod + 20) {
        throw new Error(`Insufficient data for regime detection: ${ohlcData.length} candles`);
      }
      
      // Analyze different aspects
      const trendAnalysis = this.analyzeTrend(ohlcData);
      const volatilityAnalysis = this.analyzeVolatility(ohlcData);
      const volumeAnalysis = this.analyzeVolume(ohlcData);
      const supportResistanceAnalysis = this.analyzeSupportResistance(ohlcData);
      
      // Combine analyses to determine regime
      const regime = this.determineRegime({
        trend: trendAnalysis,
        volatility: volatilityAnalysis,
        volume: volumeAnalysis,
        supportResistance: supportResistanceAnalysis,
        pair,
        timeframe
      });
      
      // Cache result
      this.cache.set(cacheKey, {
        regime,
        timestamp: Date.now()
      });
      
      return regime;
      
    } catch (error) {
      console.warn(`⚠️  Regime detection failed for ${pair}: ${error.message}`);
      return this.getDefaultRegime();
    }
  }

  /**
   * Detect regimes for multiple pairs
   */
  async detectMultipleRegimes(pairs, timeframe = '1h') {
    const results = {};
    
    // Process in parallel for efficiency
    const promises = pairs.map(async (pair) => {
      const regime = await this.detectRegime(pair, timeframe);
      results[pair] = regime;
    });
    
    await Promise.all(promises);
    
    // Add market-wide analysis
    results._marketWide = this.analyzeMarketWideRegime(results);
    
    return results;
  }

  /**
   * Analyze price trend using moving averages and momentum
   */
  analyzeTrend(ohlcData) {
    // Use shared trend analysis with custom config
    const trendAnalysis = sharedAnalyzeTrend(ohlcData, {
      shortPeriod: this.config.shortPeriod,
      longPeriod: this.config.longPeriod,
      trendConfidence: this.config.trendConfidence
    });
    
    // Convert shared format to this class's expected format
    let direction = trendAnalysis.direction;
    if (direction === 'BULLISH') direction = 'BULL';
    else if (direction === 'BEARISH') direction = 'BEAR';
    
    return {
      direction,
      strength: trendAnalysis.strength,
      confidence: trendAnalysis.confidence,
      shortMA: trendAnalysis.indicators.shortMA,
      longMA: trendAnalysis.indicators.longMA,
      spread: trendAnalysis.indicators.spread,
      momentum: trendAnalysis.indicators.momentum
    };
  }

  /**
   * Analyze volatility regime using rolling standard deviation
   */
  analyzeVolatility(ohlcData) {
    const closes = ohlcData.map(candle => parseFloat(candle[4]));
    const returns = [];
    
    // Calculate returns
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i-1]) / closes[i-1]);
    }
    
    // Rolling volatility (last 20 periods)
    const volWindow = Math.min(20, returns.length);
    const recentReturns = returns.slice(-volWindow);
    const volatility = calculateStandardDeviation(recentReturns) * Math.sqrt(252) * 100; // Annualized %
    
    // Historical volatility (full dataset)
    const historicalVol = calculateStandardDeviation(returns) * Math.sqrt(252) * 100;
    
    // Volatility regime
    let regime = 'NORMAL';
    let percentile = 0.5;
    
    if (volatility > this.config.highVolatility) {
      regime = 'HIGH';
      percentile = 0.8;
    } else if (volatility < this.config.lowVolatility) {
      regime = 'LOW';
      percentile = 0.2;
    }
    
    // Volatility trend
    const volTrend = volatility > historicalVol ? 'INCREASING' : 'DECREASING';
    
    return {
      regime,
      current: volatility,
      historical: historicalVol,
      percentile,
      trend: volTrend,
      isExpanding: volatility > historicalVol * 1.2,
      isContracting: volatility < historicalVol * 0.8
    };
  }

  /**
   * Analyze volume patterns
   */
  analyzeVolume(ohlcData) {
    const volumes = ohlcData.map(candle => parseFloat(candle[6]));
    
    if (volumes.length < this.config.volumeWindow) {
      return { regime: 'NORMAL', strength: 0.5 };
    }
    
    // Average volume
    const avgVolume = volumes.slice(-this.config.volumeWindow)
      .reduce((sum, vol) => sum + vol, 0) / this.config.volumeWindow;
    
    const currentVolume = volumes[volumes.length - 1];
    const volumeRatio = currentVolume / avgVolume;
    
    let regime = 'NORMAL';
    let strength = 0.5;
    
    if (volumeRatio > this.config.volumeThreshold) {
      regime = 'HIGH';
      strength = Math.min(volumeRatio / this.config.volumeThreshold, 2) / 2;
    } else if (volumeRatio < (1 / this.config.volumeThreshold)) {
      regime = 'LOW';
      strength = Math.max(0, 1 - volumeRatio);
    }
    
    return {
      regime,
      strength,
      currentVolume,
      avgVolume,
      ratio: volumeRatio
    };
  }

  /**
   * Analyze support and resistance levels
   */
  analyzeSupportResistance(ohlcData) {
    const closes = ohlcData.map(candle => parseFloat(candle[4]));
    const highs = ohlcData.map(candle => parseFloat(candle[2]));
    const lows = ohlcData.map(candle => parseFloat(candle[3]));
    
    const currentPrice = closes[closes.length - 1];
    const window = Math.min(this.config.srWindow, closes.length);
    
    // Find significant highs and lows
    const recentData = ohlcData.slice(-window);
    const supports = this.findSupportLevels(recentData, currentPrice);
    const resistances = this.findResistanceLevels(recentData, currentPrice);
    
    // Determine if price is near key levels
    const nearSupport = supports.some(level => 
      Math.abs(currentPrice - level) / currentPrice < this.config.srTolerance
    );
    
    const nearResistance = resistances.some(level => 
      Math.abs(currentPrice - level) / currentPrice < this.config.srTolerance
    );
    
    return {
      supports,
      resistances,
      nearSupport,
      nearResistance,
      currentPrice,
      range: {
        support: Math.max(...supports),
        resistance: Math.min(...resistances)
      }
    };
  }

  /**
   * Combine all analyses to determine final regime
   */
  determineRegime(analyses) {
    const { trend, volatility, volume, supportResistance } = analyses;
    
    let baseRegime = 'SIDEWAYS';
    let confidence = 0.5;
    let subType = '';
    
    // Primary regime from trend
    if (trend.direction === 'BULL' && trend.confidence > 0.6) {
      baseRegime = 'BULL';
      confidence = trend.confidence;
    } else if (trend.direction === 'BEAR' && trend.confidence > 0.6) {
      baseRegime = 'BEAR';
      confidence = trend.confidence;
    }
    
    // Modify based on volatility
    if (volatility.regime === 'HIGH') {
      subType = '_HIGH_VOL';
    } else if (volatility.regime === 'LOW') {
      subType = '_LOW_VOL';
    }
    
    // Final regime classification
    const regime = baseRegime + subType;
    
    return {
      regime,
      confidence,
      components: {
        trend: trend.direction,
        volatility: volatility.regime,
        volume: volume.regime,
        nearLevels: supportResistance.nearSupport || supportResistance.nearResistance
      },
      characteristics: {
        trending: trend.direction !== 'NEUTRAL',
        volatile: volatility.regime === 'HIGH',
        highVolume: volume.regime === 'HIGH',
        rangebound: supportResistance.nearSupport && supportResistance.nearResistance
      },
      rawAnalyses: analyses
    };
  }

  /**
   * Analyze market-wide regime from individual pair regimes
   */
  analyzeMarketWideRegime(pairRegimes) {
    const regimes = Object.values(pairRegimes);
    const regimeCounts = {};
    
    regimes.forEach(regime => {
      const baseRegime = regime.regime?.split('_')[0] || 'SIDEWAYS';
      regimeCounts[baseRegime] = (regimeCounts[baseRegime] || 0) + 1;
    });
    
    // Find dominant regime
    const dominantRegime = Object.keys(regimeCounts)
      .reduce((a, b) => regimeCounts[a] > regimeCounts[b] ? a : b);
    
    const dominantPercentage = regimeCounts[dominantRegime] / regimes.length;
    
    return {
      dominant: dominantRegime,
      percentage: dominantPercentage,
      distribution: regimeCounts,
      consensus: dominantPercentage > 0.6 ? 'STRONG' : 'WEAK',
      timestamp: new Date().toISOString()
    };
  }

  // Utility methods (keeping only those not in shared modules)

  findSupportLevels(ohlcData, currentPrice) {
    const lows = ohlcData.map(candle => parseFloat(candle[3]));
    const supports = [];
    
    // Find local minima
    for (let i = 1; i < lows.length - 1; i++) {
      if (lows[i] < lows[i-1] && lows[i] < lows[i+1]) {
        if (lows[i] < currentPrice) { // Only supports below current price
          supports.push(lows[i]);
        }
      }
    }
    
    return supports.sort((a, b) => b - a).slice(0, 3); // Top 3 closest supports
  }

  findResistanceLevels(ohlcData, currentPrice) {
    const highs = ohlcData.map(candle => parseFloat(candle[2]));
    const resistances = [];
    
    // Find local maxima
    for (let i = 1; i < highs.length - 1; i++) {
      if (highs[i] > highs[i-1] && highs[i] > highs[i+1]) {
        if (highs[i] > currentPrice) { // Only resistances above current price
          resistances.push(highs[i]);
        }
      }
    }
    
    return resistances.sort((a, b) => a - b).slice(0, 3); // Top 3 closest resistances
  }

  async fetchOHLCData(pair, timeframe = '1h') {
    const intervals = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
    const interval = intervals[timeframe] || 60;
    
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.error && data.error.length > 0) {
        throw new Error(data.error.join(', '));
      }
      
      const pairKey = Object.keys(data.result).find(key => key !== 'last');
      return data.result[pairKey] || [];
      
    } catch (error) {
      throw new Error(`Failed to fetch OHLC data: ${error.message}`);
    }
  }

  getDefaultRegime() {
    return {
      regime: 'SIDEWAYS',
      confidence: 0.3,
      components: {
        trend: 'NEUTRAL',
        volatility: 'NORMAL',
        volume: 'NORMAL',
        nearLevels: false
      },
      characteristics: {
        trending: false,
        volatile: false,
        highVolume: false,
        rangebound: true
      }
    };
  }

  // Static convenience method
  static async detectForPair(pair, timeframe = '1h', config = {}) {
    const detector = new MarketRegimeDetector(config);
    return await detector.detectRegime(pair, timeframe);
  }
}

export default MarketRegimeDetector; 