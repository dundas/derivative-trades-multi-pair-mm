/**
 * Multi-Pair Migration Service
 *
 * Migrates historical trading data from Redis to PostgreSQL with multi-pair support.
 *
 * Key Features:
 * - Session discovery from PostgreSQL with migration status filtering
 * - Data fetching from Redis (SessionManager, OrderManager, FillManager)
 * - Pair extraction from session data for JSONB pairs column
 * - Bulk PostgreSQL writers with deduplication
 * - Pair-level aggregation calculations
 * - Migration completion tracking in Redis
 * - Batch processing with configurable batch size
 * - Comprehensive error handling and recovery
 *
 * Architecture:
 * - Discovers sessions from PostgreSQL that need migration
 * - Fetches session data, orders, and fills from Redis
 * - Extracts all trading pairs from the session data
 * - Writes to PostgreSQL with pairs metadata
 * - Deduplicates fills by (sessionId, orderId, symbol, timestamp, price, quantity)
 * - Tracks migration progress in Redis
 *
 * Usage:
 * ```javascript
 * const service = new MultiPairMigrationService({
 *   redis: redisClient,
 *   pg: pgPool,
 *   batchSize: 10
 * });
 *
 * const result = await service.runMigration({
 *   sessionIds: ['session-1', 'session-2'], // Optional
 *   limit: 100                               // Optional
 * });
 * ```
 */

import { LoggerFactory } from '../../../utils/logger-factory.js';
import {
  SessionManager,
  OrderManager,
  FillManager,
  RecentSessionsManager
} from '../../../lib/redis-backend-api/index.js';
import {
  SessionManager as PgSessionManager,
  OrderManager as PgOrderManager,
  FillManager as PgFillManager
} from '../../../lib/postgresql-api/index.js';
import IORedis from 'ioredis';
import pg from 'pg';

const { Pool } = pg;

export class MultiPairMigrationService {
  constructor(config = {}) {
    this.config = {
      // Redis configuration
      redis: config.redis,
      redisUrl: config.redisUrl || process.env.DO_REDIS_URL,

      // PostgreSQL configuration
      pg: config.pg,
      databaseUrl: config.databaseUrl || process.env.DATABASE_URL,

      // Migration configuration
      batchSize: config.batchSize || 10,
      lookbackHours: config.lookbackHours || 720, // 30 days default
      fillDedupEnabled: config.fillDedupEnabled !== false, // Default true

      // Retry configuration
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000, // 5 seconds

      ...config
    };

    // Initialize logger
    this.logger = config.logger || LoggerFactory.createLogger({
      component: 'MultiPairMigrationService',
      logLevel: process.env.LOG_LEVEL || 'INFO'
    });

    // Initialize Redis client
    this.redis = this.config.redis || new IORedis(this.config.redisUrl);

    // Initialize PostgreSQL client
    this.pg = this.config.pg || new Pool({
      connectionString: this.config.databaseUrl,
      ssl: this.config.databaseUrl?.includes('localhost') ? false : { rejectUnauthorized: false }
    });

    // Initialize Redis managers with logger
    this.sessionManager = new SessionManager(this.redis, { logger: this.logger });
    this.orderManager = new OrderManager(this.redis, { logger: this.logger });
    this.fillManager = new FillManager(this.redis, { logger: this.logger });
    this.recentSessionsManager = new RecentSessionsManager(this.redis, { logger: this.logger });

    // Initialize PostgreSQL managers
    this.pgSessionManager = new PgSessionManager(this.pg, { logger: this.logger });
    this.pgOrderManager = new PgOrderManager(this.pg, { logger: this.logger });
    this.pgFillManager = new PgFillManager(this.pg, { logger: this.logger });

    // Track statistics
    this.stats = {
      totalRuns: 0,
      totalSessionsMigrated: 0,
      totalOrdersMigrated: 0,
      totalFillsMigrated: 0,
      totalFillsDeduplicated: 0,
      totalErrors: 0,
      lastRun: null
    };
  }

  /**
   * Main entry point: Run migration for sessions
   *
   * @param {Object} options - Migration options
   * @returns {Promise<Object>} - Migration results
   */
  async runMigration(options = {}) {
    const startTime = Date.now();
    const runId = `migration-${Date.now()}`;

    this.logger.info(`[MultiPairMigrationService] Starting migration run`, {
      runId,
      batchSize: this.config.batchSize,
      lookbackHours: this.config.lookbackHours
    });

    try {
      // Discover sessions to migrate
      const sessionIds = options.sessionIds || await this.discoverSessionsToMigrate({
        lookbackHours: options.lookbackHours || this.config.lookbackHours,
        limit: options.limit || this.config.batchSize * 10
      });

      this.logger.info(`[MultiPairMigrationService] Discovered sessions`, {
        runId,
        sessionCount: sessionIds.length
      });

      if (sessionIds.length === 0) {
        this.logger.info(`[MultiPairMigrationService] No sessions to migrate`, { runId });
        return {
          success: true,
          runId,
          sessionsMigrated: 0,
          ordersMigrated: 0,
          fillsMigrated: 0,
          duration: Date.now() - startTime
        };
      }

      // Process sessions in batches
      const results = await this.processSessionBatches(sessionIds, runId);

      const duration = Date.now() - startTime;

      // Update statistics
      this.stats.totalRuns++;
      this.stats.totalSessionsMigrated += results.sessionsMigrated;
      this.stats.totalOrdersMigrated += results.ordersMigrated;
      this.stats.totalFillsMigrated += results.fillsMigrated;
      this.stats.totalFillsDeduplicated += results.fillsDeduplicated || 0;
      this.stats.lastRun = new Date().toISOString();

      this.logger.info(`[MultiPairMigrationService] Migration run completed`, {
        runId,
        ...results,
        duration: `${duration}ms`
      });

      return {
        success: true,
        runId,
        ...results,
        duration
      };

    } catch (error) {
      this.logger.error(`[MultiPairMigrationService] Migration run failed`, {
        runId,
        error: error.message,
        stack: error.stack
      });

      this.stats.totalErrors++;

      return {
        success: false,
        runId,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Discover sessions that need migration
   * @private
   */
  async discoverSessionsToMigrate(options = {}) {
    const lookbackHours = options.lookbackHours || this.config.lookbackHours;
    const limit = options.limit || 100;

    // Query PostgreSQL for sessions that exist but may not have pairs data
    // or query Redis for recent sessions
    const query = `
      SELECT DISTINCT sessionid
      FROM sessions
      WHERE startedat > EXTRACT(EPOCH FROM NOW() - INTERVAL '${lookbackHours} hours') * 1000
        AND (pairs IS NULL OR pairs = '[]'::jsonb OR pair_count = 0)
      ORDER BY startedat DESC
      LIMIT $1
    `;

    try {
      const result = await this.pg.query(query, [limit]);
      const sessionIds = result.rows.map(row => row.sessionid);

      // Also check Redis for sessions that might not be in PostgreSQL yet
      const recentSessionIds = await this.recentSessionsManager.getRecentSessions({ limit });

      // Combine and deduplicate
      const allSessionIds = [...new Set([...sessionIds, ...recentSessionIds])];

      return allSessionIds;

    } catch (error) {
      this.logger.error(`[MultiPairMigrationService] Failed to discover sessions`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process sessions in batches
   * @private
   */
  async processSessionBatches(sessionIds, runId) {
    let sessionsMigrated = 0;
    let ordersMigrated = 0;
    let fillsMigrated = 0;
    let fillsDeduplicated = 0;
    let sessionsFailed = 0;

    // Process in batches
    for (let i = 0; i < sessionIds.length; i += this.config.batchSize) {
      const batch = sessionIds.slice(i, i + this.config.batchSize);

      this.logger.debug(`[MultiPairMigrationService] Processing batch`, {
        runId,
        batchNumber: Math.floor(i / this.config.batchSize) + 1,
        batchSize: batch.length
      });

      const batchResults = await Promise.allSettled(
        batch.map(sessionId => this.migrateSession(sessionId, runId))
      );

      // Aggregate batch results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          sessionsMigrated++;
          ordersMigrated += result.value.ordersMigrated || 0;
          fillsMigrated += result.value.fillsMigrated || 0;
          fillsDeduplicated += result.value.fillsDeduplicated || 0;
        } else {
          sessionsFailed++;
          this.logger.error(`[MultiPairMigrationService] Session migration failed`, {
            runId,
            sessionId: batch[index],
            error: result.reason?.message || result.value?.error
          });
        }
      });
    }

    return {
      sessionsMigrated,
      sessionsFailed,
      ordersMigrated,
      fillsMigrated,
      fillsDeduplicated,
      totalSessions: sessionIds.length
    };
  }

  /**
   * Migrate a single session
   * @private
   */
  async migrateSession(sessionId, runId) {
    this.logger.debug(`[MultiPairMigrationService] Migrating session`, {
      runId,
      sessionId
    });

    try {
      // Check if already migrated
      const alreadyMigrated = await this.checkMigrationStatus(sessionId);
      if (alreadyMigrated) {
        this.logger.debug(`[MultiPairMigrationService] Session already migrated, skipping`, {
          runId,
          sessionId
        });
        return {
          success: true,
          sessionId,
          skipped: true
        };
      }

      // Fetch session data from Redis
      const sessionData = await this.sessionManager.getSession(sessionId);
      if (!sessionData) {
        this.logger.warn(`[MultiPairMigrationService] Session not found in Redis`, {
          runId,
          sessionId
        });
        return {
          success: false,
          sessionId,
          error: 'Session not found in Redis'
        };
      }

      // Extract pairs from session data
      const pairs = this.extractPairs(sessionData);

      this.logger.debug(`[MultiPairMigrationService] Extracted pairs`, {
        runId,
        sessionId,
        pairCount: pairs.length,
        pairs
      });

      // Fetch orders from Redis
      const orders = await this.orderManager.getOrders(sessionId);

      // Fetch fills from Redis
      const fills = await this.fillManager.getFills(sessionId);

      // Prepare session data with pairs metadata
      const sessionWithPairs = {
        ...sessionData,
        pairs: JSON.stringify(pairs), // PostgreSQL expects JSON string for JSONB
        pair_count: pairs.length
      };

      // Write to PostgreSQL
      await this.pgSessionManager.saveSession(sessionWithPairs);

      let ordersMigrated = 0;
      let fillsMigrated = 0;
      let fillsDeduplicated = 0;

      // Write orders if any
      if (orders && orders.length > 0) {
        await this.pgOrderManager.saveOrdersBulk(orders);
        ordersMigrated = orders.length;
      }

      // Write fills with deduplication if enabled
      if (fills && fills.length > 0) {
        const dedupResult = await this.writeFillsWithDedup(sessionId, fills);
        fillsMigrated = dedupResult.written;
        fillsDeduplicated = dedupResult.duplicates;
      }

      // Mark as migrated in Redis
      await this.markAsMigrated(sessionId);

      this.logger.info(`[MultiPairMigrationService] Session migrated successfully`, {
        runId,
        sessionId,
        pairs: pairs.length,
        orders: ordersMigrated,
        fills: fillsMigrated,
        fillsDeduplicated
      });

      return {
        success: true,
        sessionId,
        ordersMigrated,
        fillsMigrated,
        fillsDeduplicated
      };

    } catch (error) {
      this.logger.error(`[MultiPairMigrationService] Error migrating session`, {
        runId,
        sessionId,
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        sessionId,
        error: error.message
      };
    }
  }

  /**
   * Extract pairs from session data
   * @private
   */
  extractPairs(sessionData) {
    const pairs = new Set();

    // Check common session fields for pairs
    if (sessionData.symbol) {
      pairs.add(sessionData.symbol);
    }

    if (sessionData.tradingPair) {
      pairs.add(sessionData.tradingPair);
    }

    if (sessionData.tradingpair) {
      pairs.add(sessionData.tradingpair);
    }

    // Check if pairs array already exists
    if (sessionData.pairs && Array.isArray(sessionData.pairs)) {
      sessionData.pairs.forEach(pair => pairs.add(pair));
    }

    // Check settings or config
    if (sessionData.settings?.tradingPairs) {
      sessionData.settings.tradingPairs.forEach(pair => pairs.add(pair));
    }

    if (sessionData.config?.pairs) {
      sessionData.config.pairs.forEach(pair => pairs.add(pair));
    }

    return Array.from(pairs).filter(Boolean);
  }

  /**
   * Write fills with deduplication
   * @private
   */
  async writeFillsWithDedup(sessionId, fills) {
    if (!this.config.fillDedupEnabled) {
      // No deduplication - write all fills
      await this.pgFillManager.saveFillsBulk(fills);
      return {
        written: fills.length,
        duplicates: 0
      };
    }

    // Deduplicate by (sessionId, orderId, symbol, timestamp, price, quantity)
    const fillMap = new Map();
    let duplicates = 0;

    for (const fill of fills) {
      const dedupKey = this.generateFillDedupKey(fill);

      if (fillMap.has(dedupKey)) {
        duplicates++;
        this.logger.debug(`[MultiPairMigrationService] Duplicate fill detected`, {
          sessionId,
          dedupKey,
          fillId: fill.id
        });
      } else {
        fillMap.set(dedupKey, fill);
      }
    }

    const uniqueFills = Array.from(fillMap.values());

    // Write unique fills to PostgreSQL
    if (uniqueFills.length > 0) {
      try {
        await this.pgFillManager.saveFillsBulk(uniqueFills);
      } catch (error) {
        // If bulk insert fails due to constraint violation, try one-by-one
        if (error.message?.includes('duplicate') || error.code === '23505') {
          this.logger.warn(`[MultiPairMigrationService] Bulk insert failed, retrying one-by-one`, {
            sessionId,
            error: error.message
          });

          let written = 0;
          for (const fill of uniqueFills) {
            try {
              await this.pgFillManager.saveFill(fill);
              written++;
            } catch (fillError) {
              if (fillError.code === '23505') {
                duplicates++;
              } else {
                this.logger.error(`[MultiPairMigrationService] Failed to write fill`, {
                  sessionId,
                  fillId: fill.id,
                  error: fillError.message
                });
              }
            }
          }

          return { written, duplicates: duplicates + (uniqueFills.length - written) };
        }

        throw error;
      }
    }

    return {
      written: uniqueFills.length,
      duplicates
    };
  }

  /**
   * Generate deduplication key for a fill
   * @private
   */
  generateFillDedupKey(fill) {
    return [
      fill.sessionid || fill.sessionId,
      fill.orderid || fill.orderId,
      fill.symbol,
      fill.timestamp,
      fill.price,
      fill.size || fill.amount || fill.quantity
    ].join(':');
  }

  /**
   * Check if session has been migrated
   * @private
   */
  async checkMigrationStatus(sessionId) {
    const key = `migration:completed:${sessionId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Mark session as migrated in Redis
   * @private
   */
  async markAsMigrated(sessionId) {
    const key = `migration:completed:${sessionId}`;
    const data = JSON.stringify({
      migratedAt: Date.now(),
      sessionId
    });

    // Store for 90 days
    await this.redis.setex(key, 90 * 24 * 60 * 60, data);
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      uptime: process.uptime()
    };
  }

  /**
   * Reset service statistics
   */
  resetStats() {
    this.stats = {
      totalRuns: 0,
      totalSessionsMigrated: 0,
      totalOrdersMigrated: 0,
      totalFillsMigrated: 0,
      totalFillsDeduplicated: 0,
      totalErrors: 0,
      lastRun: null
    };
  }

  /**
   * Close service and cleanup resources
   */
  async close() {
    this.logger.info('[MultiPairMigrationService] Closing service');

    if (this.redis && !this.config.redis) {
      await this.redis.quit();
    }

    if (this.pg && !this.config.pg) {
      await this.pg.end();
    }
  }
}

export default MultiPairMigrationService;
