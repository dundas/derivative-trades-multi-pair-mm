#!/usr/bin/env node
/**
 * PostgreSQL Database Migration Runner
 *
 * Runs SQL migration files against the PostgreSQL database.
 *
 * Usage:
 *   node scripts/db/run-migrations.js                    # Run all pending migrations
 *   node scripts/db/run-migrations.js 001                # Run specific migration
 *   node scripts/db/run-migrations.js --dry-run          # Show what would be run
 *   node scripts/db/run-migrations.js --rollback 001     # Rollback specific migration
 *
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   LOG_LEVEL - Logging level (default: INFO)
 */

import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  databaseUrl: process.env.DATABASE_URL,
  migrationsDir: path.join(__dirname, '../../lib/postgresql-api/migrations'),
  dryRun: process.argv.includes('--dry-run'),
  rollback: process.argv.includes('--rollback'),
  specificMigration: process.argv.find(arg => /^\d+$/.test(arg))
};

// Logger
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  success: (...args) => console.log('[SUCCESS]', ...args)
};

/**
 * Get list of migration files
 */
async function getMigrationFiles() {
  try {
    const files = await fs.readdir(CONFIG.migrationsDir);
    return files
      .filter(f => f.endsWith('.sql') && /^\d{3}-/.test(f))
      .sort();
  } catch (error) {
    logger.error('Failed to read migrations directory:', error.message);
    return [];
  }
}

/**
 * Read migration file content
 */
async function readMigrationFile(filename) {
  const filepath = path.join(CONFIG.migrationsDir, filename);
  return await fs.readFile(filepath, 'utf-8');
}

/**
 * Create migrations tracking table
 */
async function createMigrationsTable(pool) {
  const query = `
    CREATE TABLE IF NOT EXISTS migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW(),
      applied_by TEXT DEFAULT CURRENT_USER,
      checksum TEXT
    );
  `;

  try {
    await pool.query(query);
    logger.info('Migrations table ready');
  } catch (error) {
    logger.error('Failed to create migrations table:', error.message);
    throw error;
  }
}

/**
 * Get applied migrations from database
 */
async function getAppliedMigrations(pool) {
  try {
    const result = await pool.query('SELECT version FROM migrations ORDER BY version');
    return result.rows.map(row => row.version);
  } catch (error) {
    logger.warn('Failed to query migrations table:', error.message);
    return [];
  }
}

/**
 * Extract migration version from filename
 */
function getMigrationVersion(filename) {
  const match = filename.match(/^(\d{3})-/);
  return match ? match[1] : null;
}

/**
 * Extract migration name from filename
 */
function getMigrationName(filename) {
  return filename.replace(/^\d{3}-/, '').replace(/\.sql$/, '');
}

/**
 * Calculate checksum for migration content
 */
function calculateChecksum(content) {
  // Simple checksum - in production you might want to use crypto.createHash
  return content.length.toString(16);
}

/**
 * Run a single migration
 */
async function runMigration(pool, filename) {
  const version = getMigrationVersion(filename);
  const name = getMigrationName(filename);

  logger.info(`Running migration ${version}: ${name}`);

  try {
    // Read migration file
    const sql = await readMigrationFile(filename);
    const checksum = calculateChecksum(sql);

    if (CONFIG.dryRun) {
      logger.info('[DRY RUN] Would execute SQL from:', filename);
      logger.info('[DRY RUN] SQL preview (first 500 chars):');
      console.log(sql.substring(0, 500) + '...\n');
      return { success: true, dryRun: true };
    }

    // Execute migration in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Execute the migration SQL
      await client.query(sql);

      // Record migration
      await client.query(
        'INSERT INTO migrations (version, name, checksum) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING',
        [version, name, checksum]
      );

      await client.query('COMMIT');

      logger.success(`Migration ${version} completed successfully`);
      return { success: true, version, name };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    logger.error(`Migration ${version} failed:`, error.message);
    throw error;
  }
}

/**
 * Rollback a migration (manual process)
 */
async function rollbackMigration(pool, filename) {
  const version = getMigrationVersion(filename);
  const name = getMigrationName(filename);

  logger.warn(`Rollback for migration ${version}: ${name}`);
  logger.warn('Rollback SQL must be executed manually from the migration file');
  logger.warn(`File: ${path.join(CONFIG.migrationsDir, filename)}`);
  logger.warn('Look for the ROLLBACK MIGRATION section in the file');

  // Read and display rollback SQL
  const sql = await readMigrationFile(filename);
  const rollbackMatch = sql.match(/-- ROLLBACK MIGRATION\n-- ={70,}\n([\s\S]*?)(?=\n-- ={70,}|$)/);

  if (rollbackMatch) {
    logger.info('\nRollback SQL:');
    console.log(rollbackMatch[1]);
  } else {
    logger.warn('No rollback section found in migration file');
  }

  return { success: false, message: 'Manual rollback required' };
}

/**
 * Main migration runner
 */
async function main() {
  logger.info('PostgreSQL Migration Runner');
  logger.info('===========================\n');

  // Validate configuration
  if (!CONFIG.databaseUrl) {
    logger.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  logger.info('Configuration:');
  logger.info('  Database:', CONFIG.databaseUrl.replace(/:[^:@]+@/, ':****@'));
  logger.info('  Migrations dir:', CONFIG.migrationsDir);
  logger.info('  Dry run:', CONFIG.dryRun);
  logger.info('  Rollback:', CONFIG.rollback);
  logger.info('  Specific migration:', CONFIG.specificMigration || 'all pending');
  logger.info('');

  // Connect to database
  const pool = new Pool({
    connectionString: CONFIG.databaseUrl,
    ssl: CONFIG.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    // Test connection
    await pool.query('SELECT NOW()');
    logger.success('Database connection established\n');

    // Create migrations table
    await createMigrationsTable(pool);

    // Get migration files
    const allMigrations = await getMigrationFiles();
    logger.info(`Found ${allMigrations.length} migration files\n`);

    if (allMigrations.length === 0) {
      logger.warn('No migration files found');
      process.exit(0);
    }

    // Get applied migrations
    const appliedMigrations = await getAppliedMigrations(pool);
    logger.info(`Applied migrations: ${appliedMigrations.length}`);
    if (appliedMigrations.length > 0) {
      appliedMigrations.forEach(v => logger.info(`  - ${v}`));
    }
    logger.info('');

    // Determine which migrations to run
    let migrationsToRun = [];

    if (CONFIG.specificMigration) {
      // Run specific migration
      const migrationFile = allMigrations.find(f =>
        getMigrationVersion(f) === CONFIG.specificMigration
      );

      if (!migrationFile) {
        logger.error(`Migration ${CONFIG.specificMigration} not found`);
        process.exit(1);
      }

      migrationsToRun = [migrationFile];

    } else {
      // Run all pending migrations
      migrationsToRun = allMigrations.filter(f => {
        const version = getMigrationVersion(f);
        return !appliedMigrations.includes(version);
      });
    }

    if (migrationsToRun.length === 0) {
      logger.success('No pending migrations to run');
      process.exit(0);
    }

    logger.info(`Migrations to run: ${migrationsToRun.length}`);
    migrationsToRun.forEach(f => logger.info(`  - ${f}`));
    logger.info('');

    // Run migrations
    const results = [];

    for (const migrationFile of migrationsToRun) {
      if (CONFIG.rollback) {
        const result = await rollbackMigration(pool, migrationFile);
        results.push(result);
      } else {
        const result = await runMigration(pool, migrationFile);
        results.push(result);
      }
    }

    // Summary
    logger.info('\n=============================');
    logger.info('Migration Summary');
    logger.info('=============================');
    logger.success(`Total migrations processed: ${results.length}`);
    logger.success(`Successful: ${results.filter(r => r.success).length}`);
    if (results.some(r => !r.success)) {
      logger.error(`Failed: ${results.filter(r => !r.success).length}`);
    }

    if (CONFIG.dryRun) {
      logger.info('\n[DRY RUN] No changes were made to the database');
    }

  } catch (error) {
    logger.error('\nMigration failed:', error.message);
    logger.error(error.stack);
    process.exit(1);

  } finally {
    await pool.end();
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
