/**
 * Unit Tests for MultiPairSettlementService
 *
 * Tests the multi-pair settlement service including:
 * - PostgreSQL session discovery
 * - Session grouping by pairs
 * - Uncovered position detection
 * - Batch take-profit creation integration
 * - Settlement status tracking
 * - Distributed locking
 * - Error handling and recovery
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { MultiPairSettlementService } from './multi-pair-settlement-service.js';

describe('MultiPairSettlementService', () => {
  let service;
  let mockRedis;
  let mockPg;
  let mockExchangeAdapter;

  beforeEach(() => {
    // Create mock Redis client
    mockRedis = {
      data: new Map(),
      async exists(key) {
        return this.data.has(key) ? 1 : 0;
      },
      async set(key, value, ...args) {
        // Handle SET with EX and NX options
        if (args.includes('NX') && this.data.has(key)) {
          return null; // Key exists, can't set with NX
        }
        const exIndex = args.indexOf('EX');
        const ttl = exIndex >= 0 ? args[exIndex + 1] : null;
        this.data.set(key, {
          value,
          ttl,
          expiresAt: ttl ? Date.now() + ttl * 1000 : null
        });
        return 'OK';
      },
      async setex(key, ttl, value) {
        this.data.set(key, {
          value,
          ttl,
          expiresAt: Date.now() + ttl * 1000
        });
        return 'OK';
      },
      async get(key) {
        const entry = this.data.get(key);
        if (!entry) return null;
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
          this.data.delete(key);
          return null;
        }
        return entry.value;
      },
      async del(key) {
        this.data.delete(key);
        return 1;
      },
      async quit() {
        return 'OK';
      }
    };

    // Create mock PostgreSQL client
    mockPg = {
      queryResults: [],
      async query(sql, params) {
        return { rows: this.queryResults };
      },
      async end() {
        return;
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
      }
    };

    // Create service with mocks
    service = new MultiPairSettlementService({
      redis: mockRedis,
      pg: mockPg,
      exchangeAdapter: mockExchangeAdapter,
      lookbackHours: 24,
      maxSessionsPerRun: 100,
      batchSize: 10,
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
      const defaultService = new MultiPairSettlementService({
        redis: mockRedis,
        pg: mockPg,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {}
        }
      });

      assert.ok(defaultService.config);
      assert.strictEqual(defaultService.config.lookbackHours, 24);
      assert.strictEqual(defaultService.config.maxSessionsPerRun, 100);
      assert.strictEqual(defaultService.config.batchSize, 10);
    });

    it('should accept custom configuration', () => {
      const customService = new MultiPairSettlementService({
        redis: mockRedis,
        pg: mockPg,
        lookbackHours: 48,
        maxSessionsPerRun: 50,
        batchSize: 5,
        dailyLossThreshold: 1000,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {}
        }
      });

      assert.strictEqual(customService.config.lookbackHours, 48);
      assert.strictEqual(customService.config.maxSessionsPerRun, 50);
      assert.strictEqual(customService.config.batchSize, 5);
      assert.strictEqual(customService.config.dailyLossThreshold, 1000);
    });

    it('should initialize MultiPairTakeProfitService', () => {
      assert.ok(service.takeProfitService);
    });
  });

  describe('discoverSessions', () => {
    it('should query PostgreSQL for active sessions', async () => {
      mockPg.queryResults = [
        {
          sessionid: 'session-1',
          symbol: 'ETH/USD',
          tradingpair: 'ETH/USD',
          exchange: 'kraken',
          strategy: 'multi-pair',
          startedat: new Date(),
          settlesession: true,
          settledcomplete: false
        }
      ];

      const sessions = await service.discoverSessions({
        lookbackHours: 24,
        limit: 100
      });

      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].sessionid, 'session-1');
      assert.strictEqual(sessions[0].symbol, 'ETH/USD');
    });

    it('should return empty array when no sessions found', async () => {
      mockPg.queryResults = [];

      const sessions = await service.discoverSessions();

      assert.strictEqual(sessions.length, 0);
    });
  });

  describe('groupSessionsByPairs', () => {
    it('should group sessions by sessionId', () => {
      const sessions = [
        {
          sessionid: 'session-1',
          symbol: 'ETH/USD',
          exchange: 'kraken',
          strategy: 'multi-pair',
          startedat: new Date()
        },
        {
          sessionid: 'session-1',
          symbol: 'BTC/USD',
          exchange: 'kraken',
          strategy: 'multi-pair',
          startedat: new Date()
        }
      ];

      const grouped = service.groupSessionsByPairs(sessions);

      assert.ok(grouped['session-1']);
      assert.strictEqual(grouped['session-1'].pairs.length, 2);
      assert.ok(grouped['session-1'].pairs.includes('ETH/USD'));
      assert.ok(grouped['session-1'].pairs.includes('BTC/USD'));
    });

    it('should handle multiple sessions', () => {
      const sessions = [
        {
          sessionid: 'session-1',
          symbol: 'ETH/USD',
          exchange: 'kraken'
        },
        {
          sessionid: 'session-2',
          symbol: 'BTC/USD',
          exchange: 'kraken'
        }
      ];

      const grouped = service.groupSessionsByPairs(sessions);

      assert.strictEqual(Object.keys(grouped).length, 2);
      assert.ok(grouped['session-1']);
      assert.ok(grouped['session-2']);
    });

    it('should deduplicate pairs within a session', () => {
      const sessions = [
        {
          sessionid: 'session-1',
          symbol: 'ETH/USD',
          exchange: 'kraken'
        },
        {
          sessionid: 'session-1',
          symbol: 'ETH/USD',
          exchange: 'kraken'
        }
      ];

      const grouped = service.groupSessionsByPairs(sessions);

      assert.strictEqual(grouped['session-1'].pairs.length, 1);
      assert.strictEqual(grouped['session-1'].pairs[0], 'ETH/USD');
    });
  });

  describe('Distributed Locking', () => {
    it('should acquire lock successfully', async () => {
      const acquired = await service.acquireLock('session-1');
      assert.strictEqual(acquired, true);
    });

    it('should fail to acquire lock when already locked', async () => {
      await service.acquireLock('session-1');
      const acquired = await service.acquireLock('session-1');
      assert.strictEqual(acquired, false);
    });

    it('should release lock successfully', async () => {
      await service.acquireLock('session-1');
      await service.releaseLock('session-1');

      // Should be able to acquire again
      const acquired = await service.acquireLock('session-1');
      assert.strictEqual(acquired, true);
    });
  });

  describe('Settlement Status Tracking', () => {
    it('should update settlement status', async () => {
      await service.updateSettlementStatus('session-1', 'IN_PROGRESS');

      const status = await mockRedis.get('settlement:status:session-1');
      assert.strictEqual(status, 'IN_PROGRESS');
    });

    it('should update settlement timestamp', async () => {
      await service.updateSettlementTimestamp('session-1');

      const timestamp = await mockRedis.get('settlement:last_run:session-1');
      assert.ok(timestamp);
      assert.ok(new Date(timestamp).getTime() > 0);
    });
  });

  describe('runSettlement', () => {
    it('should handle empty session list', async () => {
      mockPg.queryResults = [];

      const result = await service.runSettlement();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.sessionsProcessed, 0);
    });

    it('should process single session', async () => {
      mockPg.queryResults = [
        {
          sessionid: 'session-1',
          symbol: 'ETH/USD',
          exchange: 'kraken',
          strategy: 'multi-pair',
          startedat: new Date(),
          settlesession: true,
          settledcomplete: false
        }
      ];

      const result = await service.runSettlement();

      assert.strictEqual(result.success, true);
      assert.ok(result.runId);
      assert.ok(result.duration >= 0);
    });

    it('should update statistics after run', async () => {
      // Provide session data so the settlement actually processes
      mockPg.queryResults = [
        {
          sessionid: 'session-1',
          symbol: 'ETH/USD',
          exchange: 'kraken',
          strategy: 'multi-pair',
          startedat: new Date(),
          settlesession: true,
          settledcomplete: false
        }
      ];

      // Ensure we start from a known state
      service.resetStats();

      await service.runSettlement();
      const stats = service.getStats();

      assert.strictEqual(stats.totalRuns, 1);
      assert.ok(stats.lastRun);
    });
  });

  describe('Statistics', () => {
    it('should track statistics', () => {
      const stats = service.getStats();

      assert.ok(stats);
      assert.strictEqual(typeof stats.totalRuns, 'number');
      assert.strictEqual(typeof stats.totalSessionsProcessed, 'number');
      assert.strictEqual(typeof stats.totalPositionsCovered, 'number');
      assert.strictEqual(typeof stats.totalErrors, 'number');
    });

    it('should reset statistics', () => {
      service.stats.totalRuns = 10;
      service.stats.totalSessionsProcessed = 50;

      service.resetStats();

      assert.strictEqual(service.stats.totalRuns, 0);
      assert.strictEqual(service.stats.totalSessionsProcessed, 0);
    });
  });

  describe('queryUncoveredPositions', () => {
    it('should query positions for all pairs', async () => {
      const pairs = ['ETH/USD', 'BTC/USD'];

      const positionsByPair = await service.queryUncoveredPositions('session-1', pairs);

      assert.ok(positionsByPair);
      assert.ok(positionsByPair['ETH/USD']);
      assert.ok(positionsByPair['BTC/USD']);
      assert.ok(Array.isArray(positionsByPair['ETH/USD']));
      assert.ok(Array.isArray(positionsByPair['BTC/USD']));
    });

    it('should handle errors gracefully', async () => {
      const pairs = ['ETH/USD', 'INVALID/PAIR'];

      const positionsByPair = await service.queryUncoveredPositions('session-1', pairs);

      // Should still return empty arrays for all pairs
      assert.ok(positionsByPair);
      assert.ok(Array.isArray(positionsByPair['ETH/USD']));
      assert.ok(Array.isArray(positionsByPair['INVALID/PAIR']));
    });
  });

  describe('Error Handling', () => {
    it('should handle PostgreSQL query errors', async () => {
      // Make pg.query throw an error
      mockPg.query = async () => {
        throw new Error('Database connection failed');
      };

      const result = await service.runSettlement();

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('Database connection'));
    });

    it('should continue processing other sessions if one fails', async () => {
      mockPg.queryResults = [
        {
          sessionid: 'session-1',
          symbol: 'ETH/USD',
          exchange: 'kraken',
          strategy: 'multi-pair',
          startedat: new Date(),
          settlesession: true
        },
        {
          sessionid: 'session-2',
          symbol: 'BTC/USD',
          exchange: 'kraken',
          strategy: 'multi-pair',
          startedat: new Date(),
          settlesession: true
        }
      ];

      // Override processSession to fail for session-1
      const originalProcess = service.processSession.bind(service);
      service.processSession = async (sessionData, runId) => {
        if (sessionData.sessionId === 'session-1') {
          throw new Error('Session processing failed');
        }
        return originalProcess(sessionData, runId);
      };

      const result = await service.runSettlement();

      // Should still succeed overall
      assert.strictEqual(result.success, true);
    });
  });

  describe('Service Lifecycle', () => {
    it('should close cleanly', async () => {
      await service.close();
      assert.ok(true, 'Service closed without error');
    });

    it('should close take-profit service on close', async () => {
      let tpServiceClosed = false;
      service.takeProfitService.close = async () => {
        tpServiceClosed = true;
      };

      await service.close();
      assert.strictEqual(tpServiceClosed, true);
    });
  });

  describe('Configuration Validation', () => {
    it('should use environment variables as fallback', () => {
      const originalRedisUrl = process.env.DO_REDIS_URL;
      const originalDbUrl = process.env.DATABASE_URL;

      process.env.DO_REDIS_URL = 'redis://test:6379';
      process.env.DATABASE_URL = 'postgresql://test/db';

      const envService = new MultiPairSettlementService({
        redis: mockRedis,
        pg: mockPg,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {}
        }
      });

      assert.strictEqual(envService.config.redisUrl, 'redis://test:6379');
      assert.strictEqual(envService.config.databaseUrl, 'postgresql://test/db');

      // Restore
      process.env.DO_REDIS_URL = originalRedisUrl;
      process.env.DATABASE_URL = originalDbUrl;
    });
  });
});
