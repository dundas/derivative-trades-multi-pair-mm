#!/usr/bin/env node
/**
 * Multi-Pair Migration CLI
 *
 * Command-line interface for running historical data migration from Redis to PostgreSQL.
 *
 * Usage:
 *   node scripts/run-migration.js                           # Migrate all pending sessions
 *   node scripts/run-migration.js --session session-123     # Migrate specific session
 *   node scripts/run-migration.js --batch-size 20           # Custom batch size
 *   node scripts/run-migration.js --lookback-hours 168      # Last 7 days
 *   node scripts/run-migration.js --dry-run                 # Preview only
 *   node scripts/run-migration.js --stats                   # Show statistics
 *
 * Environment Variables:
 *   DO_REDIS_URL - Redis connection string (required)
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   LOG_LEVEL - Logging level (default: INFO)
 */

import { MultiPairMigrationService } from '../src/services/migration/multi-pair-migration-service.js';
import { LoggerFactory } from '../utils/logger-factory.js';
import IORedis from 'ioredis';
import pg from 'pg';

const { Pool } = pg;

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    sessionIds: [],
    batchSize: 10,
    lookbackHours: 720, // 30 days default
    dryRun: false,
    showStats: false,
    limit: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--session':
      case '-s':
        options.sessionIds.push(args[++i]);
        break;

      case '--batch-size':
      case '-b':
        options.batchSize = parseInt(args[++i], 10);
        break;

      case '--lookback-hours':
      case '-l':
        options.lookbackHours = parseInt(args[++i], 10);
        break;

      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;

      case '--dry-run':
      case '-d':
        options.dryRun = true;
        break;

      case '--stats':
        options.showStats = true;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;

      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Multi-Pair Migration CLI

Usage:
  node scripts/run-migration.js [options]

Options:
  --session, -s <sessionId>       Migrate specific session (can be used multiple times)
  --batch-size, -b <number>       Number of sessions per batch (default: 10)
  --lookback-hours, -l <number>   Hours to look back for sessions (default: 720 / 30 days)
  --limit <number>                Maximum number of sessions to migrate
  --dry-run, -d                   Preview what would be migrated without writing
  --stats                         Show migration statistics and exit
  --help, -h                      Show this help message

Environment Variables:
  DO_REDIS_URL                    Redis connection string (required)
  DATABASE_URL                    PostgreSQL connection string (required)
  LOG_LEVEL                       Logging level: DEBUG, INFO, WARN, ERROR (default: INFO)

Examples:
  # Migrate all pending sessions
  node scripts/run-migration.js

  # Migrate specific session
  node scripts/run-migration.js --session session-abc123

  # Migrate last 7 days with custom batch size
  node scripts/run-migration.js --lookback-hours 168 --batch-size 20

  # Preview migration without writing
  node scripts/run-migration.js --dry-run --limit 5

  # Show statistics
  node scripts/run-migration.js --stats
`);
}

// Validate environment
function validateEnvironment() {
  const required = ['DO_REDIS_URL', 'DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease set these variables in your .env file or environment.');
    process.exit(1);
  }

  return {
    redisUrl: process.env.DO_REDIS_URL,
    databaseUrl: process.env.DATABASE_URL
  };
}

// Format duration
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

// Main function
async function main() {
  const options = parseArgs();
  const env = validateEnvironment();

  // Initialize logger
  const logger = LoggerFactory.createLogger({
    component: 'MigrationCLI',
    logLevel: process.env.LOG_LEVEL || 'INFO'
  });

  logger.info('🚀 Multi-Pair Migration Service');
  logger.info('================================\n');

  // Initialize Redis and PostgreSQL
  const redis = new IORedis(env.redisUrl);
  const pg = new Pool({
    connectionString: env.databaseUrl,
    ssl: env.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  // Create migration service
  const service = new MultiPairMigrationService({
    redis,
    pg,
    batchSize: options.batchSize,
    lookbackHours: options.lookbackHours,
    logger
  });

  try {
    // Show statistics if requested
    if (options.showStats) {
      const stats = service.getStats();
      logger.info('📊 Migration Statistics:');
      logger.info(`   Total runs: ${stats.totalRuns}`);
      logger.info(`   Sessions migrated: ${stats.totalSessionsMigrated}`);
      logger.info(`   Orders migrated: ${stats.totalOrdersMigrated}`);
      logger.info(`   Fills migrated: ${stats.totalFillsMigrated}`);
      logger.info(`   Fills deduplicated: ${stats.totalFillsDeduplicated}`);
      logger.info(`   Errors: ${stats.totalErrors}`);
      logger.info(`   Last run: ${stats.lastRun || 'Never'}`);
      process.exit(0);
    }

    // Show configuration
    logger.info('⚙️  Configuration:');
    logger.info(`   Batch size: ${options.batchSize}`);
    logger.info(`   Lookback hours: ${options.lookbackHours}`);
    logger.info(`   Dry run: ${options.dryRun ? 'Yes' : 'No'}`);
    if (options.sessionIds.length > 0) {
      logger.info(`   Specific sessions: ${options.sessionIds.length}`);
    }
    if (options.limit) {
      logger.info(`   Limit: ${options.limit}`);
    }
    logger.info('');

    // Dry run preview
    if (options.dryRun) {
      logger.warn('⚠️  DRY RUN MODE - No data will be written');
      logger.info('');

      // Discover sessions
      const sessionIds = options.sessionIds.length > 0
        ? options.sessionIds
        : await service.discoverSessionsToMigrate({
            lookbackHours: options.lookbackHours,
            limit: options.limit || 5 // Small limit for preview
          });

      logger.info(`Found ${sessionIds.length} sessions to migrate:`);
      sessionIds.slice(0, 10).forEach((id, index) => {
        logger.info(`   ${index + 1}. ${id}`);
      });

      if (sessionIds.length > 10) {
        logger.info(`   ... and ${sessionIds.length - 10} more`);
      }

      logger.info('\nTo execute the migration, remove the --dry-run flag.');
      process.exit(0);
    }

    // Run migration
    logger.info('🔄 Starting migration...\n');

    const startTime = Date.now();

    const result = await service.runMigration({
      sessionIds: options.sessionIds.length > 0 ? options.sessionIds : undefined,
      lookbackHours: options.lookbackHours,
      limit: options.limit
    });

    const duration = Date.now() - startTime;

    // Show results
    logger.info('');
    logger.info('================================');
    if (result.success) {
      logger.info('✅ Migration Completed Successfully');
    } else {
      logger.error('❌ Migration Failed');
      logger.error(`   Error: ${result.error}`);
    }
    logger.info('================================');
    logger.info(`   Duration: ${formatDuration(duration)}`);
    logger.info(`   Sessions migrated: ${result.sessionsMigrated || 0}`);
    logger.info(`   Sessions failed: ${result.sessionsFailed || 0}`);
    logger.info(`   Orders migrated: ${result.ordersMigrated || 0}`);
    logger.info(`   Fills migrated: ${result.fillsMigrated || 0}`);
    logger.info(`   Fills deduplicated: ${result.fillsDeduplicated || 0}`);
    logger.info('');

    // Show statistics
    const stats = service.getStats();
    logger.info('📊 Total Statistics:');
    logger.info(`   All-time sessions: ${stats.totalSessionsMigrated}`);
    logger.info(`   All-time orders: ${stats.totalOrdersMigrated}`);
    logger.info(`   All-time fills: ${stats.totalFillsMigrated}`);
    logger.info('');

    if (result.success) {
      logger.info('✨ Migration complete!');
      process.exit(0);
    } else {
      logger.error('⚠️  Migration completed with errors. Check logs for details.');
      process.exit(1);
    }

  } catch (error) {
    logger.error('❌ Fatal error:', error.message);
    logger.error(error.stack);
    process.exit(1);

  } finally {
    // Cleanup
    await service.close();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export default main;
