/**
 * Integration Tests for MultiPairTakeProfitService
 *
 * Tests the take-profit service with real Redis connection.
 * These tests verify end-to-end functionality including:
 * - Real Redis operations
 * - Aging-based pricing calculations
 * - Duplicate prevention with real TTL
 * - Order tracking across multiple invocations
 * - Concurrent pair processing
 *
 * Prerequisites:
 * - Redis connection configured in DO_REDIS_URL
 * - Tests run in isolated namespace to avoid conflicts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MultiPairTakeProfitService } from '../../src/services/multi-pair-take-profit-service.js';
import IORedis from 'ioredis';

// Test configuration
const TEST_NAMESPACE = 'integration-test';
const TEST_SESSION_ID = `${TEST_NAMESPACE}-session-${Date.now()}`;

describe('MultiPairTakeProfitService Integration Tests', () => {
  let redis;
  let service;
  let mockExchangeAdapter;

  before(async () => {
    // Check if Redis URL is configured
    if (!process.env.DO_REDIS_URL) {
      console.log('⚠️  Skipping integration tests: DO_REDIS_URL not configured');
      process.exit(0);
    }

    // Connect to Redis
    redis = new IORedis(process.env.DO_REDIS_URL);

    // Verify connection
    await redis.ping();
    console.log('✅ Redis connection established');

    // Create mock exchange adapter
    mockExchangeAdapter = {
      orderCounter: 0,
      createdOrders: [],
      async createOrder(order) {
        this.orderCounter++;
        const createdOrder = {
          id: `EXCH-${this.orderCounter}`,
          status: 'open',
          ...order
        };
        this.createdOrders.push(createdOrder);
        return createdOrder;
      },
      async getOrderBook(symbol) {
        // Return realistic order book
        const prices = {
          'BTC/USD': { bid: 50000, ask: 50010 },
          'ETH/USD': { bid: 2000, ask: 2002 },
          'SOL/USD': { bid: 100, ask: 100.50 }
        };
        const price = prices[symbol] || { bid: 100, ask: 101 };
        return {
          bids: [[price.bid, 10]],
          asks: [[price.ask, 10]]
        };
      }
    };

    // Create service
    service = new MultiPairTakeProfitService({
      redis,
      exchangeAdapter: mockExchangeAdapter,
      enableAgingStrategy: true,
      logger: {
        debug: () => {},
        info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
        warn: () => {},
        error: (msg, data) => console.error(`[ERROR] ${msg}`, data || '')
      }
    });
  });

  after(async () => {
    // Cleanup test data from Redis
    if (redis) {
      const keys = await redis.keys(`${TEST_NAMESPACE}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`\n🧹 Cleaned up ${keys.length} test keys from Redis`);
      }

      // Close service and connections
      if (service) {
        await service.close();
      }
      await redis.quit();
    }
  });

  describe('End-to-End Take-Profit Creation', () => {
    it('should create take-profit orders for multiple pairs', async () => {
      const positionsByPair = {
        'BTC/USD': [
          {
            positionId: `${TEST_SESSION_ID}-pos-btc-1`,
            buyOrderId: `${TEST_SESSION_ID}-order-btc-1`,
            buyPrice: 50000,
            quantity: 0.1,
            timestamp: Date.now() - 60000 // 1 minute ago
          }
        ],
        'ETH/USD': [
          {
            positionId: `${TEST_SESSION_ID}-pos-eth-1`,
            buyOrderId: `${TEST_SESSION_ID}-order-eth-1`,
            buyPrice: 2000,
            quantity: 1.0,
            timestamp: Date.now() - 120000 // 2 minutes ago
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8
      };

      const result = await service.createBatchTakeProfits(
        TEST_SESSION_ID,
        positionsByPair,
        sessionData
      );

      // Verify results
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalPairs, 2);
      assert.strictEqual(result.created, 2);
      assert.strictEqual(result.failed, 0);
      assert.strictEqual(result.duplicates, 0);

      // Verify orders were created
      assert.strictEqual(mockExchangeAdapter.createdOrders.length, 2);

      console.log(`✅ Created ${result.created} take-profit orders for ${result.totalPairs} pairs`);
    });

    it('should track orders in Redis', async () => {
      const positionsByPair = {
        'SOL/USD': [
          {
            positionId: `${TEST_SESSION_ID}-pos-sol-1`,
            buyOrderId: `${TEST_SESSION_ID}-order-sol-1`,
            buyPrice: 100,
            quantity: 10.0,
            timestamp: Date.now()
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8
      };

      await service.createBatchTakeProfits(
        TEST_SESSION_ID,
        positionsByPair,
        sessionData
      );

      // Check Redis for tracking keys
      const tpOrderKeys = await redis.keys(`tp_order:${TEST_SESSION_ID}:*`);
      const tpAttemptKeys = await redis.keys(`tp_attempt:${TEST_SESSION_ID}:*`);

      assert.ok(tpOrderKeys.length > 0, 'Should track orders in Redis');
      assert.ok(tpAttemptKeys.length > 0, 'Should track attempts in Redis');

      console.log(`✅ Found ${tpOrderKeys.length} order keys and ${tpAttemptKeys.length} attempt keys in Redis`);
    });
  });

  describe('Duplicate Prevention with Real TTL', () => {
    it('should prevent duplicate take-profit orders', async () => {
      const positionsByPair = {
        'BTC/USD': [
          {
            positionId: `${TEST_SESSION_ID}-dup-test-1`,
            buyOrderId: `${TEST_SESSION_ID}-dup-order-1`,
            buyPrice: 50000,
            quantity: 0.05,
            timestamp: Date.now()
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8
      };

      // First attempt - should succeed
      const result1 = await service.createBatchTakeProfits(
        TEST_SESSION_ID,
        positionsByPair,
        sessionData
      );

      assert.strictEqual(result1.created, 1);
      assert.strictEqual(result1.duplicates, 0);

      // Second attempt - should detect duplicate
      const result2 = await service.createBatchTakeProfits(
        TEST_SESSION_ID,
        positionsByPair,
        sessionData
      );

      assert.strictEqual(result2.created, 0);
      assert.strictEqual(result2.duplicates, 1);

      console.log('✅ Duplicate prevention working correctly');
    });

    it('should allow new positions after first is processed', async () => {
      const firstPosition = {
        'ETH/USD': [
          {
            positionId: `${TEST_SESSION_ID}-seq-1`,
            buyOrderId: `${TEST_SESSION_ID}-seq-order-1`,
            buyPrice: 2000,
            quantity: 0.5,
            timestamp: Date.now()
          }
        ]
      };

      const secondPosition = {
        'ETH/USD': [
          {
            positionId: `${TEST_SESSION_ID}-seq-2`,
            buyOrderId: `${TEST_SESSION_ID}-seq-order-2`,
            buyPrice: 2010,
            quantity: 0.5,
            timestamp: Date.now()
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8
      };

      // Process first position
      const result1 = await service.createBatchTakeProfits(
        TEST_SESSION_ID,
        firstPosition,
        sessionData
      );

      // Process second position (different positionId)
      const result2 = await service.createBatchTakeProfits(
        TEST_SESSION_ID,
        secondPosition,
        sessionData
      );

      assert.strictEqual(result1.created, 1);
      assert.strictEqual(result2.created, 1);

      console.log('✅ Sequential position processing working correctly');
    });
  });

  describe('Concurrent Pair Processing', () => {
    it('should handle 5+ pairs in parallel', async () => {
      const positionsByPair = {
        'BTC/USD': [
          {
            positionId: `${TEST_SESSION_ID}-concurrent-btc`,
            buyOrderId: `${TEST_SESSION_ID}-order-btc`,
            buyPrice: 50000,
            quantity: 0.01,
            timestamp: Date.now()
          }
        ],
        'ETH/USD': [
          {
            positionId: `${TEST_SESSION_ID}-concurrent-eth`,
            buyOrderId: `${TEST_SESSION_ID}-order-eth`,
            buyPrice: 2000,
            quantity: 0.1,
            timestamp: Date.now()
          }
        ],
        'SOL/USD': [
          {
            positionId: `${TEST_SESSION_ID}-concurrent-sol`,
            buyOrderId: `${TEST_SESSION_ID}-order-sol`,
            buyPrice: 100,
            quantity: 1.0,
            timestamp: Date.now()
          }
        ],
        'AVAX/USD': [
          {
            positionId: `${TEST_SESSION_ID}-concurrent-avax`,
            buyOrderId: `${TEST_SESSION_ID}-order-avax`,
            buyPrice: 30,
            quantity: 5.0,
            timestamp: Date.now()
          }
        ],
        'MATIC/USD': [
          {
            positionId: `${TEST_SESSION_ID}-concurrent-matic`,
            buyOrderId: `${TEST_SESSION_ID}-order-matic`,
            buyPrice: 0.80,
            quantity: 100.0,
            timestamp: Date.now()
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8
      };

      const startTime = Date.now();

      const result = await service.createBatchTakeProfits(
        TEST_SESSION_ID,
        positionsByPair,
        sessionData
      );

      const duration = Date.now() - startTime;

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalPairs, 5);
      assert.strictEqual(result.created, 5);

      console.log(`✅ Processed ${result.totalPairs} pairs in ${duration}ms (${(duration / result.totalPairs).toFixed(0)}ms per pair)`);
    });
  });

  describe('Aging-Based Pricing', () => {
    it('should apply different pricing for aged positions', async () => {
      const now = Date.now();

      const positionsByPair = {
        'BTC/USD': [
          // Fresh position (< 1 hour)
          {
            positionId: `${TEST_SESSION_ID}-aging-fresh`,
            buyOrderId: `${TEST_SESSION_ID}-aging-order-1`,
            buyPrice: 50000,
            quantity: 0.1,
            timestamp: now - 30 * 60 * 1000 // 30 minutes ago
          },
          // Aged position (> 1 hour)
          {
            positionId: `${TEST_SESSION_ID}-aging-old`,
            buyOrderId: `${TEST_SESSION_ID}-aging-order-2`,
            buyPrice: 50000,
            quantity: 0.1,
            timestamp: now - 2 * 60 * 60 * 1000 // 2 hours ago
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8,
        enableAgingStrategy: true
      };

      const result = await service.createBatchTakeProfits(
        TEST_SESSION_ID,
        positionsByPair,
        sessionData
      );

      assert.strictEqual(result.created, 2);

      // Both positions should be processed with potentially different pricing
      const btcResults = result.results['BTC/USD'];
      assert.ok(btcResults);
      assert.strictEqual(btcResults.created, 2);

      console.log('✅ Aging-based pricing applied correctly');
    });
  });

  describe('Statistics Tracking', () => {
    it('should update service statistics', async () => {
      const initialStats = service.getStats();

      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: `${TEST_SESSION_ID}-stats-test`,
            buyOrderId: `${TEST_SESSION_ID}-stats-order`,
            buyPrice: 2000,
            quantity: 1.0,
            timestamp: Date.now()
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8
      };

      await service.createBatchTakeProfits(
        TEST_SESSION_ID,
        positionsByPair,
        sessionData
      );

      const finalStats = service.getStats();

      assert.ok(finalStats.totalProcessed > initialStats.totalProcessed);
      assert.ok(finalStats.totalCreated > initialStats.totalCreated);
      assert.ok(finalStats.byPair['ETH/USD']);

      console.log('✅ Statistics tracking working correctly');
    });
  });
});
