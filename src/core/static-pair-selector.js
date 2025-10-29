#!/usr/bin/env node
/**
 * Static Pair Selector
 * 
 * Uses a curated list of major trading pairs with known volume and futures availability
 * This is the fastest and most reliable approach for production use
 */

import dotenv from 'dotenv';
dotenv.config();

import { LoggerFactory } from '../../utils/logger-factory.js';
import fs from 'fs';

const logger = LoggerFactory.createLogger({ component: 'StaticPairSelector' });

// Curated list of major pairs with confirmed high volume and futures availability
// Based on historical data and market knowledge
const MAJOR_TRADING_PAIRS = [
  {
    pair: 'BTC/USD',
    spot: 'XBT/USD',
    futures: 'PF_XBTUSD',
    priority: 10,
    estimatedVolume24h: 500000000,  // ~$500M daily volume
    estimatedSpread: 8,             // ~8 basis points
    marketCap: 'large',
    volatility: 'moderate',
    liquidity: 'excellent'
  },
  {
    pair: 'ETH/USD', 
    spot: 'ETH/USD',
    futures: 'PF_ETHUSD',
    priority: 9,
    estimatedVolume24h: 300000000,  // ~$300M daily volume
    estimatedSpread: 10,            // ~10 basis points
    marketCap: 'large',
    volatility: 'moderate',
    liquidity: 'excellent'
  },
  {
    pair: 'SOL/USD',
    spot: 'SOL/USD', 
    futures: 'PF_SOLUSD',
    priority: 8,
    estimatedVolume24h: 150000000,  // ~$150M daily volume
    estimatedSpread: 15,            // ~15 basis points
    marketCap: 'large',
    volatility: 'high',
    liquidity: 'good'
  },
  {
    pair: 'XRP/USD',
    spot: 'XRP/USD',
    futures: 'PF_XRPUSD', 
    priority: 7,
    estimatedVolume24h: 100000000,  // ~$100M daily volume
    estimatedSpread: 12,            // ~12 basis points
    marketCap: 'large',
    volatility: 'high',
    liquidity: 'good'
  },
  {
    pair: 'ADA/USD',
    spot: 'ADA/USD',
    futures: 'PF_ADAUSD',
    priority: 7,
    estimatedVolume24h: 80000000,   // ~$80M daily volume
    estimatedSpread: 18,            // ~18 basis points
    marketCap: 'medium',
    volatility: 'high', 
    liquidity: 'good'
  },
  {
    pair: 'DOT/USD',
    spot: 'DOT/USD',
    futures: 'PF_DOTUSD',
    priority: 6,
    estimatedVolume24h: 50000000,   // ~$50M daily volume
    estimatedSpread: 20,            // ~20 basis points
    marketCap: 'medium',
    volatility: 'high',
    liquidity: 'moderate'
  },
  {
    pair: 'UNI/USD',
    spot: 'UNI/USD', 
    futures: 'PF_UNIUSD',
    priority: 6,
    estimatedVolume24h: 40000000,   // ~$40M daily volume
    estimatedSpread: 25,            // ~25 basis points
    marketCap: 'medium',
    volatility: 'high',
    liquidity: 'moderate'
  },
  {
    pair: 'LTC/USD',
    spot: 'LTC/USD',
    futures: 'PF_LTCUSD',
    priority: 5,
    estimatedVolume24h: 30000000,   // ~$30M daily volume
    estimatedSpread: 22,            // ~22 basis points
    marketCap: 'medium', 
    volatility: 'moderate',
    liquidity: 'moderate'
  }
];

class StaticPairSelector {
  constructor(config = {}) {
    this.config = {
      targetPairs: 5,         // Number of pairs to select
      minVolume24h: 50000000, // Minimum $50M daily volume
      maxSpreadBps: 30,       // Maximum 30 basis points spread
      priorityWeight: 0.4,    // Weight for priority score
      volumeWeight: 0.3,      // Weight for volume score
      spreadWeight: 0.2,      // Weight for spread score (inverted)
      liquidityWeight: 0.1,   // Weight for liquidity score
      ...config
    };
    
    this.selectedPairs = [];
    this.analysis = null;
  }
  
  async initialize() {
    logger.info('🚀 Initializing Static Pair Selector...');
    logger.info(`📊 Analyzing ${MAJOR_TRADING_PAIRS.length} curated major trading pairs`);
    logger.info('✅ Static selector initialized (no API calls needed)');
  }
  
  calculatePairScore(pairData) {
    // Normalize each component to 0-100 scale
    
    // Priority score (0-100) - based on market importance
    const priorityScore = (pairData.priority / 10) * 100;
    
    // Volume score (0-100) - logarithmic scale
    const volumeScore = Math.min(100, (Math.log10(pairData.estimatedVolume24h / 1000000) / 3) * 100);
    
    // Spread score (0-100) - inverted, lower spread is better
    const spreadScore = Math.max(0, 100 - (pairData.estimatedSpread * 2));
    
    // Liquidity score (0-100) - categorical mapping
    const liquidityMap = { 'excellent': 100, 'good': 75, 'moderate': 50, 'poor': 25 };
    const liquidityScore = liquidityMap[pairData.liquidity] || 50;
    
    // Weighted composite score
    const compositeScore = 
      (priorityScore * this.config.priorityWeight) +
      (volumeScore * this.config.volumeWeight) +
      (spreadScore * this.config.spreadWeight) +
      (liquidityScore * this.config.liquidityWeight);
    
    return Math.round(compositeScore * 10) / 10; // Round to 1 decimal
  }
  
  filterAndRankPairs() {
    logger.info('📊 Filtering and ranking trading pairs...');
    
    // Filter pairs based on criteria
    const eligiblePairs = MAJOR_TRADING_PAIRS.filter(pair => {
      const meetsVolume = pair.estimatedVolume24h >= this.config.minVolume24h;
      const meetsSpread = pair.estimatedSpread <= this.config.maxSpreadBps;
      
      if (!meetsVolume) {
        logger.debug(`Filtered out ${pair.pair} - volume too low: $${(pair.estimatedVolume24h/1000000).toFixed(0)}M`);
      }
      if (!meetsSpread) {
        logger.debug(`Filtered out ${pair.pair} - spread too wide: ${pair.estimatedSpread}bps`);
      }
      
      return meetsVolume && meetsSpread;
    });
    
    // Calculate scores and rank
    const rankedPairs = eligiblePairs.map(pair => ({
      ...pair,
      score: this.calculatePairScore(pair),
      // Additional metrics for analysis
      metrics: {
        volumeRank: this.getVolumeRank(pair, eligiblePairs),
        liquidityRank: this.getLiquidityRank(pair, eligiblePairs),
        spreadRank: this.getSpreadRank(pair, eligiblePairs),
        volatilityProfile: pair.volatility,
        marketCapTier: pair.marketCap
      }
    }));
    
    // Sort by score (highest first)
    rankedPairs.sort((a, b) => b.score - a.score);
    
    logger.info(`✅ Ranked ${rankedPairs.length} eligible pairs:`);
    rankedPairs.forEach((pair, i) => {
      logger.info(`  ${i + 1}. ${pair.pair} - Score: ${pair.score} | Vol: $${(pair.estimatedVolume24h/1000000).toFixed(0)}M | Spread: ${pair.estimatedSpread}bps`);
    });
    
    return rankedPairs;
  }
  
  selectTopPairs(rankedPairs) {
    const topPairs = rankedPairs.slice(0, this.config.targetPairs);
    
    logger.info(`🎯 Selected top ${topPairs.length} pairs for multi-pair trading:`);
    
    topPairs.forEach((pair, i) => {
      logger.info(`  ${i + 1}. ${pair.pair} (${pair.futures})`);
      logger.info(`     Score: ${pair.score} | Priority: ${pair.priority}/10`);
      logger.info(`     Volume: $${(pair.estimatedVolume24h/1000000).toFixed(0)}M | Spread: ${pair.estimatedSpread}bps`);
      logger.info(`     Liquidity: ${pair.liquidity} | Volatility: ${pair.volatility}`);
    });
    
    this.selectedPairs = topPairs;
    return topPairs.map(p => p.pair);
  }
  
  // Helper methods for ranking
  getVolumeRank(pair, allPairs) {
    const sorted = allPairs.sort((a, b) => b.estimatedVolume24h - a.estimatedVolume24h);
    return sorted.findIndex(p => p.pair === pair.pair) + 1;
  }
  
  getLiquidityRank(pair, allPairs) {
    const liquidityOrder = { 'excellent': 4, 'good': 3, 'moderate': 2, 'poor': 1 };
    const sorted = allPairs.sort((a, b) => liquidityOrder[b.liquidity] - liquidityOrder[a.liquidity]);
    return sorted.findIndex(p => p.pair === pair.pair) + 1;
  }
  
  getSpreadRank(pair, allPairs) {
    const sorted = allPairs.sort((a, b) => a.estimatedSpread - b.estimatedSpread); // Lower spread is better
    return sorted.findIndex(p => p.pair === pair.pair) + 1;
  }
  
  async runAnalysis() {
    logger.info('🚀 Starting Static Pair Selection Analysis...\n');
    
    const startTime = Date.now();
    
    try {
      // Step 1: Filter and rank pairs
      const rankedPairs = this.filterAndRankPairs();
      
      if (rankedPairs.length === 0) {
        throw new Error('No pairs meet the selection criteria');
      }
      
      // Step 2: Select top pairs
      const selectedPairNames = this.selectTopPairs(rankedPairs);
      
      // Step 3: Generate comprehensive analysis
      this.analysis = {
        timestamp: new Date().toISOString(),
        method: 'Static curated pair selection',
        config: this.config,
        totalPairsAnalyzed: MAJOR_TRADING_PAIRS.length,
        eligiblePairs: rankedPairs.length,
        selectedPairs: selectedPairNames,
        selectedPairsData: this.selectedPairs,
        allRankedPairs: rankedPairs,
        executionTime: Date.now() - startTime,
        summary: {
          topPair: selectedPairNames[0] || 'None',
          avgVolume: this.selectedPairs.length > 0 ? 
            (this.selectedPairs.reduce((sum, p) => sum + p.estimatedVolume24h, 0) / this.selectedPairs.length / 1000000).toFixed(0) + 'M' : '0M',
          avgSpread: this.selectedPairs.length > 0 ? 
            (this.selectedPairs.reduce((sum, p) => sum + p.estimatedSpread, 0) / this.selectedPairs.length).toFixed(1) + 'bps' : '0bps',
          avgScore: this.selectedPairs.length > 0 ? 
            (this.selectedPairs.reduce((sum, p) => sum + p.score, 0) / this.selectedPairs.length).toFixed(1) : '0',
          futuresAvailable: this.selectedPairs.length // All have futures
        }
      };
      
      // Step 4: Save results
      await this.saveResults(this.analysis);
      
      logger.info('\n✅ Static Pair Selection Complete!');
      logger.info(`⏱️  Execution time: ${this.analysis.executionTime}ms`);
      logger.info(`🎯 Selected pairs: ${selectedPairNames.join(', ')}`);
      logger.info(`📊 Average volume: $${this.analysis.summary.avgVolume}`);
      logger.info(`📏 Average spread: ${this.analysis.summary.avgSpread}`);
      logger.info(`🏆 Average score: ${this.analysis.summary.avgScore}`);
      
      return this.analysis;
      
    } catch (error) {
      logger.error('❌ Static pair selection failed:', error.message);
      throw error;
    }
  }
  
  async saveResults(analysis) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Save detailed analysis
      const detailedFilename = `static-pair-analysis-${timestamp}.json`;
      fs.writeFileSync(detailedFilename, JSON.stringify(analysis, null, 2));
      
      // Save consumable pair list for multi-pair trader
      const pairList = {
        timestamp: analysis.timestamp,
        method: 'Static curated selection',
        selectedPairs: analysis.selectedPairs,
        pairMappings: {},
        summary: analysis.summary,
        lastUpdate: analysis.timestamp,
        nextUpdate: 'Manual - pairs are curated and stable'
      };
      
      // Create mappings for selected pairs
      this.selectedPairs.forEach(pair => {
        pairList.pairMappings[pair.pair] = {
          spot: pair.spot,
          futures: pair.futures,
          priority: pair.priority,
          score: pair.score,
          estimatedVolume24h: pair.estimatedVolume24h,
          estimatedSpread: pair.estimatedSpread,
          liquidity: pair.liquidity,
          volatility: pair.volatility,
          marketCap: pair.marketCap
        };
      });
      
      fs.writeFileSync('selected-trading-pairs.json', JSON.stringify(pairList, null, 2));
      
      // Also save simplified format for easy integration
      const simplePairList = {
        pairs: analysis.selectedPairs,
        mappings: Object.fromEntries(
          this.selectedPairs.map(p => [p.pair, { spot: p.spot, futures: p.futures }])
        ),
        updated: analysis.timestamp
      };
      
      fs.writeFileSync('top-pairs-simple.json', JSON.stringify(simplePairList, null, 2));
      
      logger.info(`💾 Results saved:`);
      logger.info(`   • ${detailedFilename} (detailed analysis)`);
      logger.info(`   • selected-trading-pairs.json (full data for multi-pair trader)`);
      logger.info(`   • top-pairs-simple.json (simplified format)`);
      
    } catch (error) {
      logger.warn('⚠️  Failed to save results:', error.message);
    }
  }
  
  // Quick selection method for immediate use
  static getTopPairs(count = 5) {
    const selector = new StaticPairSelector({ targetPairs: count });
    const rankedPairs = selector.filterAndRankPairs();
    return rankedPairs.slice(0, count).map(p => p.pair);
  }
  
  // Get pair mappings for a specific pair
  static getPairMapping(pair) {
    const pairData = MAJOR_TRADING_PAIRS.find(p => p.pair === pair);
    return pairData ? { spot: pairData.spot, futures: pairData.futures } : null;
  }
}

async function runStaticAnalysis() {
  const selector = new StaticPairSelector({
    targetPairs: 5,           // Select top 5
    minVolume24h: 50000000,   // $50M minimum
    maxSpreadBps: 25          // 25bps maximum
  });
  
  try {
    await selector.initialize();
    const analysis = await selector.runAnalysis();
    
    logger.info('\n🎉 Analysis complete! Ready for multi-pair trading deployment.');
    logger.info('\n📋 RECOMMENDATIONS:');
    logger.info('• Use selected-trading-pairs.json for MultiPairOpportunisticTrader');
    logger.info('• All selected pairs have confirmed futures markets');
    logger.info('• Pairs are ranked by volume, spread, and liquidity');
    logger.info('• No API rate limits or external dependencies');
    
    return analysis.selectedPairs;
    
  } catch (error) {
    logger.error('💥 Static analysis failed:', error);
    throw error;
  }
}

// Export for module use
export { StaticPairSelector };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStaticAnalysis().catch(console.error);
}