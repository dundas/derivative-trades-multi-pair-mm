#!/usr/bin/env node
/**
 * Dynamic Pair Selector
 * 
 * Discovers and ranks the top 3-5 trading pairs based on:
 * 1. Availability on both Kraken spot and futures
 * 2. Futures edge opportunity (update frequency advantage)
 * 3. Real-time market activity and volatility
 * 4. Liquidity and spread conditions
 * 
 * Runs every 5 minutes to adapt to changing market conditions
 */

import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import { KrakenFuturesWebSocketClient } from '../../lib/exchanges/KrakenFuturesWebSocketClient.js';
import { KrakenRESTClient } from '../../lib/exchanges/KrakenRESTClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';
import fs from 'fs';

const logger = LoggerFactory.createLogger({ component: 'DynamicPairSelector' });

// Trading pair mappings between spot and futures
const PAIR_MAPPINGS = {
  'BTC/USD': { spot: 'XBT/USD', futures: 'PF_XBTUSD', priority: 10 },
  'ETH/USD': { spot: 'ETH/USD', futures: 'PF_ETHUSD', priority: 9 },
  'SOL/USD': { spot: 'SOL/USD', futures: 'PF_SOLUSD', priority: 8 },
  'ADA/USD': { spot: 'ADA/USD', futures: 'PF_ADAUSD', priority: 7 },
  'XRP/USD': { spot: 'XRP/USD', futures: 'PF_XRPUSD', priority: 7 },
  'DOT/USD': { spot: 'DOT/USD', futures: 'PF_DOTUSD', priority: 6 },
  'UNI/USD': { spot: 'UNI/USD', futures: 'PF_UNIUSD', priority: 6 },
  'LTC/USD': { spot: 'LTC/USD', futures: 'PF_LTCUSD', priority: 5 },
  'LINK/USD': { spot: 'LINK/USD', futures: 'PF_LINKUSD', priority: 5 },
  'MATIC/USD': { spot: 'MATIC/USD', futures: 'PF_MATICUSD', priority: 4 },
  'ATOM/USD': { spot: 'ATOM/USD', futures: 'PF_ATOMUSD', priority: 4 },
  'AVAX/USD': { spot: 'AVAX/USD', futures: 'PF_AVAXUSD', priority: 4 }
};

class DynamicPairSelector {
  constructor(config = {}) {
    this.config = {
      analysisWindow: 60000, // 1 minute analysis window
      minSpotUpdates: 1,      // Minimum spot updates required (very low since spot is less active)
      minFuturesUpdates: 50,  // Minimum futures updates required
      maxSpreadBps: 50,       // Maximum spread in basis points
      minVolume24h: 1000000,  // Minimum 24h volume
      targetPairs: 5,         // Target number of pairs to select
      ...config
    };
    
    this.spotClient = null;
    this.futuresClient = null;
    this.restClient = null;
    
    // Real-time data tracking
    this.pairData = new Map();
    this.analysisResults = [];
    this.isAnalyzing = false;
  }
  
  /**
   * Initialize all clients
   */
  async initialize() {
    logger.info('🚀 Initializing Dynamic Pair Selector...');
    
    // Initialize REST client for market data
    this.restClient = new KrakenRESTClient({
      apiKey: process.env.KRAKEN_API_KEY,
      apiSecret: process.env.KRAKEN_API_SECRET
    });
    
    logger.info('✅ Clients initialized');
  }
  
  /**
   * Get available trading pairs from Kraken
   */
  async getAvailablePairs() {
    logger.info('🔍 Discovering available trading pairs...');
    
    try {
      // Get available pairs from Kraken REST API
      const assetPairs = await this.restClient.getAssetPairs();
      
      const availablePairs = [];
      
      // Filter for USD pairs available in both spot and futures
      for (const [normalizedPair, mapping] of Object.entries(PAIR_MAPPINGS)) {
        try {
          // Check if spot pair exists
          const spotSymbol = mapping.spot;
          let spotExists = false;
          let volume24h = 0;
          let spread = 0;
          let price = 0;
          
          // Check different possible formats
          const possibleSpotFormats = [
            spotSymbol,
            spotSymbol.replace('/', ''),
            spotSymbol.replace('XBT', 'BTC')
          ];
          
          for (const format of possibleSpotFormats) {
            if (assetPairs.result && assetPairs.result[format]) {
              spotExists = true;
              
              // Try to get ticker data for this format
              try {
                const ticker = await this.restClient.getTicker(format);
                if (ticker && ticker.result && ticker.result[format]) {
                  const tickerData = ticker.result[format];
                  volume24h = parseFloat(tickerData.v?.[1] || 0);
                  const bid = parseFloat(tickerData.b?.[0] || 0);
                  const ask = parseFloat(tickerData.a?.[0] || 0);
                  price = parseFloat(tickerData.c?.[0] || 0);
                  spread = ask > bid ? ((ask - bid) / bid) * 10000 : 0; // basis points
                }
              } catch (tickerError) {
                logger.debug(`No ticker data for ${format}`);
                // Use defaults for pairs without ticker data
                volume24h = 10000000; // 10M default
                spread = 30; // 30bps default
                price = 100;
              }
              break;
            }
          }
          
          if (spotExists) {
            // Only include pairs with sufficient volume and reasonable spreads
            if (volume24h >= this.config.minVolume24h && spread <= this.config.maxSpreadBps) {
              availablePairs.push({
                normalizedPair,
                mapping,
                volume24h,
                spread,
                price,
                priority: mapping.priority,
                score: this.calculateInitialScore(volume24h, spread, mapping.priority)
              });
            }
          }
        } catch (error) {
          logger.debug(`Error checking ${normalizedPair}:`, error.message);
        }
      }
      
      // Sort by initial score
      availablePairs.sort((a, b) => b.score - a.score);
      
      logger.info(`✅ Found ${availablePairs.length} viable pairs:`);
      availablePairs.slice(0, 8).forEach((pair, i) => {
        logger.info(`  ${i + 1}. ${pair.normalizedPair} - Score: ${pair.score.toFixed(1)} | Vol: $${(pair.volume24h/1000000).toFixed(1)}M | Spread: ${pair.spread.toFixed(1)}bps`);
      });
      
      return availablePairs;
      
    } catch (error) {
      logger.error('❌ Failed to get available pairs:', error.message);
      
      // Fallback to default high-priority pairs
      const fallbackPairs = Object.entries(PAIR_MAPPINGS)
        .filter(([, mapping]) => mapping.priority >= 7)
        .map(([normalizedPair, mapping]) => ({
          normalizedPair,
          mapping,
          volume24h: 50000000, // Assume decent volume
          spread: 20, // Assume reasonable spread
          price: 100, // Default price
          priority: mapping.priority,
          score: mapping.priority * 10
        }));
      
      logger.warn(`⚠️  Using fallback pairs: ${fallbackPairs.map(p => p.normalizedPair).join(', ')}`);
      return fallbackPairs;
    }
  }
  
  /**
   * Calculate initial score based on volume, spread, and priority
   */
  calculateInitialScore(volume24h, spread, priority) {
    // Volume component (0-40 points)
    const volumeScore = Math.min(40, (volume24h / 100000000) * 40); // $100M = 40 points
    
    // Spread component (0-30 points, inverted - lower spread is better)
    const spreadScore = Math.max(0, 30 - (spread / 2)); // 0 spread = 30 points, 60bps = 0 points
    
    // Priority component (0-30 points)
    const priorityScore = priority * 3; // Max priority 10 = 30 points
    
    return volumeScore + spreadScore + priorityScore;
  }
  
  /**
   * Analyze real-time edge opportunity for specific pairs
   */
  async analyzeEdgeOpportunity(pairs) {
    logger.info(`📊 Analyzing edge opportunity for ${pairs.length} pairs...`);
    
    // Initialize data tracking
    this.pairData.clear();
    pairs.forEach(pair => {
      this.pairData.set(pair.normalizedPair, {
        spotUpdates: 0,
        futuresUpdates: 0,
        spotPrices: [],
        futuresPrices: [],
        lastSpotUpdate: 0,
        lastFuturesUpdate: 0,
        priceChanges: 0,
        leadEvents: []
      });
    });
    
    // Set up WebSocket clients
    await this.setupWebSocketClients(pairs);
    
    // Analyze for the configured window
    logger.info(`⏱️  Collecting data for ${this.config.analysisWindow / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, this.config.analysisWindow));
    
    // Calculate edge scores
    const edgeResults = this.calculateEdgeScores(pairs);
    
    // Clean up WebSocket clients
    await this.cleanupWebSocketClients();
    
    return edgeResults;
  }
  
  /**
   * Set up WebSocket clients for real-time data
   */
  async setupWebSocketClients(pairs) {
    try {
      // Set up spot WebSocket
      this.spotClient = new WebSocket('wss://ws.kraken.com/v2');
      
      await new Promise((resolve, reject) => {
        this.spotClient.on('open', () => {
          logger.debug('✅ Spot WebSocket connected');
          resolve();
        });
        this.spotClient.on('error', reject);
      });
      
      // Set up futures WebSocket
      this.futuresClient = new KrakenFuturesWebSocketClient({ logger });
      await this.futuresClient.connect(false);
      logger.debug('✅ Futures WebSocket connected');
      
      // Subscribe to spot pairs
      const spotPairs = pairs.map(p => p.mapping.spot);
      for (const spotPair of spotPairs) {
        const subscribeMsg = {
          method: 'subscribe',
          params: {
            channel: 'book',
            symbol: [spotPair],
            depth: 5
          }
        };
        this.spotClient.send(JSON.stringify(subscribeMsg));
      }
      
      // Subscribe to futures pairs
      const futuresPairs = pairs.map(p => p.mapping.futures);
      await this.futuresClient.subscribe('book', futuresPairs);
      
      // Set up message handlers
      this.setupMessageHandlers(pairs);
      
    } catch (error) {
      logger.error('❌ Failed to setup WebSocket clients:', error.message);
      throw error;
    }
  }
  
  /**
   * Set up message handlers for both WebSocket clients
   */
  setupMessageHandlers(pairs) {
    // Spot message handler
    this.spotClient.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.channel === 'book' && message.data) {
          for (const bookData of message.data) {
            const spotSymbol = bookData.symbol;
            const normalizedPair = this.findPairBySpotSymbol(spotSymbol, pairs);
            
            if (normalizedPair && bookData.bids && bookData.asks && 
                bookData.bids.length > 0 && bookData.asks.length > 0) {
              
              const pairData = this.pairData.get(normalizedPair);
              if (pairData) {
                pairData.spotUpdates++;
                pairData.lastSpotUpdate = Date.now();
                
                const midPrice = (parseFloat(bookData.bids[0].price) + parseFloat(bookData.asks[0].price)) / 2;
                pairData.spotPrices.push({ price: midPrice, timestamp: Date.now() });
                
                // Keep only recent prices
                if (pairData.spotPrices.length > 100) {
                  pairData.spotPrices.shift();
                }
                
                this.detectPriceMovement(normalizedPair, 'spot', midPrice);
              }
            }
          }
        }
      } catch (error) {
        // Ignore parse errors
      }
    });
    
    // Futures message handler
    this.futuresClient.on('orderBookUpdate', (data) => {
      const futuresSymbol = data.symbol;
      const normalizedPair = this.findPairByFuturesSymbol(futuresSymbol, pairs);
      
      if (normalizedPair && data.midPrice) {
        const pairData = this.pairData.get(normalizedPair);
        if (pairData) {
          pairData.futuresUpdates++;
          pairData.lastFuturesUpdate = Date.now();
          
          pairData.futuresPrices.push({ price: data.midPrice, timestamp: Date.now() });
          
          // Keep only recent prices
          if (pairData.futuresPrices.length > 100) {
            pairData.futuresPrices.shift();
          }
          
          this.detectPriceMovement(normalizedPair, 'futures', data.midPrice);
        }
      }
    });
  }
  
  /**
   * Detect significant price movements
   */
  detectPriceMovement(normalizedPair, market, currentPrice) {
    const pairData = this.pairData.get(normalizedPair);
    if (!pairData) return;
    
    const priceArray = market === 'spot' ? pairData.spotPrices : pairData.futuresPrices;
    
    if (priceArray.length >= 2) {
      const previousPrice = priceArray[priceArray.length - 2].price;
      const movement = Math.abs((currentPrice - previousPrice) / previousPrice);
      
      if (movement >= 0.0005) { // 0.05% threshold
        pairData.priceChanges++;
        
        // Check for lead events
        this.checkForLeadEvent(normalizedPair, market, Date.now());
      }
    }
  }
  
  /**
   * Check for futures leading spot (or vice versa)
   */
  checkForLeadEvent(normalizedPair, market, timestamp) {
    const pairData = this.pairData.get(normalizedPair);
    if (!pairData) return;
    
    const oppositeMarket = market === 'spot' ? 'futures' : 'spot';
    const oppositeLastUpdate = market === 'spot' ? pairData.lastFuturesUpdate : pairData.lastSpotUpdate;
    
    if (oppositeLastUpdate > 0) {
      const timeDiff = timestamp - oppositeLastUpdate;
      
      // If this market updated within reasonable time after the other
      if (timeDiff > 100 && timeDiff < 10000) {
        const leadingMarket = timeDiff > 0 ? oppositeMarket : market;
        const leadTime = Math.abs(timeDiff);
        
        pairData.leadEvents.push({
          leadingMarket,
          leadTime,
          timestamp
        });
      }
    }
  }
  
  /**
   * Find normalized pair by spot symbol
   */
  findPairBySpotSymbol(spotSymbol, pairs) {
    for (const pair of pairs) {
      if (pair.mapping.spot === spotSymbol) {
        return pair.normalizedPair;
      }
    }
    return null;
  }
  
  /**
   * Find normalized pair by futures symbol
   */
  findPairByFuturesSymbol(futuresSymbol, pairs) {
    for (const pair of pairs) {
      if (pair.mapping.futures === futuresSymbol) {
        return pair.normalizedPair;
      }
    }
    return null;
  }
  
  /**
   * Calculate edge scores for all pairs
   */
  calculateEdgeScores(pairs) {
    const results = [];
    
    for (const pair of pairs) {
      const pairData = this.pairData.get(pair.normalizedPair);
      if (!pairData) continue;
      
      // Update frequency score (0-40 points)
      const totalUpdates = pairData.spotUpdates + pairData.futuresUpdates;
      const futuresRatio = totalUpdates > 0 ? pairData.futuresUpdates / totalUpdates : 0;
      const updateFrequencyScore = Math.min(40, totalUpdates * 0.1) * futuresRatio;
      
      // Activity score (0-30 points)
      const activityScore = Math.min(30, pairData.priceChanges * 2);
      
      // Lead advantage score (0-20 points)
      const futuresLeads = pairData.leadEvents.filter(e => e.leadingMarket === 'futures').length;
      const totalLeads = pairData.leadEvents.length;
      const leadAdvantageScore = totalLeads > 0 ? (futuresLeads / totalLeads) * 20 : 0;
      
      // Data quality score (0-10 points)
      const dataQualityScore = Math.min(10, 
        (pairData.spotUpdates >= this.config.minSpotUpdates ? 5 : 0) +
        (pairData.futuresUpdates >= this.config.minFuturesUpdates ? 5 : 0)
      );
      
      const edgeScore = updateFrequencyScore + activityScore + leadAdvantageScore + dataQualityScore;
      const finalScore = (pair.score * 0.3) + (edgeScore * 0.7); // Combine initial score with edge score
      
      results.push({
        pair: pair.normalizedPair,
        mapping: pair.mapping,
        initialScore: pair.score,
        edgeScore,
        finalScore,
        metrics: {
          spotUpdates: pairData.spotUpdates,
          futuresUpdates: pairData.futuresUpdates,
          updateRatio: pairData.futuresUpdates / Math.max(pairData.spotUpdates, 1),
          priceChanges: pairData.priceChanges,
          leadEvents: pairData.leadEvents.length,
          futuresLeads: futuresLeads,
          leadPercentage: totalLeads > 0 ? (futuresLeads / totalLeads * 100) : 0,
          volume24h: pair.volume24h,
          spread: pair.spread
        }
      });
    }
    
    // Sort by final score
    results.sort((a, b) => b.finalScore - a.finalScore);
    
    return results;
  }
  
  /**
   * Clean up WebSocket clients
   */
  async cleanupWebSocketClients() {
    try {
      if (this.spotClient) {
        this.spotClient.close();
        this.spotClient = null;
      }
      
      if (this.futuresClient) {
        this.futuresClient.disconnect();
        this.futuresClient = null;
      }
      
      logger.debug('✅ WebSocket clients cleaned up');
    } catch (error) {
      logger.warn('⚠️  Error cleaning up WebSocket clients:', error.message);
    }
  }
  
  /**
   * Select top pairs based on analysis
   */
  selectTopPairs(analysisResults) {
    const topPairs = analysisResults
      .filter(result => 
        result.metrics.spotUpdates >= this.config.minSpotUpdates &&
        result.metrics.futuresUpdates >= this.config.minFuturesUpdates
      )
      .slice(0, this.config.targetPairs);
    
    logger.info(`🎯 Selected top ${topPairs.length} pairs based on edge analysis:`);
    
    topPairs.forEach((result, i) => {
      const metrics = result.metrics;
      logger.info(`  ${i + 1}. ${result.pair}:`);
      logger.info(`     Final Score: ${result.finalScore.toFixed(1)}`);
      logger.info(`     Update Ratio: ${metrics.updateRatio.toFixed(1)}:1 (F:S)`);
      logger.info(`     Futures Leads: ${metrics.leadPercentage.toFixed(1)}%`);
      logger.info(`     Activity: ${metrics.priceChanges} price changes`);
      logger.info(`     Volume: $${(metrics.volume24h/1000000).toFixed(1)}M`);
    });
    
    return topPairs.map(result => result.pair);
  }
  
  /**
   * Run complete pair selection analysis
   */
  async runAnalysis() {
    logger.info('🚀 Starting Dynamic Pair Selection Analysis...\n');
    
    const startTime = Date.now();
    
    try {
      // Step 1: Get available pairs
      const availablePairs = await this.getAvailablePairs();
      
      if (availablePairs.length === 0) {
        throw new Error('No viable trading pairs found');
      }
      
      // Step 2: Analyze top candidates (limit to 8 to keep analysis fast)
      const topCandidates = availablePairs.slice(0, 8);
      const edgeResults = await this.analyzeEdgeOpportunity(topCandidates);
      
      // Step 3: Select final pairs
      const selectedPairs = this.selectTopPairs(edgeResults);
      
      // Step 4: Generate report
      const report = {
        timestamp: new Date().toISOString(),
        analysisWindow: this.config.analysisWindow,
        totalCandidates: availablePairs.length,
        analyzedPairs: topCandidates.length,
        selectedPairs,
        detailedResults: edgeResults,
        executionTime: Date.now() - startTime,
        summary: {
          topPair: selectedPairs[0] || 'None',
          avgUpdateRatio: edgeResults.length > 0 ? 
            (edgeResults.reduce((sum, r) => sum + r.metrics.updateRatio, 0) / edgeResults.length).toFixed(1) : 0,
          avgFuturesLeadPercentage: edgeResults.length > 0 ?
            (edgeResults.reduce((sum, r) => sum + r.metrics.leadPercentage, 0) / edgeResults.length).toFixed(1) : 0
        }
      };
      
      // Save results
      await this.saveResults(report);
      
      logger.info('\n✅ Dynamic Pair Selection Complete!');
      logger.info(`⏱️  Execution time: ${report.executionTime}ms`);
      logger.info(`🎯 Selected pairs: ${selectedPairs.join(', ')}`);
      
      return report;
      
    } catch (error) {
      logger.error('❌ Dynamic pair selection failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Save analysis results
   */
  async saveResults(report) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Save detailed report
      const detailedFilename = `pair-selection-detailed-${timestamp}.json`;
      fs.writeFileSync(detailedFilename, JSON.stringify(report, null, 2));
      
      // Save simple pair list for easy consumption
      const pairList = {
        timestamp: report.timestamp,
        selectedPairs: report.selectedPairs,
        summary: report.summary,
        nextUpdate: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes from now
      };
      
      fs.writeFileSync('selected-trading-pairs.json', JSON.stringify(pairList, null, 2));
      
      logger.info(`💾 Results saved:`);
      logger.info(`   • ${detailedFilename} (detailed analysis)`);
      logger.info(`   • selected-trading-pairs.json (pair list)`);
      
    } catch (error) {
      logger.warn('⚠️  Failed to save results:', error.message);
    }
  }
  
  /**
   * Run continuous monitoring (every 5 minutes)
   */
  async runContinuous() {
    logger.info('🔄 Starting continuous pair selection monitoring...');
    logger.info('📅 Running every 5 minutes to adapt to market conditions\n');
    
    const runAnalysisLoop = async () => {
      try {
        await this.runAnalysis();
        logger.info('\n⏰ Next analysis in 5 minutes...\n');
      } catch (error) {
        logger.error('❌ Analysis failed, will retry in 5 minutes:', error.message);
      }
    };
    
    // Run immediately
    await runAnalysisLoop();
    
    // Then run every 5 minutes
    setInterval(runAnalysisLoop, 5 * 60 * 1000);
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const isContinuous = args.includes('--continuous') || args.includes('-c');
  
  try {
    const selector = new DynamicPairSelector();
    await selector.initialize();
    
    if (isContinuous) {
      await selector.runContinuous();
    } else {
      await selector.runAnalysis();
    }
    
  } catch (error) {
    console.error('💥 Dynamic pair selection failed:', error);
    console.log('\n📋 USAGE:');
    console.log('  node dynamic-pair-selector.js [--continuous]');
    console.log('\n🔧 OPTIONS:');
    console.log('  --continuous, -c     Run continuously every 5 minutes');
    console.log('\n📝 EXAMPLES:');
    console.log('  node dynamic-pair-selector.js           # Single analysis');
    console.log('  node dynamic-pair-selector.js -c        # Continuous monitoring');
    process.exit(1);
  }
}

// Export for module use
export { DynamicPairSelector };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}