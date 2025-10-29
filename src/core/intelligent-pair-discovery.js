#!/usr/bin/env node
/**
 * Intelligent Pair Discovery
 * 
 * Uses the same discovery logic as DirectionBasedTimeHorizonDiscovery
 * to get the actual top performing pairs, then filters for futures availability
 */

import dotenv from 'dotenv';
dotenv.config();

import { KrakenRESTClient } from '../../lib/exchanges/KrakenRESTClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';
import fs from 'fs';

const logger = LoggerFactory.createLogger({ component: 'IntelligentPairDiscovery' });

// Known futures mappings for filtering
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
  'AVAX/USD': 'PF_AVAXUSD',
  'BCH/USD': 'PF_BCHUSD',
  'ALGO/USD': 'PF_ALGOUSD'
};

class IntelligentPairDiscovery {
  constructor(config = {}) {
    this.config = {
      maxPairs: 15,              // Get more pairs to filter from
      targetPairs: 5,            // Final number of pairs to select
      minVolume24h: 5000000,     // $5M minimum volume (lower for more options)
      quoteCurrency: 'USD',      // Focus on USD pairs
      excludeDerivatives: true,  // No derivatives in spot trading
      requireFutures: true,      // Only pairs with futures for edge opportunity
      minSpreadQuality: 50,      // Minimum spread quality threshold
      ...config
    };
    
    this.krakenClient = null;
    this.discoveredPairs = [];
    this.selectedPairs = [];
  }
  
  async initialize() {
    logger.info('🚀 Initializing Intelligent Pair Discovery...');
    
    // Create Kraken client with same configuration as DirectionBasedTimeHorizonDiscovery
    this.krakenClient = new KrakenRESTClient({
      baseUrl: process.env.KRAKEN_BASE_URL || 'https://api.kraken.com',
      apiKey: process.env.KRAKEN_API_KEY,
      apiSecret: process.env.KRAKEN_API_SECRET,
      logger: {
        info: (msg, data) => logger.debug(msg, data),
        warn: (msg, data) => logger.warn(msg, data),
        error: (msg, data) => logger.error(msg, data),
        debug: (msg, data) => {} // Silent debug
      }
    });
    
    logger.info('✅ Intelligent discovery initialized');
  }
  
  async discoverTopTradingPairs() {
    logger.info('🔍 Discovering top trading pairs by volume (using Kraken API)...');
    
    try {
      // Use the same method as DirectionBasedTimeHorizonDiscovery
      const topPairsResult = await this.krakenClient.getTopPairsByVolume({
        count: this.config.maxPairs,
        quoteCurrency: this.config.quoteCurrency,
        excludeDerivatives: this.config.excludeDerivatives,
        minVolume: this.config.minVolume24h
      });
      
      if (!topPairsResult.topPairs || topPairsResult.topPairs.length === 0) {
        logger.warn('⚠️  No pairs found from volume discovery, falling back to static list');
        return this.getFallbackPairs();
      }
      
      // Log the same detailed information
      logger.info('📊 Top pairs by volume:');
      topPairsResult.topPairs.forEach((pairData, i) => {
        const volumeM = (pairData.volumeInQuote / 1000000).toFixed(1);
        const spreadBps = pairData.spreadBps.toFixed(2);
        logger.info(`  ${i + 1}. ${pairData.pair}: $${volumeM}M volume, ${spreadBps} BPS spread`);
      });
      
      logger.info(`📈 Market Summary:`);
      logger.info(`  • Total pairs analyzed: ${topPairsResult.summary.totalPairsAnalyzed}`);
      logger.info(`  • Selected pairs: ${topPairsResult.summary.topPairsReturned}`);
      logger.info(`  • Total market volume: $${(topPairsResult.summary.totalMarketVolume / 1000000).toFixed(1)}M`);
      logger.info(`  • Selected pairs volume: $${(topPairsResult.summary.topPairsVolume / 1000000).toFixed(1)}M`);
      logger.info(`  • Market share: ${topPairsResult.summary.marketSharePercent.toFixed(1)}%`);
      logger.info(`  • Average spread: ${topPairsResult.summary.avgSpreadBps.toFixed(2)} BPS`);
      
      // Store the full data for later filtering
      this.discoveredPairs = topPairsResult.topPairs.map(pairData => ({
        pair: pairData.pair,
        volume24h: pairData.volumeInQuote,
        spreadBps: pairData.spreadBps,
        currentPrice: pairData.currentPrice,
        priceChange24h: pairData.priceChange24h,
        high24h: pairData.high24h,
        low24h: pairData.low24h,
        hasFutures: FUTURES_MAPPING[pairData.pair] !== undefined,
        futuresSymbol: FUTURES_MAPPING[pairData.pair] || null,
        // Calculate quality score
        qualityScore: this.calculateQualityScore(pairData)
      }));
      
      return this.discoveredPairs;
      
    } catch (error) {
      logger.error('❌ Failed to discover trading pairs via API:', error.message);
      logger.warn('⚠️  Falling back to static curated pairs');
      return this.getFallbackPairs();
    }
  }
  
  calculateQualityScore(pairData) {
    // Volume score (0-40 points) - logarithmic
    const volumeScore = Math.min(40, Math.log10(pairData.volumeInQuote / 1000000) * 12);
    
    // Spread score (0-30 points) - inverted, lower spread is better
    const spreadScore = Math.max(0, 30 - (pairData.spreadBps / 3));
    
    // Activity score (0-20 points) - based on price change
    const priceChange = Math.abs(pairData.priceChange24h || 0);
    const activityScore = Math.min(20, priceChange * 4); // 5% change = 20 points
    
    // Futures bonus (0-10 points)
    const futuresBonus = FUTURES_MAPPING[pairData.pair] ? 10 : 0;
    
    return volumeScore + spreadScore + activityScore + futuresBonus;
  }
  
  filterForFuturesAvailability() {
    logger.info('🚀 Filtering pairs for futures market availability...');
    
    // Filter for pairs with futures if required
    let eligiblePairs = this.discoveredPairs;
    
    if (this.config.requireFutures) {
      const futuresAvailable = eligiblePairs.filter(p => p.hasFutures);
      const futuresUnavailable = eligiblePairs.filter(p => !p.hasFutures);
      
      logger.info(`📊 Futures Availability Analysis:`);
      logger.info(`  • Pairs with futures: ${futuresAvailable.length}`);
      logger.info(`  • Pairs without futures: ${futuresUnavailable.length}`);
      
      if (futuresUnavailable.length > 0) {
        logger.info(`❌ Excluding pairs without futures:`);
        futuresUnavailable.forEach(pair => {
          logger.info(`     ${pair.pair} - $${(pair.volume24h/1000000).toFixed(1)}M volume (no futures)`);
        });
      }
      
      eligiblePairs = futuresAvailable;
    }
    
    // Sort by quality score
    eligiblePairs.sort((a, b) => b.qualityScore - a.qualityScore);
    
    logger.info(`✅ Eligible pairs for multi-pair trading:`);
    eligiblePairs.forEach((pair, i) => {
      const futuresIndicator = pair.hasFutures ? '✅' : '❌';
      logger.info(`  ${i + 1}. ${pair.pair} ${futuresIndicator} - Score: ${pair.qualityScore.toFixed(1)} | Vol: $${(pair.volume24h/1000000).toFixed(1)}M | Spread: ${pair.spreadBps.toFixed(1)}bps`);
    });
    
    return eligiblePairs;
  }
  
  selectTopPairs(eligiblePairs) {
    const topPairs = eligiblePairs.slice(0, this.config.targetPairs);
    
    logger.info(`🎯 Selected top ${topPairs.length} pairs for multi-pair trading:`);
    
    topPairs.forEach((pair, i) => {
      logger.info(`  ${i + 1}. ${pair.pair} (${pair.futuresSymbol})`);
      logger.info(`     Quality Score: ${pair.qualityScore.toFixed(1)}`);
      logger.info(`     Volume: $${(pair.volume24h/1000000).toFixed(1)}M | Spread: ${pair.spreadBps.toFixed(1)}bps`);
      logger.info(`     Current Price: $${pair.currentPrice?.toFixed(4) || 'N/A'} | 24h Change: ${(pair.priceChange24h || 0).toFixed(2)}%`);
    });
    
    this.selectedPairs = topPairs;
    return topPairs;
  }
  
  getFallbackPairs() {
    logger.warn('🔄 Using fallback static pairs (API unavailable)');
    
    // Return the top static pairs as fallback
    const fallbackPairs = [
      { pair: 'BTC/USD', volume24h: 500000000, spreadBps: 8, hasFutures: true, futuresSymbol: 'PF_XBTUSD', qualityScore: 90 },
      { pair: 'ETH/USD', volume24h: 300000000, spreadBps: 10, hasFutures: true, futuresSymbol: 'PF_ETHUSD', qualityScore: 85 },
      { pair: 'SOL/USD', volume24h: 150000000, spreadBps: 15, hasFutures: true, futuresSymbol: 'PF_SOLUSD', qualityScore: 75 },
      { pair: 'XRP/USD', volume24h: 100000000, spreadBps: 12, hasFutures: true, futuresSymbol: 'PF_XRPUSD', qualityScore: 70 },
      { pair: 'ADA/USD', volume24h: 80000000, spreadBps: 18, hasFutures: true, futuresSymbol: 'PF_ADAUSD', qualityScore: 65 }
    ];
    
    logger.info('📊 Using curated high-volume pairs:');
    fallbackPairs.forEach((pair, i) => {
      logger.info(`  ${i + 1}. ${pair.pair} - Vol: $${(pair.volume24h/1000000).toFixed(0)}M | Spread: ${pair.spreadBps}bps`);
    });
    
    return fallbackPairs;
  }
  
  async runIntelligentDiscovery() {
    logger.info('🧠 Starting Intelligent Pair Discovery Analysis...\n');
    
    const startTime = Date.now();
    
    try {
      // Step 1: Discover top pairs using real market data
      await this.discoverTopTradingPairs();
      
      if (this.discoveredPairs.length === 0) {
        throw new Error('No pairs discovered');
      }
      
      // Step 2: Filter for futures availability
      const eligiblePairs = this.filterForFuturesAvailability();
      
      if (eligiblePairs.length === 0) {
        throw new Error('No pairs with futures markets found');
      }
      
      // Step 3: Select final pairs
      const selectedPairs = this.selectTopPairs(eligiblePairs);
      
      // Step 4: Generate comprehensive report
      const report = {
        timestamp: new Date().toISOString(),
        method: 'Intelligent discovery (real market data + futures filtering)',
        totalDiscovered: this.discoveredPairs.length,
        eligiblePairs: eligiblePairs.length,
        selectedPairs: selectedPairs.map(p => p.pair),
        selectedPairsData: selectedPairs,
        allDiscoveredPairs: this.discoveredPairs,
        config: this.config,
        executionTime: Date.now() - startTime,
        summary: {
          topPair: selectedPairs[0]?.pair || 'None',
          avgVolume: selectedPairs.length > 0 ? 
            (selectedPairs.reduce((sum, p) => sum + p.volume24h, 0) / selectedPairs.length / 1000000).toFixed(1) + 'M' : '0M',
          avgSpread: selectedPairs.length > 0 ? 
            (selectedPairs.reduce((sum, p) => sum + p.spreadBps, 0) / selectedPairs.length).toFixed(1) + 'bps' : '0bps',
          avgQualityScore: selectedPairs.length > 0 ? 
            (selectedPairs.reduce((sum, p) => sum + p.qualityScore, 0) / selectedPairs.length).toFixed(1) : '0',
          futuresAvailable: selectedPairs.length,
          marketShare: this.discoveredPairs.length > 0 ? 
            ((selectedPairs.reduce((sum, p) => sum + p.volume24h, 0) / 
              this.discoveredPairs.reduce((sum, p) => sum + p.volume24h, 0)) * 100).toFixed(1) + '%' : '0%'
        }
      };
      
      // Step 5: Save results
      await this.saveResults(report);
      
      logger.info('\n✅ Intelligent Pair Discovery Complete!');
      logger.info(`⏱️  Execution time: ${report.executionTime}ms`);
      logger.info(`🎯 Selected pairs: ${report.selectedPairs.join(', ')}`);
      logger.info(`📊 Average volume: $${report.summary.avgVolume}`);
      logger.info(`📏 Average spread: ${report.summary.avgSpread}`);
      logger.info(`🏆 Average quality score: ${report.summary.avgQualityScore}`);
      logger.info(`📈 Market share captured: ${report.summary.marketShare}`);
      
      return report;
      
    } catch (error) {
      logger.error('❌ Intelligent pair discovery failed:', error.message);
      throw error;
    }
  }
  
  async saveResults(report) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Save detailed analysis
      const detailedFilename = `intelligent-pair-discovery-${timestamp}.json`;
      fs.writeFileSync(detailedFilename, JSON.stringify(report, null, 2));
      
      // Save consumable format for multi-pair trader
      const pairList = {
        timestamp: report.timestamp,
        method: 'Intelligent discovery (real market data)',
        selectedPairs: report.selectedPairs,
        pairMappings: {},
        summary: report.summary,
        dataSource: 'Kraken API live volume data',
        lastUpdate: report.timestamp,
        nextUpdate: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() // 12 hours
      };
      
      // Create detailed mappings for each selected pair
      this.selectedPairs.forEach(pair => {
        pairList.pairMappings[pair.pair] = {
          spot: pair.pair,
          futures: pair.futuresSymbol,
          volume24h: pair.volume24h,
          spreadBps: pair.spreadBps,
          qualityScore: pair.qualityScore,
          currentPrice: pair.currentPrice,
          priceChange24h: pair.priceChange24h,
          hasFutures: pair.hasFutures,
          dataSource: 'live'
        };
      });
      
      fs.writeFileSync('selected-trading-pairs.json', JSON.stringify(pairList, null, 2));
      
      // Also save simple format for quick integration
      const simplePairList = {
        pairs: report.selectedPairs,
        mappings: Object.fromEntries(
          this.selectedPairs.map(p => [p.pair, { 
            spot: p.pair, 
            futures: p.futuresSymbol,
            volume: p.volume24h,
            spread: p.spreadBps 
          }])
        ),
        source: 'intelligent_discovery',
        updated: report.timestamp
      };
      
      fs.writeFileSync('intelligent-pairs-simple.json', JSON.stringify(simplePairList, null, 2));
      
      logger.info(`💾 Results saved:`);
      logger.info(`   • ${detailedFilename} (detailed analysis)`);
      logger.info(`   • selected-trading-pairs.json (full data for multi-pair trader)`);
      logger.info(`   • intelligent-pairs-simple.json (simplified format)`);
      
    } catch (error) {
      logger.warn('⚠️  Failed to save results:', error.message);
    }
  }
}

async function runIntelligentDiscovery() {
  const discovery = new IntelligentPairDiscovery({
    maxPairs: 15,           // Discover top 15 pairs
    targetPairs: 5,         // Select best 5 for trading
    requireFutures: true,   // Only pairs with futures
    minVolume24h: 5000000   // $5M minimum volume
  });
  
  try {
    await discovery.initialize();
    const report = await discovery.runIntelligentDiscovery();
    
    logger.info('\n🎉 Discovery complete! Ready for multi-pair trading deployment.');
    logger.info('\n📋 RECOMMENDATIONS:');
    logger.info('• Pairs selected using real market volume data from Kraken API');
    logger.info('• All selected pairs have confirmed futures markets for edge opportunity');
    logger.info('• Quality scores combine volume, spread, activity, and futures availability');
    logger.info('• Use selected-trading-pairs.json for MultiPairOpportunisticTrader');
    
    return report.selectedPairs;
    
  } catch (error) {
    logger.error('💥 Intelligent discovery failed:', error);
    throw error;
  }
}

// Export for module use
export { IntelligentPairDiscovery };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntelligentDiscovery().catch(console.error);
}