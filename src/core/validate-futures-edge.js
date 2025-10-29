#!/usr/bin/env node
/**
 * Validate Futures Edge Test
 * 
 * This test runs the complete multi-pair system with real Kraken data
 * to measure and validate the futures leading indicator advantage.
 * 
 * Key metrics measured:
 * - Futures price movement detection speed
 * - Spot price response lag time  
 * - Lead time distribution across pairs
 * - Edge effectiveness for each trading pair
 */

import dotenv from 'dotenv';
dotenv.config();

import { MultiPairOpportunisticTrader } from './MultiPairOpportunisticTrader.js';
import { KrakenWebSocketV2ExchangeAdapter } from '../../utils/exchange/KrakenWebSocketV2ExchangeAdapter.js';
import { LoggerFactory } from '../../utils/logger-factory.js';
import { OrderManager as RedisOrderManager, FillManager as RedisFillManager, KeyGenerator } from '../../lib/redis-backend-api/index.js';
import Redis from '../../lib/utils/redis-client.js';

const logger = LoggerFactory.createLogger({ component: 'FuturesEdgeValidation' });

// Test configuration
const TEST_PAIRS = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
const VALIDATION_DURATION = 300000; // 5 minutes of real data
const MOVEMENT_THRESHOLD = 0.02; // 0.02% minimum movement to track
const LEAD_TIME_BUCKETS = [0, 1000, 2000, 3000, 5000, 8000, 15000]; // milliseconds

class FuturesEdgeValidator {
  constructor() {
    this.results = {
      totalMovements: 0,
      futuresLeadEvents: 0,
      spotLeadEvents: 0,
      simultaneousEvents: 0,
      leadTimes: [],
      pairResults: {}
    };
    
    // Initialize pair-specific tracking
    TEST_PAIRS.forEach(pair => {
      this.results.pairResults[pair] = {
        futuresMovements: 0,
        spotMovements: 0,
        leadEvents: 0,
        averageLeadTime: 0,
        leadTimeDistribution: {},
        maxLeadTime: 0,
        edgeOpportunities: 0
      };
      
      // Initialize lead time buckets
      LEAD_TIME_BUCKETS.forEach((bucket, i) => {
        const nextBucket = LEAD_TIME_BUCKETS[i + 1] || 'max';
        const bucketKey = `${bucket}-${nextBucket}ms`;
        this.results.pairResults[pair].leadTimeDistribution[bucketKey] = 0;
      });
    });
    
    this.priceHistory = new Map(); // Track price movements
    this.movementEvents = []; // Store all detected movements
  }
  
  // Track price movements and calculate lead times
  trackMovement(pair, type, price, timestamp, movement) {
    const event = {
      pair,
      type, // 'futures' or 'spot'
      price,
      timestamp,
      movement,
      id: `${pair}_${type}_${timestamp}`
    };
    
    this.movementEvents.push(event);
    
    // Look for corresponding movement in the other market
    const oppositeType = type === 'futures' ? 'spot' : 'futures';
    const timeWindow = 10000; // 10 second window to find corresponding movement
    
    const correspondingEvent = this.movementEvents
      .filter(e => 
        e.pair === pair && 
        e.type === oppositeType &&
        Math.abs(e.timestamp - timestamp) <= timeWindow &&
        Math.sign(e.movement) === Math.sign(movement) // Same direction
      )
      .sort((a, b) => Math.abs(a.timestamp - timestamp) - Math.abs(b.timestamp - timestamp))[0];
    
    if (correspondingEvent) {
      const leadTime = timestamp - correspondingEvent.timestamp;
      const leadingMarket = leadTime > 0 ? correspondingEvent.type : type;
      const actualLeadTime = Math.abs(leadTime);
      
      if (actualLeadTime > 100) { // Ignore movements within 100ms (noise)
        this.recordLeadEvent(pair, leadingMarket, actualLeadTime, movement);
      }
    }
  }
  
  recordLeadEvent(pair, leadingMarket, leadTime, movement) {
    this.results.totalMovements++;
    this.results.pairResults[pair].leadEvents++;
    
    if (leadingMarket === 'futures') {
      this.results.futuresLeadEvents++;
      this.results.leadTimes.push(leadTime);
      this.results.pairResults[pair].averageLeadTime = 
        (this.results.pairResults[pair].averageLeadTime * (this.results.pairResults[pair].leadEvents - 1) + leadTime) / 
        this.results.pairResults[pair].leadEvents;
      
      if (leadTime > this.results.pairResults[pair].maxLeadTime) {
        this.results.pairResults[pair].maxLeadTime = leadTime;
      }
      
      // Categorize into lead time buckets
      for (let i = 0; i < LEAD_TIME_BUCKETS.length - 1; i++) {
        if (leadTime >= LEAD_TIME_BUCKETS[i] && leadTime < LEAD_TIME_BUCKETS[i + 1]) {
          const bucketKey = `${LEAD_TIME_BUCKETS[i]}-${LEAD_TIME_BUCKETS[i + 1]}ms`;
          this.results.pairResults[pair].leadTimeDistribution[bucketKey]++;
          break;
        }
      }
      
      // Count as edge opportunity if lead time is 2-8 seconds
      if (leadTime >= 2000 && leadTime <= 8000) {
        this.results.pairResults[pair].edgeOpportunities++;
      }
      
      logger.info('🎯 Futures lead detected!', {
        pair,
        leadTime: leadTime + 'ms',
        movement: movement.toFixed(3) + '%',
        opportunity: leadTime >= 2000 && leadTime <= 8000
      });
    } else {
      this.results.spotLeadEvents++;
      logger.debug('Spot led futures', { pair, leadTime: leadTime + 'ms' });
    }
  }
  
  generateReport() {
    const totalLeadEvents = this.results.futuresLeadEvents + this.results.spotLeadEvents;
    const futuresEdgePercentage = totalLeadEvents > 0 ? 
      (this.results.futuresLeadEvents / totalLeadEvents * 100) : 0;
    
    console.log('\n' + '='.repeat(80));
    console.log('🔬 FUTURES EDGE VALIDATION RESULTS');
    console.log('='.repeat(80));
    
    console.log('\n📊 Overall Statistics:');
    console.log(`  • Total Price Movements Analyzed: ${this.results.totalMovements}`);
    console.log(`  • Futures Led Spot: ${this.results.futuresLeadEvents} (${futuresEdgePercentage.toFixed(1)}%)`);
    console.log(`  • Spot Led Futures: ${this.results.spotLeadEvents} (${(100 - futuresEdgePercentage).toFixed(1)}%)`);
    
    if (this.results.leadTimes.length > 0) {
      const avgLeadTime = this.results.leadTimes.reduce((a, b) => a + b, 0) / this.results.leadTimes.length;
      const maxLeadTime = Math.max(...this.results.leadTimes);
      const minLeadTime = Math.min(...this.results.leadTimes);
      
      console.log(`  • Average Futures Lead Time: ${avgLeadTime.toFixed(0)}ms`);
      console.log(`  • Lead Time Range: ${minLeadTime}ms - ${maxLeadTime}ms`);
    }
    
    console.log('\n💰 Trading Edge Analysis:');
    let totalOpportunities = 0;
    
    TEST_PAIRS.forEach(pair => {
      const pairData = this.results.pairResults[pair];
      totalOpportunities += pairData.edgeOpportunities;
      
      console.log(`\n  🪙 ${pair}:`);
      console.log(`    • Lead Events: ${pairData.leadEvents}`);
      console.log(`    • Average Lead Time: ${pairData.averageLeadTime.toFixed(0)}ms`);
      console.log(`    • Max Lead Time: ${pairData.maxLeadTime}ms`);
      console.log(`    • Edge Opportunities (2-8s): ${pairData.edgeOpportunities}`);
      
      if (pairData.leadEvents > 0) {
        const edgeRate = (pairData.edgeOpportunities / pairData.leadEvents * 100);
        console.log(`    • Edge Rate: ${edgeRate.toFixed(1)}%`);
        
        console.log(`    • Lead Time Distribution:`);
        Object.entries(pairData.leadTimeDistribution).forEach(([bucket, count]) => {
          if (count > 0) {
            console.log(`      - ${bucket}: ${count} events`);
          }
        });
      }
    });
    
    console.log(`\n🎯 Total Edge Opportunities Found: ${totalOpportunities}`);
    
    if (totalOpportunities > 0) {
      const opportunityRate = (totalOpportunities / this.results.totalMovements * 100);
      console.log(`📈 Edge Opportunity Rate: ${opportunityRate.toFixed(2)}% of all movements`);
      
      // Estimate potential profit
      const estimatedTradesPerHour = (totalOpportunities / (VALIDATION_DURATION / 1000)) * 3600;
      console.log(`⚡ Estimated Edge Trades Per Hour: ${estimatedTradesPerHour.toFixed(1)}`);
      
      console.log('\n✅ FUTURES EDGE CONFIRMED - System provides measurable advantage!');
    } else {
      console.log('\n⚠️  No clear edge detected in this time period');
    }
    
    console.log('\n' + '='.repeat(80));
  }
}

// Enhanced adapter to track price movements
class EdgeValidationAdapter extends KrakenWebSocketV2ExchangeAdapter {
  constructor(config, validator) {
    super(config);
    this.validator = validator;
    this.lastPrices = new Map(); // Track last prices for movement detection
  }

  // Override orderbook handling to detect movements
  _handleOrderBookUpdate(data) {
    super._handleOrderBookUpdate(data);
    
    const symbol = data.symbol || data.pair;
    const currentPrice = data.midPrice;
    
    if (currentPrice && symbol) {
      const lastPrice = this.lastPrices.get(symbol);
      
      if (lastPrice) {
        const movement = ((currentPrice - lastPrice) / lastPrice) * 100;
        
        if (Math.abs(movement) >= MOVEMENT_THRESHOLD) {
          // Determine if this is spot or futures data
          const marketType = symbol.startsWith('PF_') ? 'futures' : 'spot';
          const normalizedPair = this.normalizePairName(symbol);
          
          this.validator.trackMovement(
            normalizedPair,
            marketType,
            currentPrice,
            Date.now(),
            movement
          );
        }
      }
      
      this.lastPrices.set(symbol, currentPrice);
    }
  }
  
  normalizePairName(symbol) {
    // Convert various symbol formats to our standard format
    if (symbol.startsWith('PF_')) {
      const base = symbol.replace('PF_', '').replace('USD', '');
      if (base === 'XBT') return 'BTC/USD';
      return `${base}/USD`;
    }
    
    if (symbol === 'XBT/USD') return 'BTC/USD';
    return symbol;
  }
}

async function validateFuturesEdge() {
  console.log('🚀 Starting Futures Edge Validation Test\n');
  console.log(`📋 Configuration:`);
  console.log(`  • Trading Pairs: ${TEST_PAIRS.join(', ')}`);
  console.log(`  • Test Duration: ${VALIDATION_DURATION / 1000} seconds`);
  console.log(`  • Movement Threshold: ${MOVEMENT_THRESHOLD}%`);
  console.log(`  • Expected Edge Window: 2-8 seconds\n`);

  const validator = new FuturesEdgeValidator();

  try {
    // Set up Redis connection
    const redis = new Redis({
      url: process.env.REDIS_URL || process.env.REDIS_URL,
      token: process.env.DO_REDIS_TOKEN || process.env.REDIS_TOKEN
    });

    console.log('1️⃣ Creating enhanced exchange adapter...');
    
    const sessionId = `edge_validation_${Date.now()}`;
    const keyGenerator = new KeyGenerator({
      strategy: 'futures_edge_validation',
      exchange: 'kraken',
      symbol: TEST_PAIRS[0],
      sessionId: sessionId
    });
    
    const exchangeAdapter = new EdgeValidationAdapter({
      symbol: TEST_PAIRS[0],
      pairs: TEST_PAIRS,
      sessionId: sessionId,
      logger: logger,
      paperMode: true,
      budget: 10000, // Add budget for paper trading
      redis: redis,
      redisOrderManager: new RedisOrderManager({
        redis,
        logger: logger.createChild('RedisOrderManager'),
        keyGenerator
      }),
      redisFillManager: new RedisFillManager({
        redis,
        logger: logger.createChild('RedisFillManager'),
        keyGenerator
      })
    }, validator);

    console.log('✅ Exchange adapter created\n');

    console.log('2️⃣ Creating multi-pair trader...');
    const trader = new MultiPairOpportunisticTrader({
      pairs: TEST_PAIRS,
      budget: 10000,
      exchange: 'kraken',
      exchangeAdapter: exchangeAdapter,
      enableFuturesLeadDetection: true, // Enable futures data collection
      mainLoopInterval: 1000, // 1 second for responsive detection
      logger: logger
    });

    console.log('✅ Multi-pair trader created\n');

    console.log('3️⃣ Starting data collection...');
    await trader.start();
    console.log('✅ Real-time data collection started\n');

    console.log(`4️⃣ Collecting data for ${VALIDATION_DURATION / 1000} seconds...`);
    console.log('   Monitoring for futures lead events...\n');

    // Show periodic updates
    const updateInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, VALIDATION_DURATION - elapsed);
      
      console.log(`⏱️  Progress: ${Math.round((elapsed / VALIDATION_DURATION) * 100)}% | ` +
                  `Movements: ${validator.results.totalMovements} | ` +
                  `Futures Leads: ${validator.results.futuresLeadEvents} | ` +
                  `Remaining: ${Math.round(remaining / 1000)}s`);
    }, 15000); // Update every 15 seconds

    const startTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, VALIDATION_DURATION));

    clearInterval(updateInterval);

    console.log('\n5️⃣ Stopping data collection...');
    await trader.stop();
    console.log('✅ Data collection stopped\n');

    // Generate comprehensive report
    validator.generateReport();

    // Final recommendations
    console.log('\n💡 Recommendations:');
    if (validator.results.futuresLeadEvents > validator.results.spotLeadEvents) {
      console.log('✅ Futures consistently lead spot - deploy with confidence');
      console.log('⚙️  Recommended settings:');
      
      const avgLeadTime = validator.results.leadTimes.length > 0 ? 
        validator.results.leadTimes.reduce((a, b) => a + b, 0) / validator.results.leadTimes.length : 0;
      
      console.log(`   • Execution window: ${Math.max(2000, avgLeadTime - 1000)}ms`);
      console.log(`   • Position size: Start conservative with 1-2% per trade`);
      console.log(`   • Focus pairs: ${TEST_PAIRS.filter(pair => 
        validator.results.pairResults[pair].edgeOpportunities > 0
      ).join(', ')}`);
    } else {
      console.log('⚠️  Edge not consistently detected - need longer observation period');
      console.log('📊 Consider running validation during high volatility periods');
    }

    await redis.quit();
    console.log('\n🎉 Validation test completed successfully!');

  } catch (error) {
    console.error('\n❌ Validation test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the validation
validateFuturesEdge().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});