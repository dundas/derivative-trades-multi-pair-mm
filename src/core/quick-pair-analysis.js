#!/usr/bin/env node
/**
 * Quick Pair Analysis
 * 
 * Fast analysis focusing on futures update frequency to identify best trading pairs
 * This is the simplified version that focuses on the confirmed edge
 */

import dotenv from 'dotenv';
dotenv.config();

import { KrakenFuturesWebSocketClient } from '../../lib/exchanges/KrakenFuturesWebSocketClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'QuickPairAnalysis' });

// Focus on major pairs with confirmed high priority
const MAJOR_PAIRS = {
  'BTC/USD': { futures: 'PF_XBTUSD', priority: 10 },
  'ETH/USD': { futures: 'PF_ETHUSD', priority: 9 },
  'SOL/USD': { futures: 'PF_SOLUSD', priority: 8 },
  'XRP/USD': { futures: 'PF_XRPUSD', priority: 7 },
  'ADA/USD': { futures: 'PF_ADAUSD', priority: 7 }
};

class QuickPairAnalyzer {
  constructor() {
    this.futuresClient = null;
    this.updateCounts = new Map();
    this.priceData = new Map();
    this.startTime = null;
    
    // Initialize tracking
    Object.keys(MAJOR_PAIRS).forEach(pair => {
      this.updateCounts.set(pair, 0);
      this.priceData.set(pair, {
        prices: [],
        volatility: 0,
        spread: 0
      });
    });
  }
  
  async initialize() {
    logger.info('🚀 Initializing Quick Pair Analyzer...');
    
    this.futuresClient = new KrakenFuturesWebSocketClient({ logger });
    await this.futuresClient.connect(false);
    
    // Set up futures data handler
    this.futuresClient.on('orderBookUpdate', (data) => {
      const normalizedPair = this.normalizePair(data.symbol);
      if (normalizedPair && data.midPrice) {
        this.updateCounts.set(normalizedPair, this.updateCounts.get(normalizedPair) + 1);
        
        const pairData = this.priceData.get(normalizedPair);
        pairData.prices.push({ price: data.midPrice, timestamp: Date.now() });
        
        // Keep only recent prices for volatility calculation
        if (pairData.prices.length > 50) {
          pairData.prices.shift();
        }
        
        // Calculate spread if we have bid/ask
        if (data.bids && data.asks && data.bids.length > 0 && data.asks.length > 0) {
          const spread = ((data.asks[0].price - data.bids[0].price) / data.bids[0].price) * 10000;
          pairData.spread = spread;
        }
      }
    });
    
    logger.info('✅ Quick analyzer initialized');
  }
  
  async analyzeUpdateFrequencies(durationSeconds = 30) {
    logger.info(`📊 Analyzing futures update frequencies for ${durationSeconds} seconds...`);
    
    this.startTime = Date.now();
    
    // Subscribe to all major pairs
    const futuresPairs = Object.values(MAJOR_PAIRS).map(p => p.futures);
    await this.futuresClient.subscribe('book', futuresPairs);
    
    // Monitor for specified duration
    await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000));
    
    return this.generateResults(durationSeconds);
  }
  
  generateResults(durationSeconds) {
    const endTime = Date.now();
    const actualDuration = (endTime - this.startTime) / 1000;
    
    const results = [];
    
    for (const [pair, mapping] of Object.entries(MAJOR_PAIRS)) {
      const updateCount = this.updateCounts.get(pair);
      const pairData = this.priceData.get(pair);
      const updatesPerSecond = updateCount / actualDuration;
      
      // Calculate volatility
      const volatility = this.calculateVolatility(pairData.prices);
      
      // Score based on update frequency and priority
      const frequencyScore = Math.min(50, updatesPerSecond * 2); // Cap at 50
      const priorityScore = mapping.priority * 3; // Up to 30 points
      const activityScore = Math.min(20, volatility * 1000); // Volatility contribution
      
      const totalScore = frequencyScore + priorityScore + activityScore;
      
      results.push({
        pair,
        updateCount,
        updatesPerSecond: updatesPerSecond.toFixed(1),
        volatility: (volatility * 100).toFixed(3),
        spread: pairData.spread.toFixed(2),
        priority: mapping.priority,
        score: totalScore.toFixed(1),
        ranking: 0 // Will be set after sorting
      });
    }
    
    // Sort by score
    results.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
    
    // Add rankings
    results.forEach((result, index) => {
      result.ranking = index + 1;
    });
    
    return {
      duration: actualDuration,
      results,
      summary: {
        totalUpdates: results.reduce((sum, r) => sum + r.updateCount, 0),
        avgUpdatesPerSecond: (results.reduce((sum, r) => sum + parseFloat(r.updatesPerSecond), 0) / results.length).toFixed(1),
        topPair: results[0]?.pair || 'None',
        topScore: results[0]?.score || '0'
      }
    };
  }
  
  calculateVolatility(prices) {
    if (prices.length < 5) return 0;
    
    const recentPrices = prices.slice(-20).map(p => p.price);
    const returns = [];
    
    for (let i = 1; i < recentPrices.length; i++) {
      const returnRate = (recentPrices[i] - recentPrices[i-1]) / recentPrices[i-1];
      returns.push(returnRate);
    }
    
    if (returns.length === 0) return 0;
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }
  
  normalizePair(futuresSymbol) {
    for (const [pair, mapping] of Object.entries(MAJOR_PAIRS)) {
      if (mapping.futures === futuresSymbol) {
        return pair;
      }
    }
    return null;
  }
  
  displayResults(analysis) {
    logger.info('\n' + '='.repeat(70));
    logger.info('📊 QUICK FUTURES PAIR ANALYSIS RESULTS');
    logger.info('='.repeat(70));
    
    logger.info(`\n⏱️  Analysis Duration: ${analysis.duration.toFixed(1)} seconds`);
    logger.info(`📈 Total Updates: ${analysis.summary.totalUpdates}`);
    logger.info(`📊 Average Updates/sec: ${analysis.summary.avgUpdatesPerSecond}`);
    
    logger.info('\n🏆 PAIR RANKINGS:');
    logger.info('-'.repeat(70));
    logger.info('Rank | Pair     | Updates | Updates/sec | Volatility | Score');
    logger.info('-'.repeat(70));
    
    analysis.results.forEach(result => {
      const rank = result.ranking.toString().padStart(4);
      const pair = result.pair.padEnd(8);
      const updates = result.updateCount.toString().padStart(7);
      const updatesPerSec = result.updatesPerSecond.padStart(11);
      const volatility = (result.volatility + '%').padStart(10);
      const score = result.score.padStart(5);
      
      logger.info(`${rank} | ${pair} | ${updates} | ${updatesPerSec} | ${volatility} | ${score}`);
    });
    
    logger.info('-'.repeat(70));
    
    logger.info('\n🎯 TOP 3 RECOMMENDED PAIRS:');
    const top3 = analysis.results.slice(0, 3);
    top3.forEach((result, i) => {
      logger.info(`  ${i + 1}. ${result.pair} - ${result.updatesPerSecond} updates/sec (Score: ${result.score})`);
    });
    
    logger.info('\n💡 TRADING EDGE ANALYSIS:');
    const topPair = analysis.results[0];
    if (topPair && parseFloat(topPair.updatesPerSecond) > 100) {
      logger.info('✅ EXCELLENT FUTURES EDGE CONFIRMED!');
      logger.info(`   Top pair (${topPair.pair}) provides ${topPair.updatesPerSecond} updates/second`);
      logger.info('   This high frequency gives significant timing advantages');
    } else if (topPair && parseFloat(topPair.updatesPerSecond) > 50) {
      logger.info('⚠️  GOOD FUTURES EDGE - Deploy with moderate confidence');
    } else {
      logger.info('❌ LIMITED EDGE - Consider different market conditions');
    }
    
    logger.info('\n' + '='.repeat(70));
  }
  
  async cleanup() {
    if (this.futuresClient) {
      this.futuresClient.disconnect();
    }
  }
  
  async saveResults(analysis) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `quick-pair-analysis-${timestamp}.json`;
    
    try {
      const fs = await import('fs');
      fs.writeFileSync(filename, JSON.stringify(analysis, null, 2));
      logger.info(`💾 Results saved to: ${filename}`);
    } catch (error) {
      logger.warn('⚠️  Failed to save results:', error.message);
    }
  }
}

async function runQuickAnalysis() {
  const analyzer = new QuickPairAnalyzer();
  
  try {
    logger.info('🚀 Starting Quick Futures Pair Analysis\n');
    
    await analyzer.initialize();
    const analysis = await analyzer.analyzeUpdateFrequencies(30);
    
    analyzer.displayResults(analysis);
    await analyzer.saveResults(analysis);
    
    await analyzer.cleanup();
    
    logger.info('\n✅ Quick analysis completed successfully!');
    return analysis.results.slice(0, 3).map(r => r.pair);
    
  } catch (error) {
    logger.error('❌ Quick analysis failed:', error);
    await analyzer.cleanup();
    throw error;
  }
}

// Export for module use
export { QuickPairAnalyzer };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runQuickAnalysis().catch(console.error);
}