#!/usr/bin/env node
/**
 * Debug Edge Validation - Show actual data being received
 */

import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import { KrakenFuturesWebSocketClient } from '../../lib/exchanges/KrakenFuturesWebSocketClient.js';
import { LoggerFactory } from '../../utils/logger-factory.js';

const logger = LoggerFactory.createLogger({ component: 'DebugEdgeValidation' });

const TEST_PAIRS = {
  'BTC/USD': { spot: 'XBT/USD', futures: 'PF_XBTUSD' },
  'ETH/USD': { spot: 'ETH/USD', futures: 'PF_ETHUSD' },
  'SOL/USD': { spot: 'SOL/USD', futures: 'PF_SOLUSD' }
};

const MOVEMENT_THRESHOLD = 0.01; // Lower threshold to catch more movements

class DataCollector {
  constructor() {
    this.spotPrices = new Map();
    this.futuresPrices = new Map();
    this.spotUpdates = 0;
    this.futuresUpdates = 0;
    this.movements = [];
  }
  
  updateSpotPrice(pair, price, timestamp) {
    this.spotUpdates++;
    const lastData = this.spotPrices.get(pair);
    
    if (lastData && lastData.price) {
      const movement = ((price - lastData.price) / lastData.price) * 100;
      
      if (Math.abs(movement) >= MOVEMENT_THRESHOLD) {
        const movementData = {
          pair,
          market: 'spot',
          price,
          movement,
          timestamp,
          direction: movement > 0 ? 'UP' : 'DOWN'
        };
        
        this.movements.push(movementData);
        console.log(`📊 SPOT ${pair}: ${movement.toFixed(3)}% ${movementData.direction} to $${price.toFixed(2)}`);
        
        this.checkForLeadEvent(movementData);
      }
    }
    
    this.spotPrices.set(pair, { price, timestamp });
  }
  
  updateFuturesPrice(pair, price, timestamp) {
    this.futuresUpdates++;
    const lastData = this.futuresPrices.get(pair);
    
    if (lastData && lastData.price) {
      const movement = ((price - lastData.price) / lastData.price) * 100;
      
      if (Math.abs(movement) >= MOVEMENT_THRESHOLD) {
        const movementData = {
          pair,
          market: 'futures',
          price,
          movement,
          timestamp,
          direction: movement > 0 ? 'UP' : 'DOWN'
        };
        
        this.movements.push(movementData);
        console.log(`🚀 FUTURES ${pair}: ${movement.toFixed(3)}% ${movementData.direction} to $${price.toFixed(2)}`);
        
        this.checkForLeadEvent(movementData);
      }
    }
    
    this.futuresPrices.set(pair, { price, timestamp });
  }
  
  checkForLeadEvent(currentEvent) {
    const oppositeMarket = currentEvent.market === 'spot' ? 'futures' : 'spot';
    const timeWindow = 10000; // 10 second window
    
    // Find corresponding movement in opposite market
    const correspondingEvents = this.movements
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
      
      if (actualLeadTime > 200 && actualLeadTime < 15000) {
        console.log(`🎯 LEAD EVENT: ${leadingMarket.toUpperCase()} led ${currentEvent.pair} by ${actualLeadTime}ms`);
        console.log(`   Movement: ${currentEvent.movement.toFixed(3)}% ${currentEvent.direction}`);
        
        if (leadingMarket === 'futures' && actualLeadTime >= 2000 && actualLeadTime <= 8000) {
          console.log(`   ✅ TRADEABLE EDGE OPPORTUNITY!`);
        }
      }
    }
  }
  
  getStats() {
    return {
      spotUpdates: this.spotUpdates,
      futuresUpdates: this.futuresUpdates,
      totalMovements: this.movements.length,
      spotMovements: this.movements.filter(m => m.market === 'spot').length,
      futuresMovements: this.movements.filter(m => m.market === 'futures').length
    };
  }
}

class DebugSpotClient {
  constructor(collector) {
    this.collector = collector;
    this.ws = null;
    this.messageCount = 0;
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
        this.messageCount++;
        if (this.messageCount % 100 === 0) {
          console.log(`📈 Spot messages received: ${this.messageCount}`);
        }
        
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error('Spot message parse error:', error);
        }
      });
    });
  }
  
  async subscribe() {
    const pairs = Object.values(TEST_PAIRS).map(p => p.spot);
    console.log('Subscribing to spot pairs:', pairs);
    
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
      console.log(`📊 Subscribed to spot ${pair}`);
    }
  }
  
  handleMessage(message) {
    if (message.channel === 'book' && message.data) {
      for (const bookData of message.data) {
        const symbol = bookData.symbol;
        const normalizedPair = this.normalizePair(symbol);
        
        if (bookData.bids && bookData.asks && bookData.bids.length > 0 && bookData.asks.length > 0) {
          const midPrice = (parseFloat(bookData.bids[0].price) + parseFloat(bookData.asks[0].price)) / 2;
          this.collector.updateSpotPrice(normalizedPair, midPrice, Date.now());
        }
      }
    } else if (message.method === 'subscribe' && message.result) {
      console.log(`✅ Spot subscription confirmed: ${message.result.symbol}`);
    }
  }
  
  normalizePair(symbol) {
    if (symbol === 'XBT/USD') return 'BTC/USD';
    return symbol;
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      console.log('Spot WebSocket disconnected');
    }
  }
}

class DebugFuturesClient {
  constructor(collector) {
    this.collector = collector;
    this.client = new KrakenFuturesWebSocketClient({ logger });
    this.updateCount = 0;
  }
  
  async connect() {
    await this.client.connect(false);
    
    this.client.on('orderBookUpdate', (data) => {
      this.updateCount++;
      if (this.updateCount % 50 === 0) {
        console.log(`🚀 Futures updates received: ${this.updateCount}`);
      }
      
      const normalizedPair = this.normalizePair(data.symbol);
      if (data.midPrice && normalizedPair) {
        this.collector.updateFuturesPrice(normalizedPair, data.midPrice, Date.now());
      }
    });
    
    console.log('✅ Futures WebSocket connected');
  }
  
  async subscribe() {
    const futuresPairs = Object.values(TEST_PAIRS).map(p => p.futures);
    console.log('Subscribing to futures pairs:', futuresPairs);
    
    await this.client.subscribe('book', futuresPairs);
    console.log('🚀 Subscribed to all futures pairs');
  }
  
  normalizePair(symbol) {
    if (symbol === 'PF_XBTUSD') return 'BTC/USD';
    if (symbol === 'PF_ETHUSD') return 'ETH/USD';
    if (symbol === 'PF_SOLUSD') return 'SOL/USD';
    return null;
  }
  
  disconnect() {
    this.client.disconnect();
    console.log('Futures WebSocket disconnected');
  }
}

async function debugEdgeValidation() {
  console.log('🔍 Debug Edge Validation - Real Data Analysis\n');
  console.log(`Movement threshold: ${MOVEMENT_THRESHOLD}%`);
  console.log(`Monitoring pairs: ${Object.keys(TEST_PAIRS).join(', ')}\n`);

  const collector = new DataCollector();
  const spotClient = new DebugSpotClient(collector);
  const futuresClient = new DebugFuturesClient(collector);

  try {
    console.log('1️⃣ Connecting to WebSockets...');
    await Promise.all([
      spotClient.connect(),
      futuresClient.connect()
    ]);

    console.log('\n2️⃣ Subscribing to data feeds...');
    await Promise.all([
      spotClient.subscribe(),
      futuresClient.subscribe()
    ]);

    console.log('\n3️⃣ Collecting data for 60 seconds...\n');

    // Show stats every 10 seconds
    const statsInterval = setInterval(() => {
      const stats = collector.getStats();
      console.log(`\n📊 Current Stats:`);
      console.log(`   • Spot Updates: ${stats.spotUpdates}`);
      console.log(`   • Futures Updates: ${stats.futuresUpdates}`);
      console.log(`   • Total Movements: ${stats.totalMovements}`);
      console.log(`   • Spot Movements: ${stats.spotMovements}`);
      console.log(`   • Futures Movements: ${stats.futuresMovements}\n`);
    }, 10000);

    await new Promise(resolve => setTimeout(resolve, 60000));
    clearInterval(statsInterval);

    console.log('\n4️⃣ Final Results:');
    const finalStats = collector.getStats();
    console.log(finalStats);

    if (finalStats.totalMovements === 0) {
      console.log('\n⚠️  No movements detected. Possible issues:');
      console.log('   • Market too quiet (low volatility)');
      console.log('   • Movement threshold too high');
      console.log('   • WebSocket data not flowing correctly');
      
      console.log('\n📊 Sample prices:');
      collector.spotPrices.forEach((data, pair) => {
        console.log(`   Spot ${pair}: $${data.price?.toFixed(2) || 'N/A'}`);
      });
      collector.futuresPrices.forEach((data, pair) => {
        console.log(`   Futures ${pair}: $${data.price?.toFixed(2) || 'N/A'}`);
      });
    } else {
      console.log('✅ Data collection successful!');
    }

    spotClient.disconnect();
    futuresClient.disconnect();

  } catch (error) {
    console.error('\n❌ Debug validation failed:', error);
    process.exit(1);
  }
}

debugEdgeValidation().catch(console.error);