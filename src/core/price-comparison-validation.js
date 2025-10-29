#!/usr/bin/env node
/**
 * Price Comparison Validation
 * 
 * Real-time comparison of spot vs futures prices to validate edge opportunities
 * Shows live price differences and update frequencies
 */

import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import { KrakenFuturesWebSocketClient } from '../../lib/exchanges/KrakenFuturesWebSocketClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'PriceComparison' });

const TEST_PAIRS = {
  'BTC/USD': { spot: 'XBT/USD', futures: 'PF_XBTUSD' },
  'ETH/USD': { spot: 'ETH/USD', futures: 'PF_ETHUSD' },
  'SOL/USD': { spot: 'SOL/USD', futures: 'PF_SOLUSD' }
};

class PriceTracker {
  constructor() {
    this.prices = new Map();
    this.updateCounts = new Map();
    this.lastUpdateTimes = new Map();
    this.priceHistory = new Map();
    this.leads = [];
    
    // Initialize tracking for each pair
    Object.keys(TEST_PAIRS).forEach(pair => {
      this.prices.set(pair, { spot: null, futures: null });
      this.updateCounts.set(pair, { spot: 0, futures: 0 });
      this.lastUpdateTimes.set(pair, { spot: 0, futures: 0 });
      this.priceHistory.set(pair, { spot: [], futures: [] });
    });
  }
  
  updatePrice(pair, market, price, timestamp) {
    const currentPrices = this.prices.get(pair);
    const counts = this.updateCounts.get(pair);
    const times = this.lastUpdateTimes.get(pair);
    const history = this.priceHistory.get(pair);
    
    // Store price with timestamp
    currentPrices[market] = price;
    counts[market]++;
    times[market] = timestamp;
    
    // Keep last 20 prices for movement detection
    history[market].push({ price, timestamp });
    if (history[market].length > 20) {
      history[market].shift();
    }
    
    // Check for price movement and timing difference
    this.checkForUpdateFrequencyEdge(pair, market, timestamp);
    this.checkForPriceDifference(pair);
  }
  
  checkForUpdateFrequencyEdge(pair, market, timestamp) {
    const times = this.lastUpdateTimes.get(pair);
    const oppositeMarket = market === 'spot' ? 'futures' : 'spot';
    const oppositeLastUpdate = times[oppositeMarket];
    
    if (oppositeLastUpdate > 0) {
      const timeDiff = timestamp - oppositeLastUpdate;
      
      // If this market updated much more recently, it might be leading
      if (timeDiff < -100) { // This market is ahead by >100ms
        const leadEvent = {
          pair,
          leadingMarket: market,
          leadTime: Math.abs(timeDiff),
          timestamp
        };
        
        this.leads.push(leadEvent);
        
        if (this.leads.length % 10 === 0) { // Log every 10th lead
          console.log(`⚡ ${market.toUpperCase()} leading ${pair} (${leadEvent.leadTime}ms ahead)`);
        }
      }
    }
  }
  
  checkForPriceDifference(pair) {
    const currentPrices = this.prices.get(pair);
    
    if (currentPrices.spot && currentPrices.futures) {
      const spread = ((currentPrices.futures - currentPrices.spot) / currentPrices.spot) * 100;
      const absSpread = Math.abs(spread);
      
      // Log significant spreads
      if (absSpread > 0.05) { // 0.05% spread
        console.log(`💰 ${pair} spread: ${spread.toFixed(3)}% (Futures $${currentPrices.futures.toFixed(2)} vs Spot $${currentPrices.spot.toFixed(2)})`);
      }
    }
  }
  
  getUpdateFrequencies() {
    const frequencies = {};
    
    this.updateCounts.forEach((counts, pair) => {
      const total = counts.spot + counts.futures;
      const futuresRatio = total > 0 ? (counts.futures / total * 100) : 0;
      
      frequencies[pair] = {
        spotUpdates: counts.spot,
        futuresUpdates: counts.futures,
        totalUpdates: total,
        futuresRatio: futuresRatio.toFixed(1) + '%',
        updateRatio: counts.futures > 0 ? (counts.futures / Math.max(counts.spot, 1)).toFixed(1) + ':1' : 'N/A'
      };
    });
    
    return frequencies;
  }
  
  getLeadAnalysis() {
    const futuresLeads = this.leads.filter(l => l.leadingMarket === 'futures').length;
    const spotLeads = this.leads.filter(l => l.leadingMarket === 'spot').length;
    const total = futuresLeads + spotLeads;
    
    return {
      totalLeadEvents: total,
      futuresLeads,
      spotLeads,
      futuresLeadPercentage: total > 0 ? (futuresLeads / total * 100).toFixed(1) + '%' : '0%',
      avgFuturesLeadTime: futuresLeads > 0 ? 
        (this.leads.filter(l => l.leadingMarket === 'futures')
          .reduce((sum, l) => sum + l.leadTime, 0) / futuresLeads).toFixed(0) + 'ms' : 'N/A'
    };
  }
  
  getCurrentPrices() {
    const current = {};
    
    this.prices.forEach((prices, pair) => {
      current[pair] = {
        spot: prices.spot ? `$${prices.spot.toFixed(2)}` : 'N/A',
        futures: prices.futures ? `$${prices.futures.toFixed(2)}` : 'N/A',
        spread: (prices.spot && prices.futures) ? 
          `${(((prices.futures - prices.spot) / prices.spot) * 100).toFixed(3)}%` : 'N/A'
      };
    });
    
    return current;
  }
}

class LiveSpotClient {
  constructor(tracker) {
    this.tracker = tracker;
    this.ws = null;
  }
  
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://ws.kraken.com/v2');
      
      this.ws.on('open', () => {
        console.log('✅ Spot WebSocket connected');
        resolve();
      });
      
      this.ws.on('error', reject);
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          // Ignore parse errors for now
        }
      });
    });
  }
  
  async subscribe() {
    const pairs = Object.values(TEST_PAIRS).map(p => p.spot);
    
    for (const pair of pairs) {
      const subscribeMsg = {
        method: 'subscribe',
        params: {
          channel: 'book',
          symbol: [pair],
          depth: 5
        }
      };
      this.ws.send(JSON.stringify(subscribeMsg));
    }
  }
  
  handleMessage(message) {
    if (message.channel === 'book' && message.data) {
      for (const bookData of message.data) {
        const symbol = bookData.symbol;
        const normalizedPair = this.normalizePair(symbol);
        
        if (bookData.bids && bookData.asks && bookData.bids.length > 0 && bookData.asks.length > 0) {
          const midPrice = (parseFloat(bookData.bids[0].price) + parseFloat(bookData.asks[0].price)) / 2;
          this.tracker.updatePrice(normalizedPair, 'spot', midPrice, Date.now());
        }
      }
    }
  }
  
  normalizePair(symbol) {
    if (symbol === 'XBT/USD') return 'BTC/USD';
    return symbol;
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

class LiveFuturesClient {
  constructor(tracker) {
    this.tracker = tracker;
    this.client = new KrakenFuturesWebSocketClient({ logger });
  }
  
  async connect() {
    await this.client.connect(false);
    
    this.client.on('orderBookUpdate', (data) => {
      const normalizedPair = this.normalizePair(data.symbol);
      if (data.midPrice && normalizedPair) {
        this.tracker.updatePrice(normalizedPair, 'futures', data.midPrice, Date.now());
      }
    });
    
    console.log('✅ Futures WebSocket connected');
  }
  
  async subscribe() {
    const futuresPairs = Object.values(TEST_PAIRS).map(p => p.futures);
    await this.client.subscribe('book', futuresPairs);
  }
  
  normalizePair(symbol) {
    if (symbol === 'PF_XBTUSD') return 'BTC/USD';
    if (symbol === 'PF_ETHUSD') return 'ETH/USD';
    if (symbol === 'PF_SOLUSD') return 'SOL/USD';
    return null;
  }
  
  disconnect() {
    this.client.disconnect();
  }
}

async function validatePriceComparison() {
  console.log('📊 Live Price Comparison Validation\n');
  console.log('Real-time analysis of spot vs futures pricing and update frequencies\n');

  const tracker = new PriceTracker();
  const spotClient = new LiveSpotClient(tracker);
  const futuresClient = new LiveFuturesClient(tracker);

  try {
    console.log('1️⃣ Connecting to live data feeds...');
    await Promise.all([
      spotClient.connect(),
      futuresClient.connect()
    ]);

    console.log('2️⃣ Subscribing to all pairs...');
    await Promise.all([
      spotClient.subscribe(),
      futuresClient.subscribe()
    ]);

    console.log('3️⃣ Monitoring live prices for 45 seconds...\n');

    // Show live analysis every 5 seconds
    const analysisInterval = setInterval(() => {
      console.log('\n' + '='.repeat(60));
      console.log('📊 LIVE ANALYSIS UPDATE');
      console.log('='.repeat(60));
      
      // Current prices
      console.log('\n💰 Current Prices:');
      const prices = tracker.getCurrentPrices();
      Object.entries(prices).forEach(([pair, data]) => {
        console.log(`  ${pair}: Spot ${data.spot} | Futures ${data.futures} | Spread ${data.spread}`);
      });
      
      // Update frequencies
      console.log('\n⚡ Update Frequencies:');
      const frequencies = tracker.getUpdateFrequencies();
      Object.entries(frequencies).forEach(([pair, data]) => {
        console.log(`  ${pair}: Spot ${data.spotUpdates} | Futures ${data.futuresUpdates} | Ratio ${data.updateRatio} | Futures ${data.futuresRatio}`);
      });
      
      // Lead analysis
      console.log('\n🎯 Lead Analysis:');
      const leadAnalysis = tracker.getLeadAnalysis();
      console.log(`  Total Lead Events: ${leadAnalysis.totalLeadEvents}`);
      console.log(`  Futures Led: ${leadAnalysis.futuresLeads} (${leadAnalysis.futuresLeadPercentage})`);
      console.log(`  Spot Led: ${leadAnalysis.spotLeads}`);
      console.log(`  Avg Futures Lead Time: ${leadAnalysis.avgFuturesLeadTime}`);
      
      console.log('='.repeat(60));
    }, 5000);

    await new Promise(resolve => setTimeout(resolve, 45000));
    clearInterval(analysisInterval);

    console.log('\n4️⃣ Final Validation Results:\n');

    // Final analysis
    const finalFrequencies = tracker.getUpdateFrequencies();
    const finalLeadAnalysis = tracker.getLeadAnalysis();
    const finalPrices = tracker.getCurrentPrices();

    console.log('📊 FINAL EDGE VALIDATION SUMMARY');
    console.log('='.repeat(80));
    
    console.log('\n💡 Key Findings:');
    
    // Check update frequency advantage
    let futuresMoreActive = false;
    Object.entries(finalFrequencies).forEach(([pair, data]) => {
      if (data.futuresUpdates > data.spotUpdates * 2) {
        futuresMoreActive = true;
        console.log(`✅ ${pair}: Futures ${data.futuresUpdates} vs Spot ${data.spotUpdates} updates (${data.updateRatio} ratio)`);
      }
    });
    
    if (futuresMoreActive) {
      console.log('\n🎯 FUTURES UPDATE FREQUENCY EDGE CONFIRMED!');
      console.log('   Futures markets provide significantly more frequent price updates');
      console.log('   This creates timing advantages for execution');
    }
    
    // Check lead time advantage
    if (parseInt(finalLeadAnalysis.futuresLeadPercentage) > 60) {
      console.log(`\n⚡ FUTURES TIMING EDGE CONFIRMED!`);
      console.log(`   Futures led ${finalLeadAnalysis.futuresLeadPercentage} of price movements`);
      console.log(`   Average lead time: ${finalLeadAnalysis.avgFuturesLeadTime}`);
    }
    
    // Show spreads
    console.log('\n💰 Final Price Spreads:');
    Object.entries(finalPrices).forEach(([pair, data]) => {
      console.log(`   ${pair}: ${data.spread} spread (Futures ${data.futures} vs Spot ${data.spot})`);
    });
    
    console.log('\n🎯 TRADING EDGE VERDICT:');
    
    if (futuresMoreActive && parseInt(finalLeadAnalysis.futuresLeadPercentage) > 50) {
      console.log('✅ STRONG EDGE CONFIRMED - Deploy with confidence!');
      console.log('💡 Recommendations:');
      console.log('   • Focus on futures data for early signals');
      console.log('   • Execute spot trades on futures movements');
      console.log('   • Monitor update frequency ratios for optimal timing');
    } else if (futuresMoreActive) {
      console.log('⚠️  PARTIAL EDGE - Futures provide information advantage');
      console.log('💡 Deploy conservatively and monitor performance');
    } else {
      console.log('❌ NO CLEAR EDGE - Consider different market conditions');
    }
    
    console.log('\n' + '='.repeat(80));

    spotClient.disconnect();
    futuresClient.disconnect();

  } catch (error) {
    console.error('\n❌ Validation failed:', error);
    process.exit(1);
  }
}

validatePriceComparison().catch(console.error);