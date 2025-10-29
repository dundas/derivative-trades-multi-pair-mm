#!/usr/bin/env node
/**
 * REST-Based Pair Selector
 * 
 * Uses Kraken REST API to discover and rank trading pairs similar to simulation-to-session.js
 * Focus on volume, spreads, and market activity to identify top pairs for multi-pair trading
 */

import dotenv from 'dotenv';
dotenv.config();

import { KrakenRESTClient } from '../../lib/exchanges/KrakenRESTClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';
import fs from 'fs';

const logger = LoggerFactory.createLogger({ component: 'RESTBasedPairSelector' });

// Futures mapping for pairs that have both spot and futures
const FUTURES_MAPPING = {
  'BTC/USD': 'PF_XBTUSD',
  'ETH/USD': 'PF_ETHUSD', 
  'SOL/USD': 'PF_SOLUSD',
  'XRP/USD': 'PF_XRPUSD',
  'ADA/USD': 'PF_ADAUSD',
  'DOT/USD': 'PF_DOTUSD',
  'UNI/USD': 'PF_UNIUSD',
  'LTC/USD': 'PF_LTCUSD',
  'LINK/USD': 'PF_LINKUSD',
  'MATIC/USD': 'PF_MATICUSD',
  'ATOM/USD': 'PF_ATOMUSD',
  'AVAX/USD': 'PF_AVAXUSD'
};

class RESTBasedPairSelector {
  constructor(config = {}) {
    this.config = {
      maxPairs: 10,           // Maximum pairs to analyze
      minVolume24h: 1000000,  // Minimum $1M 24h volume
      quoteCurrency: 'USD',   // Focus on USD pairs
      excludeDerivatives: true,
      targetPairs: 5,         // Target number of pairs to select
      maxSpreadBps: 50,       // Maximum 50 basis points spread
      minLiquidity: 500000,   // Minimum $500k liquidity
      requireFutures: true,   // Only select pairs with futures markets
      ...config
    };
    
    this.krakenClient = null;
    this.results = [];
  }
  
  async initialize() {
    logger.info('🚀 Initializing REST-Based Pair Selector...');
    
    // Initialize Kraken REST client
    this.krakenClient = new KrakenRESTClient({
      apiKey: process.env.KRAKEN_API_KEY,
      apiSecret: process.env.KRAKEN_API_SECRET,
      logger: {
        info: (msg, data) => logger.debug(msg, data),
        warn: (msg, data) => logger.warn(msg, data),
        error: (msg, data) => logger.error(msg, data),
        debug: (msg, data) => {} // Silent debug
      }
    });
    
    logger.info('✅ REST client initialized');
  }
  
  async discoverTopPairs() {
    logger.info('🔍 Discovering top trading pairs using REST API...');
    
    try {
      // Use the same method as simulation-to-session.js
      const topPairsResult = await this.krakenClient.getTopPairsByVolume({
        count: this.config.maxPairs,
        quoteCurrency: this.config.quoteCurrency,
        excludeDerivatives: this.config.excludeDerivatives,
        minVolume: this.config.minVolume24h
      });
      
      if (!topPairsResult.success || !topPairsResult.data) {
        throw new Error('Failed to get top pairs by volume');
      }
      
      logger.info(`✅ Found ${topPairsResult.data.length} high-volume pairs`);
      
      // Filter for pairs that have futures markets if required
      const eligiblePairs = [];
      
      for (const pairData of topPairsResult.data) {
        const pair = pairData.pair;
        const hasFutures = FUTURES_MAPPING[pair] !== undefined;
        
        // Skip if futures required but not available
        if (this.config.requireFutures && !hasFutures) {
          logger.debug(`Skipping ${pair} - no futures market`);
          continue;
        }
        
        // Apply quality filters
        const volume24h = pairData.volume24h || 0;
        const spreadBps = pairData.spreadBps || 0;
        
        if (volume24h < this.config.minVolume24h) {
          logger.debug(`Skipping ${pair} - volume too low: $${(volume24h/1000000).toFixed(1)}M`);
          continue;
        }
        
        if (spreadBps > this.config.maxSpreadBps) {
          logger.debug(`Skipping ${pair} - spread too wide: ${spreadBps.toFixed(1)}bps`);
          continue;
        }
        
        // Calculate composite score
        const score = this.calculatePairScore(pairData, hasFutures);
        
        eligiblePairs.push({
          pair,
          futuresSymbol: FUTURES_MAPPING[pair] || null,
          hasFutures,
          volume24h,
          spreadBps,
          score,
          metrics: {
            currentPrice: pairData.currentPrice,
            priceChange24h: pairData.priceChange24h,
            high24h: pairData.high24h,
            low24h: pairData.low24h,
            volatility: this.calculateVolatility(pairData),
            liquidity: this.calculateLiquidity(pairData)
          },
          rawData: pairData
        });
      }
      
      // Sort by score (highest first)
      eligiblePairs.sort((a, b) => b.score - a.score);
      
      logger.info(`📊 Ranked ${eligiblePairs.length} eligible pairs:`);
      eligiblePairs.slice(0, 8).forEach((pair, i) => {
        const futuresIndicator = pair.hasFutures ? '✅' : '❌';
        logger.info(`  ${i + 1}. ${pair.pair} ${futuresIndicator} - Score: ${pair.score.toFixed(1)} | Vol: $${(pair.volume24h/1000000).toFixed(1)}M | Spread: ${pair.spreadBps.toFixed(1)}bps`);
      });
      
      this.results = eligiblePairs;
      return eligiblePairs;
      
    } catch (error) {
      logger.error('❌ Failed to discover top pairs:', error.message);
      throw error;
    }
  }
  
  calculatePairScore(pairData, hasFutures) {
    // Volume score (0-40 points) - logarithmic scale
    const volumeScore = Math.min(40, Math.log10(pairData.volume24h / 1000000) * 15);
    
    // Spread score (0-25 points) - lower spread is better
    const spreadScore = Math.max(0, 25 - (pairData.spreadBps / 2));
    
    // Price change score (0-15 points) - moderate volatility is good
    const priceChange = Math.abs(pairData.priceChange24h || 0);
    const volatilityScore = Math.max(0, 15 - Math.abs(priceChange - 3) * 2); // Optimal around 3%
    
    // Futures availability bonus (0-20 points)
    const futuresBonus = hasFutures ? 20 : 0;
    
    return volumeScore + spreadScore + volatilityScore + futuresBonus;
  }
  
  calculateVolatility(pairData) {
    const high = pairData.high24h || 0;
    const low = pairData.low24h || 0;
    const current = pairData.currentPrice || 0;
    
    if (current <= 0) return 0;
    
    return ((high - low) / current) * 100; // Percentage volatility
  }
  
  calculateLiquidity(pairData) {
    // Estimate liquidity based on volume and spread
    const volume = pairData.volume24h || 0;
    const spread = pairData.spreadBps || 100;
    
    // Higher volume, lower spread = better liquidity
    return (volume / 1000000) * (100 / Math.max(spread, 1));
  }
  
  selectTopPairs() {
    if (this.results.length === 0) {
      logger.warn('⚠️  No pairs available for selection');
      return [];
    }
    
    const topPairs = this.results.slice(0, this.config.targetPairs);
    
    logger.info(`🎯 Selected top ${topPairs.length} pairs for multi-pair trading:`);
    
    topPairs.forEach((pair, i) => {
      logger.info(`  ${i + 1}. ${pair.pair} (${pair.futuresSymbol || 'No futures'})`);
      logger.info(`     Score: ${pair.score.toFixed(1)} | Volume: $${(pair.volume24h/1000000).toFixed(1)}M`);
      logger.info(`     Spread: ${pair.spreadBps.toFixed(1)}bps | Volatility: ${pair.metrics.volatility.toFixed(1)}%`);
      logger.info(`     Current Price: $${pair.metrics.currentPrice?.toFixed(4) || 'N/A'}`);
    });
    
    return topPairs.map(p => p.pair);
  }
  
  async runAnalysis() {
    logger.info('🚀 Starting REST-Based Pair Selection Analysis...\n');
    
    const startTime = Date.now();
    
    try {
      // Step 1: Discover pairs using REST API
      const eligiblePairs = await this.discoverTopPairs();
      
      if (eligiblePairs.length === 0) {
        throw new Error('No eligible trading pairs found');
      }
      
      // Step 2: Select final pairs
      const selectedPairs = this.selectTopPairs();
      
      // Step 3: Generate analysis report
      const report = {
        timestamp: new Date().toISOString(),
        method: 'REST-based volume analysis',
        eligiblePairs: eligiblePairs.length,
        selectedPairs,
        detailedResults: this.results.slice(0, 10), // Top 10 for analysis
        config: this.config,
        executionTime: Date.now() - startTime,
        summary: {
          topPair: selectedPairs[0] || 'None',
          avgVolume: eligiblePairs.length > 0 ? 
            (eligiblePairs.reduce((sum, p) => sum + p.volume24h, 0) / eligiblePairs.length / 1000000).toFixed(1) + 'M' : '0M',
          avgSpread: eligiblePairs.length > 0 ? 
            (eligiblePairs.reduce((sum, p) => sum + p.spreadBps, 0) / eligiblePairs.length).toFixed(1) + 'bps' : '0bps',
          futuresAvailable: eligiblePairs.filter(p => p.hasFutures).length
        }
      };
      
      // Step 4: Save results
      await this.saveResults(report);
      
      logger.info('\n✅ REST-Based Pair Selection Complete!');
      logger.info(`⏱️  Execution time: ${report.executionTime}ms`);
      logger.info(`🎯 Selected pairs: ${selectedPairs.join(', ')}`);
      logger.info(`📊 Average volume: $${report.summary.avgVolume}`);
      logger.info(`📏 Average spread: ${report.summary.avgSpread}`);
      logger.info(`🚀 Futures available: ${report.summary.futuresAvailable}/${eligiblePairs.length} pairs`);
      
      return report;
      
    } catch (error) {
      logger.error('❌ REST-based pair selection failed:', error.message);
      throw error;
    }
  }
  
  async saveResults(report) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Save detailed report
      const detailedFilename = `rest-pair-selection-${timestamp}.json`;
      fs.writeFileSync(detailedFilename, JSON.stringify(report, null, 2));
      
      // Save simple pair list for consumption by other components
      const pairList = {
        timestamp: report.timestamp,
        method: 'REST-based',
        selectedPairs: report.selectedPairs,
        pairMappings: {},
        summary: report.summary,
        nextUpdate: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      };
      
      // Add futures mappings for selected pairs
      report.selectedPairs.forEach(pair => {
        const pairResult = this.results.find(r => r.pair === pair);
        if (pairResult) {
          pairList.pairMappings[pair] = {
            spot: pair,
            futures: pairResult.futuresSymbol,
            hasFutures: pairResult.hasFutures,
            score: pairResult.score,
            volume24h: pairResult.volume24h,
            spreadBps: pairResult.spreadBps
          };
        }
      });
      
      fs.writeFileSync('rest-selected-trading-pairs.json', JSON.stringify(pairList, null, 2));
      
      logger.info(`💾 Results saved:`);
      logger.info(`   • ${detailedFilename} (detailed analysis)`);
      logger.info(`   • rest-selected-trading-pairs.json (pair list with mappings)`);
      
    } catch (error) {
      logger.warn('⚠️  Failed to save results:', error.message);
    }
  }
}

async function runRESTBasedAnalysis() {
  const selector = new RESTBasedPairSelector({
    maxPairs: 15,           // Analyze more pairs
    targetPairs: 5,         // Select top 5
    requireFutures: true,   // Only pairs with futures
    minVolume24h: 2000000   // Higher volume requirement
  });
  
  try {
    await selector.initialize();
    const report = await selector.runAnalysis();
    
    logger.info('\n🎉 Analysis complete! Use rest-selected-trading-pairs.json for multi-pair trading setup.');
    return report.selectedPairs;
    
  } catch (error) {
    logger.error('💥 REST-based analysis failed:', error);
    throw error;
  }
}

// Export for module use
export { RESTBasedPairSelector };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runRESTBasedAnalysis().catch(console.error);
}