#!/usr/bin/env node
/**
 * Simple Futures Edge Validation
 * 
 * Directly connects to Kraken spot and futures WebSockets to measure
 * the timing advantage of futures leading indicators.
 */

import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import { KrakenFuturesWebSocketClient } from '../../lib/exchanges/KrakenFuturesWebSocketClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'SimpleEdgeValidation' });

// Test configuration
const TEST_PAIRS = {
  'BTC/USD': { spot: 'XBT/USD', futures: 'PF_XBTUSD' },
  'ETH/USD': { spot: 'ETH/USD', futures: 'PF_ETHUSD' },
  'SOL/USD': { spot: 'SOL/USD', futures: 'PF_SOLUSD' }
};

const VALIDATION_DURATION = 180000; // 3 minutes
const MOVEMENT_THRESHOLD = 0.03; // 0.03% minimum movement

class EdgeValidator {
  constructor() {
    this.spotPrices = new Map();
    this.futuresPrices = new Map();
    this.priceEvents = [];
    this.leadEvents = [];
    
    // Results tracking
    this.results = {
      totalMovements: 0,
      futuresLeadCount: 0,
      spotLeadCount: 0,
      avgFuturesLeadTime: 0,
      edgeOpportunities: 0,
      pairStats: {}
    };
    
    Object.keys(TEST_PAIRS).forEach(pair => {
      this.results.pairStats[pair] = {
        movements: 0,
        futuresLeads: 0,
        avgLeadTime: 0,
        opportunities: 0
      };
    });
  }
  
  trackPrice(pair, market, price, timestamp) {
    const priceMap = market === 'spot' ? this.spotPrices : this.futuresPrices;
    const lastPrice = priceMap.get(pair);
    
    if (lastPrice && lastPrice.price) {
      const movement = ((price - lastPrice.price) / lastPrice.price) * 100;
      
      if (Math.abs(movement) >= MOVEMENT_THRESHOLD) {
        const event = {
          pair,
          market,
          price,
          movement,
          timestamp,
          direction: movement > 0 ? 'up' : 'down'
        };
        
        this.priceEvents.push(event);
        this.checkForLeadOpportunity(event);
        
        logger.info(`📊 ${market.toUpperCase()} movement in ${pair}:`, {
          movement: movement.toFixed(3) + '%',
          direction: event.direction,
          price: price.toFixed(2)
        });
      }
    }
    
    priceMap.set(pair, { price, timestamp });
  }
  
  checkForLeadOpportunity(currentEvent) {
    const oppositeMarket = currentEvent.market === 'spot' ? 'futures' : 'spot';
    const timeWindow = 15000; // 15 second window
    
    // Find corresponding movement in opposite market
    const correspondingEvents = this.priceEvents
      .filter(e => 
        e.pair === currentEvent.pair &&
        e.market === oppositeMarket &&
        e.direction === currentEvent.direction &&
        Math.abs(e.timestamp - currentEvent.timestamp) <= timeWindow
      )
      .sort((a, b) => Math.abs(a.timestamp - currentEvent.timestamp) - Math.abs(b.timestamp - currentEvent.timestamp));
    
    if (correspondingEvents.length > 0) {
      const correspondingEvent = correspondingEvents[0];
      const leadTime = currentEvent.timestamp - correspondingEvent.timestamp;
      const leadingMarket = leadTime > 0 ? correspondingEvent.market : currentEvent.market;
      const actualLeadTime = Math.abs(leadTime);
      
      if (actualLeadTime > 200 && actualLeadTime < 12000) { // Filter noise and unrealistic delays
        this.recordLeadEvent(currentEvent.pair, leadingMarket, actualLeadTime, currentEvent.movement);
      }
    }
  }
  
  recordLeadEvent(pair, leadingMarket, leadTime, movement) {
    this.results.totalMovements++;
    this.results.pairStats[pair].movements++;
    
    const leadEvent = {
      pair,
      leadingMarket,
      leadTime,
      movement,
      timestamp: Date.now()
    };
    
    this.leadEvents.push(leadEvent);
    
    if (leadingMarket === 'futures') {
      this.results.futuresLeadCount++;
      this.results.pairStats[pair].futuresLeads++;
      
      // Update average lead time
      const totalFuturesLeads = this.results.futuresLeadCount;
      this.results.avgFuturesLeadTime = ((this.results.avgFuturesLeadTime * (totalFuturesLeads - 1)) + leadTime) / totalFuturesLeads;
      
      // Check if this is a tradeable edge opportunity (2-8 seconds)
      if (leadTime >= 2000 && leadTime <= 8000) {
        this.results.edgeOpportunities++;
        this.results.pairStats[pair].opportunities++;
        
        logger.info('🎯 EDGE OPPORTUNITY DETECTED!', {
          pair,
          leadTime: leadTime + 'ms',
          movement: movement.toFixed(3) + '%',
          tradeable: '✅'
        });
      } else {
        logger.info('📈 Futures led spot', {
          pair,
          leadTime: leadTime + 'ms',
          movement: movement.toFixed(3) + '%',
          tradeable: leadTime < 2000 ? 'Too fast' : 'Too slow'
        });
      }
    } else {
      this.results.spotLeadCount++;
      logger.debug('📉 Spot led futures', { pair, leadTime: leadTime + 'ms' });
    }
  }
  
  generateReport() {
    const totalLeads = this.results.futuresLeadCount + this.results.spotLeadCount;
    const futuresEdgeRate = totalLeads > 0 ? (this.results.futuresLeadCount / totalLeads * 100) : 0;
    
    console.log('\n' + '='.repeat(80));
    console.log('🔬 SIMPLE FUTURES EDGE VALIDATION RESULTS');
    console.log('='.repeat(80));
    
    console.log('\n📊 Overall Performance:');
    console.log(`  • Total Price Movements: ${this.results.totalMovements}`);
    console.log(`  • Futures Led Spot: ${this.results.futuresLeadCount} (${futuresEdgeRate.toFixed(1)}%)`);
    console.log(`  • Spot Led Futures: ${this.results.spotLeadCount} (${(100 - futuresEdgeRate).toFixed(1)}%)`);
    console.log(`  • Average Futures Lead Time: ${this.results.avgFuturesLeadTime.toFixed(0)}ms`);
    
    console.log('\n💰 Edge Opportunities:');
    console.log(`  • Total Edge Opportunities (2-8s): ${this.results.edgeOpportunities}`);
    
    if (this.results.totalMovements > 0) {
      const opportunityRate = (this.results.edgeOpportunities / this.results.totalMovements * 100);
      console.log(`  • Edge Rate: ${opportunityRate.toFixed(2)}% of all movements`);
      
      const timeHours = VALIDATION_DURATION / (1000 * 60 * 60);
      const opportunitiesPerHour = this.results.edgeOpportunities / timeHours;
      console.log(`  • Projected Opportunities/Hour: ${opportunitiesPerHour.toFixed(1)}`);
    }
    
    console.log('\n📈 Per-Pair Analysis:');
    Object.entries(this.results.pairStats).forEach(([pair, stats]) => {
      console.log(`\n  🪙 ${pair}:`);
      console.log(`    • Movements Detected: ${stats.movements}`);
      console.log(`    • Futures Led: ${stats.futuresLeads}`);
      console.log(`    • Edge Opportunities: ${stats.opportunities}`);
      
      if (stats.movements > 0) {
        const pairEdgeRate = (stats.opportunities / stats.movements * 100);
        console.log(`    • Edge Rate: ${pairEdgeRate.toFixed(1)}%`);
      }
    });
    
    console.log('\n🎯 Validation Conclusion:');
    if (futuresEdgeRate > 60 && this.results.edgeOpportunities > 0) {
      console.log('✅ STRONG FUTURES EDGE CONFIRMED');
      console.log('💡 Recommendation: Deploy with confidence');
      console.log(`⚙️  Optimal execution window: ${this.results.avgFuturesLeadTime.toFixed(0)}ms`);
    } else if (futuresEdgeRate > 50) {
      console.log('⚠️  MODERATE FUTURES EDGE DETECTED');
      console.log('💡 Recommendation: Deploy with conservative position sizing');
    } else {
      console.log('❌ NO CLEAR FUTURES EDGE DETECTED');
      console.log('💡 Recommendation: More observation needed or different market conditions');
    }
    
    console.log('\n' + '='.repeat(80));
  }
}

class SpotWebSocketClient {
  constructor(validator) {
    this.validator = validator;
    this.ws = null;
  }
  
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://ws.kraken.com/v2');
      
      this.ws.on('open', () => {
        logger.info('✅ Spot WebSocket connected');
        resolve();
      });
      
      this.ws.on('error', reject);
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          logger.error('Spot WebSocket message error:', error);
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
          depth: 10
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
          this.validator.trackPrice(normalizedPair, 'spot', midPrice, Date.now());
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
      logger.info('Spot WebSocket disconnected');
    }
  }
}

class FuturesWebSocketClient {
  constructor(validator) {
    this.validator = validator;
    this.client = new KrakenFuturesWebSocketClient({ logger });
  }
  
  async connect() {
    await this.client.connect(false);
    
    this.client.on('orderBookUpdate', (data) => {
      const normalizedPair = this.normalizePair(data.symbol);
      if (data.midPrice) {
        this.validator.trackPrice(normalizedPair, 'futures', data.midPrice, Date.now());
      }
    });
    
    logger.info('✅ Futures WebSocket connected');
  }
  
  async subscribe() {
    const futuresPairs = Object.values(TEST_PAIRS).map(p => p.futures);
    await this.client.subscribe('book', futuresPairs);
  }
  
  normalizePair(symbol) {
    if (symbol === 'PF_XBTUSD') return 'BTC/USD';
    if (symbol === 'PF_ETHUSD') return 'ETH/USD';
    if (symbol === 'PF_SOLUSD') return 'SOL/USD';
    return symbol;
  }
  
  disconnect() {
    this.client.disconnect();
    logger.info('Futures WebSocket disconnected');
  }
}

async function validateFuturesEdge() {
  console.log('🚀 Simple Futures Edge Validation\n');
  console.log(`📋 Test Configuration:`);
  console.log(`  • Pairs: ${Object.keys(TEST_PAIRS).join(', ')}`);
  console.log(`  • Duration: ${VALIDATION_DURATION / 1000}s`);
  console.log(`  • Movement Threshold: ${MOVEMENT_THRESHOLD}%`);
  console.log(`  • Expected Edge: 2-8 second lead time\n`);

  const validator = new EdgeValidator();
  const spotClient = new SpotWebSocketClient(validator);
  const futuresClient = new FuturesWebSocketClient(validator);

  try {
    console.log('1️⃣ Connecting to Kraken WebSockets...');
    await Promise.all([
      spotClient.connect(),
      futuresClient.connect()
    ]);
    console.log('✅ Both WebSockets connected\n');

    console.log('2️⃣ Subscribing to market data...');
    await Promise.all([
      spotClient.subscribe(),
      futuresClient.subscribe()
    ]);
    console.log('✅ Subscriptions active\n');

    console.log(`3️⃣ Monitoring for ${VALIDATION_DURATION / 1000}s...`);
    console.log('   Looking for futures lead events...\n');

    // Progress updates
    const startTime = Date.now();
    const updateInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, VALIDATION_DURATION - elapsed);
      const progress = Math.round((elapsed / VALIDATION_DURATION) * 100);
      
      console.log(`⏱️  Progress ${progress}% | Movements: ${validator.results.totalMovements} | ` +
                  `Futures Leads: ${validator.results.futuresLeadCount} | ` +
                  `Edge Ops: ${validator.results.edgeOpportunities} | ` +
                  `Remaining: ${Math.round(remaining / 1000)}s`);
    }, 20000);

    await new Promise(resolve => setTimeout(resolve, VALIDATION_DURATION));
    clearInterval(updateInterval);

    console.log('\n4️⃣ Analysis complete. Generating report...\n');
    
    // Disconnect
    spotClient.disconnect();
    futuresClient.disconnect();

    // Generate final report
    validator.generateReport();

    console.log('\n🎉 Validation completed successfully!');

  } catch (error) {
    console.error('\n❌ Validation failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run validation
validateFuturesEdge().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});