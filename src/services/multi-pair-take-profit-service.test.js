/**
 * Unit Tests for MultiPairTakeProfitService
 *
 * Tests the multi-pair take-profit service including:
 * - Batch take-profit creation across multiple pairs
 * - Parallel processing with error isolation
 * - Duplicate prevention
 * - Asset availability validation
 * - Order tracking in Redis
 * - Statistics aggregation
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { MultiPairTakeProfitService } from './multi-pair-take-profit-service.js';

describe('MultiPairTakeProfitService', () => {
  let service;
  let mockRedis;
  let mockExchangeAdapter;

  beforeEach(() => {
    // Create mock Redis client
    mockRedis = {
      data: new Map(),
      async exists(key) {
        return this.data.has(key) ? 1 : 0;
      },
      async setex(key, ttl, value) {
        this.data.set(key, { value, ttl, expiresAt: Date.now() + ttl * 1000 });
        return 'OK';
      },
      async get(key) {
        const entry = this.data.get(key);
        if (!entry) return null;
        if (entry.expiresAt < Date.now()) {
          this.data.delete(key);
          return null;
        }
        return entry.value;
      },
      async quit() {
        return 'OK';
      }
    };

    // Create mock exchange adapter
    mockExchangeAdapter = {
      orderCounter: 0,
      async createOrder(order) {
        this.orderCounter++;
        return {
          id: `EXCH-${this.orderCounter}`,
          status: 'open',
          ...order
        };
      },
      async getOrderBook(symbol) {
        return {
          bids: [[2000, 10]],
          asks: [[2010, 10]]
        };
      }
    };

    // Create service with mocks
    service = new MultiPairTakeProfitService({
      redis: mockRedis,
      exchangeAdapter: mockExchangeAdapter,
      enableAgingStrategy: false, // Use simple pricing for tests
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
      }
    });
  });

  after(async () => {
    if (service) {
      await service.close();
    }
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultService = new MultiPairTakeProfitService({
        redis: mockRedis,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {}
        }
      });

      assert.ok(defaultService.config);
      assert.strictEqual(defaultService.config.defaultTakeProfitPercentage, 0.01);
      assert.strictEqual(defaultService.config.usePostOnly, true);
      assert.strictEqual(defaultService.config.duplicatePreventionTTL, 3600);
    });

    it('should accept custom configuration', () => {
      const customService = new MultiPairTakeProfitService({
        redis: mockRedis,
        defaultTakeProfitPercentage: 0.02,
        usePostOnly: false,
        duplicatePreventionTTL: 7200,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {}
        }
      });

      assert.strictEqual(customService.config.defaultTakeProfitPercentage, 0.02);
      assert.strictEqual(customService.config.usePostOnly, false);
      assert.strictEqual(customService.config.duplicatePreventionTTL, 7200);
    });

    it('should initialize TakeProfitCore', () => {
      assert.ok(service.takeProfitCore);
    });

    it('should initialize ComprehensiveBalanceValidator when exchange adapter provided', () => {
      assert.ok(service.balanceValidator);
    });
  });

  describe('createBatchTakeProfits', () => {
    it('should handle empty positions', async () => {
      const result = await service.createBatchTakeProfits('session-1', {}, {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 }
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalPairs, 0);
      assert.strictEqual(result.created, 0);
      assert.strictEqual(result.failed, 0);
    });

    it('should process single pair', async () => {
      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: 'pos-1',
            buyOrderId: 'order-1',
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

      const result = await service.createBatchTakeProfits('session-1', positionsByPair, sessionData);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalPairs, 1);
      assert.strictEqual(result.created, 1);
      assert.strictEqual(result.failed, 0);
      assert.ok(result.results['ETH/USD']);
      assert.strictEqual(result.results['ETH/USD'].created, 1);
    });

    it('should process multiple pairs in parallel', async () => {
      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: 'pos-1',
            buyOrderId: 'order-1',
            buyPrice: 2000,
            quantity: 1.0,
            timestamp: Date.now()
          }
        ],
        'BTC/USD': [
          {
            positionId: 'pos-2',
            buyOrderId: 'order-2',
            buyPrice: 50000,
            quantity: 0.1,
            timestamp: Date.now()
          }
        ],
        'SOL/USD': [
          {
            positionId: 'pos-3',
            buyOrderId: 'order-3',
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

      const result = await service.createBatchTakeProfits('session-1', positionsByPair, sessionData);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalPairs, 3);
      assert.strictEqual(result.created, 3);
      assert.strictEqual(result.failed, 0);
      assert.ok(result.results['ETH/USD']);
      assert.ok(result.results['BTC/USD']);
      assert.ok(result.results['SOL/USD']);
    });

    it('should handle multiple positions per pair', async () => {
      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: 'pos-1',
            buyOrderId: 'order-1',
            buyPrice: 2000,
            quantity: 1.0,
            timestamp: Date.now()
          },
          {
            positionId: 'pos-2',
            buyOrderId: 'order-2',
            buyPrice: 2010,
            quantity: 0.5,
            timestamp: Date.now()
          },
          {
            positionId: 'pos-3',
            buyOrderId: 'order-3',
            buyPrice: 1990,
            quantity: 1.5,
            timestamp: Date.now()
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8
      };

      const result = await service.createBatchTakeProfits('session-1', positionsByPair, sessionData);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalPairs, 1);
      assert.strictEqual(result.totalPositions, 3);
      assert.strictEqual(result.created, 3);
      assert.strictEqual(result.results['ETH/USD'].created, 3);
    });

    it('should throw error for missing sessionId', async () => {
      await assert.rejects(
        async () => await service.createBatchTakeProfits(null, {}),
        /sessionId is required/
      );
    });

    it('should throw error for invalid positionsByPair', async () => {
      await assert.rejects(
        async () => await service.createBatchTakeProfits('session-1', null),
        /(positionsByPair must be an object|Cannot convert undefined or null to object)/
      );
    });
  });

  describe('Duplicate Prevention', () => {
    it('should detect duplicates', async () => {
      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: 'pos-1',
            buyOrderId: 'order-1',
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

      // First attempt - should succeed
      const result1 = await service.createBatchTakeProfits('session-1', positionsByPair, sessionData);
      assert.strictEqual(result1.created, 1);
      assert.strictEqual(result1.duplicates, 0);

      // Second attempt - should detect duplicate
      const result2 = await service.createBatchTakeProfits('session-1', positionsByPair, sessionData);
      assert.strictEqual(result2.created, 0);
      assert.strictEqual(result2.duplicates, 1);
    });

    it('should track duplicates per position', async () => {
      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: 'pos-1',
            buyOrderId: 'order-1',
            buyPrice: 2000,
            quantity: 1.0,
            timestamp: Date.now()
          },
          {
            positionId: 'pos-2',
            buyOrderId: 'order-2',
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

      // First attempt
      await service.createBatchTakeProfits('session-1', positionsByPair, sessionData);

      // Second attempt with one duplicate and one new
      const positionsByPair2 = {
        'ETH/USD': [
          {
            positionId: 'pos-1', // Duplicate
            buyOrderId: 'order-1',
            buyPrice: 2000,
            quantity: 1.0,
            timestamp: Date.now()
          },
          {
            positionId: 'pos-3', // New
            buyOrderId: 'order-3',
            buyPrice: 2020,
            quantity: 0.75,
            timestamp: Date.now()
          }
        ]
      };

      const result2 = await service.createBatchTakeProfits('session-1', positionsByPair2, sessionData);
      assert.strictEqual(result2.created, 1);
      assert.strictEqual(result2.duplicates, 1);
    });
  });

  describe('Order Tracking', () => {
    it('should track orders in Redis', async () => {
      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: 'pos-1',
            buyOrderId: 'order-1',
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

      await service.createBatchTakeProfits('session-1', positionsByPair, sessionData);

      // Check that order was tracked in Redis
      const orderKeys = Array.from(mockRedis.data.keys()).filter(k => k.startsWith('tp_order:'));
      assert.ok(orderKeys.length > 0, 'Order should be tracked in Redis');
    });

    it('should track duplicate attempts in Redis', async () => {
      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: 'pos-1',
            buyOrderId: 'order-1',
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

      await service.createBatchTakeProfits('session-1', positionsByPair, sessionData);

      // Check that attempt was tracked in Redis
      const attemptKeys = Array.from(mockRedis.data.keys()).filter(k => k.startsWith('tp_attempt:'));
      assert.ok(attemptKeys.length > 0, 'Attempt should be tracked in Redis');
    });
  });

  describe('Statistics', () => {
    it('should track statistics', async () => {
      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: 'pos-1',
            buyOrderId: 'order-1',
            buyPrice: 2000,
            quantity: 1.0,
            timestamp: Date.now()
          }
        ],
        'BTC/USD': [
          {
            positionId: 'pos-2',
            buyOrderId: 'order-2',
            buyPrice: 50000,
            quantity: 0.1,
            timestamp: Date.now()
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8
      };

      await service.createBatchTakeProfits('session-1', positionsByPair, sessionData);

      const stats = service.getStats();
      assert.strictEqual(stats.totalProcessed, 2);
      assert.strictEqual(stats.totalCreated, 2);
      assert.ok(stats.byPair['ETH/USD']);
      assert.ok(stats.byPair['BTC/USD']);
    });

    it('should reset statistics', () => {
      service.stats.totalCreated = 10;
      service.resetStats();
      assert.strictEqual(service.stats.totalCreated, 0);
    });
  });

  describe('Error Handling', () => {
    it('should isolate errors per pair', async () => {
      // Create a service with a failing exchange adapter for one symbol
      const failingAdapter = {
        async createOrder(order) {
          if (order.symbol === 'BTC/USD') {
            throw new Error('Exchange API error');
          }
          return {
            id: `EXCH-${Date.now()}`,
            status: 'open',
            ...order
          };
        }
      };

      const failingService = new MultiPairTakeProfitService({
        redis: mockRedis,
        exchangeAdapter: failingAdapter,
        enableAgingStrategy: false,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {}
        }
      });

      const positionsByPair = {
        'ETH/USD': [
          {
            positionId: 'pos-1',
            buyOrderId: 'order-1',
            buyPrice: 2000,
            quantity: 1.0,
            timestamp: Date.now()
          }
        ],
        'BTC/USD': [
          {
            positionId: 'pos-2',
            buyOrderId: 'order-2',
            buyPrice: 50000,
            quantity: 0.1,
            timestamp: Date.now()
          }
        ]
      };

      const sessionData = {
        actualExchangeFeeRates: { maker: 0.002, taker: 0.003 },
        pricePrecision: 2,
        sizePrecision: 8
      };

      const result = await failingService.createBatchTakeProfits('session-1', positionsByPair, sessionData);

      // ETH/USD should succeed, BTC/USD should fail
      assert.strictEqual(result.created, 1);
      assert.strictEqual(result.failed, 1);
      assert.strictEqual(result.results['ETH/USD'].created, 1);
      assert.strictEqual(result.results['BTC/USD'].failed, 1);

      await failingService.close();
    });
  });

  describe('Service Lifecycle', () => {
    it('should close cleanly', async () => {
      await service.close();
      assert.ok(true, 'Service closed without error');
    });
  });
});
