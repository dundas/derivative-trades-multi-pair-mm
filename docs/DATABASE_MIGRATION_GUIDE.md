# Database Migration Guide - Multi-Pair Support

## Overview

This guide covers the database schema migrations required to enable multi-pair trading support in the market maker system.

## What's Being Added

### Migration 001: Multi-Pair Support
- **sessions.pairs** - JSONB array of trading pairs (e.g., `["BTC/USD", "ETH/USD"]`)
- **sessions.pair_count** - INTEGER count of pairs for quick filtering
- **orders.pair_index** - INTEGER index to track which pair an order belongs to

### Migration 002: Performance Indexes
- **9 new indexes** for optimized multi-pair queries:
  - Session + symbol composite indexes
  - Fill deduplication unique constraint
  - JSONB GIN index for pair containment queries
  - Settlement discovery composite index

## Pre-Migration Checklist

- [ ] **Backup database** (see below for commands)
- [ ] **Test on staging environment** first
- [ ] **Review migration SQL files**
- [ ] **Check disk space** (indexes can be large)
- [ ] **Notify team** about maintenance window (if running on production)
- [ ] **Stop trading services** during migration (recommended but not required)

## Backup Procedure

### Option 1: Full Database Backup (Recommended)

```bash
# Set your database URL
export DATABASE_URL="postgresql://username:password@host:port/database"

# Create backup
pg_dump $DATABASE_URL > backups/pre_multipair_migration_$(date +%Y%m%d_%H%M%S).sql

# Verify backup file
ls -lh backups/
```

### Option 2: Selective Table Backup

```bash
# Backup only the tables being modified
pg_dump $DATABASE_URL -t sessions -t orders -t fills > backups/tables_backup_$(date +%Y%m%d).sql
```

### Option 3: Using Supabase/Cloud Provider

If using a managed PostgreSQL service (Supabase, AWS RDS, etc.):

1. Use the provider's snapshot/backup feature
2. Create a manual backup before migration
3. Document the backup timestamp

## Migration Execution

### Method 1: Using Migration Runner Script (Recommended)

```bash
# Navigate to project root
cd /Users/kefentse/dev_env/derivative-trades-multi-pair-mm

# Set database connection
export DATABASE_URL="postgresql://username:password@host:port/database"

# Dry-run to preview changes (recommended first step)
node scripts/db/run-migrations.js --dry-run

# Run all pending migrations
node scripts/db/run-migrations.js

# Or run specific migration
node scripts/db/run-migrations.js 001
node scripts/db/run-migrations.js 002
```

### Method 2: Using psql (Direct SQL Execution)

```bash
# Set connection string
export DATABASE_URL="postgresql://username:password@host:port/database"

# Run migration 001
psql $DATABASE_URL -f lib/postgresql-api/migrations/001-add-multi-pair-support.sql

# Verify migration 001
psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_name='sessions' AND column_name IN ('pairs', 'pair_count');"

# Run migration 002
psql $DATABASE_URL -f lib/postgresql-api/migrations/002-add-symbol-indexes.sql

# Verify migration 002
psql $DATABASE_URL -c "SELECT indexname FROM pg_indexes WHERE tablename IN ('sessions', 'orders', 'fills') AND indexname LIKE 'idx_%session%symbol%';"
```

### Method 3: Using Database GUI (pgAdmin, DBeaver, etc.)

1. Connect to your PostgreSQL database
2. Open SQL editor
3. Copy contents of `lib/postgresql-api/migrations/001-add-multi-pair-support.sql`
4. Execute the SQL
5. Verify using validation queries in the file
6. Repeat for `002-add-symbol-indexes.sql`

## Post-Migration Verification

### 1. Verify New Columns

```sql
-- Check sessions table has new columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name IN ('pairs', 'pair_count')
ORDER BY column_name;

-- Expected output:
-- pairs      | jsonb   | YES | '[]'::jsonb
-- pair_count | integer | YES | 0
```

### 2. Verify Indexes

```sql
-- Check all new indexes were created
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE indexname LIKE 'idx_%session%symbol%'
   OR indexname LIKE 'idx_%pair%'
ORDER BY tablename, indexname;

-- Should show 9 new indexes
```

### 3. Verify Data Migration

```sql
-- Check that existing single-pair sessions were migrated
SELECT
    id,
    symbol,
    pairs,
    pair_count
FROM sessions
WHERE symbol IS NOT NULL
LIMIT 10;

-- Verify pair_count matches pairs array length
SELECT
    COUNT(*) as mismatch_count
FROM sessions
WHERE pair_count != COALESCE(jsonb_array_length(pairs), 0);

-- Expected: 0 mismatches
```

### 4. Test Query Performance

```sql
-- Test settlement discovery query (should use idx_sessions_settlement_discovery)
EXPLAIN ANALYZE
SELECT *
FROM sessions
WHERE settlesession = true
  AND (settledcomplete IS NULL OR settledcomplete = false)
  AND startedat > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000;

-- Should show "Index Scan using idx_sessions_settlement_discovery"

-- Test multi-pair query (should use idx_sessions_pairs_gin)
EXPLAIN ANALYZE
SELECT *
FROM sessions
WHERE pairs @> '["BTC/USD"]'::jsonb;

-- Should show "Bitmap Index Scan on idx_sessions_pairs_gin"
```

### 5. Analyze Tables for Query Optimizer

```sql
-- Update statistics for query planner
ANALYZE sessions;
ANALYZE orders;
ANALYZE fills;
```

## Rollback Procedure

If you need to rollback the migrations:

### Rollback Migration 002 (Indexes Only - Safe)

```sql
-- Drop all indexes created in migration 002
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_session_symbol;
DROP INDEX CONCURRENTLY IF EXISTS idx_fills_session_symbol;
DROP INDEX CONCURRENTLY IF EXISTS idx_fills_session_order_symbol;
DROP INDEX CONCURRENTLY IF EXISTS idx_fills_unique_dedup;
DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_pair_count;
DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_pairs_gin;
DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_settlement_discovery;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_symbol_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_fills_symbol_timestamp;
```

### Rollback Migration 001 (Columns - Data Loss Warning)

**⚠️ WARNING: This will drop the `pairs` and `pair_count` columns. Any multi-pair session data will be lost.**

```sql
-- Remove pairs columns from sessions
ALTER TABLE sessions DROP COLUMN IF EXISTS pairs;
ALTER TABLE sessions DROP COLUMN IF EXISTS pair_count;

-- Remove pair_index from orders
ALTER TABLE orders DROP COLUMN IF EXISTS pair_index;
```

### Complete Rollback from Backup

If rollback is needed and you have a backup:

```bash
# Restore from backup (WARNING: This replaces entire database)
psql $DATABASE_URL < backups/pre_multipair_migration_YYYYMMDD_HHMMSS.sql
```

## Troubleshooting

### Issue: "relation already exists"

**Cause:** Migration was partially applied

**Solution:** Migrations use `IF NOT EXISTS`, safe to re-run:
```bash
node scripts/db/run-migrations.js 001
```

### Issue: Index creation times out

**Cause:** Large table size

**Solutions:**

1. Increase timeout:
```sql
SET statement_timeout = '60min';
```

2. Create indexes during low-traffic period

3. Create indexes one at a time manually

### Issue: Duplicate fill constraint violation

**Cause:** Duplicate fills exist in database

**Solution:**

1. Find duplicates:
```sql
SELECT
    sessionid, orderid, symbol, timestamp, price, COALESCE(size, amount) as size,
    COUNT(*) as duplicate_count
FROM fills
GROUP BY sessionid, orderid, symbol, timestamp, price, COALESCE(size, amount)
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 20;
```

2. Deduplicate before running migration 002:
```sql
-- Keep only the first occurrence of each duplicate
DELETE FROM fills
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY sessionid, orderid, symbol, timestamp, price, COALESCE(size, amount)
                   ORDER BY id
               ) as row_num
        FROM fills
    ) t
    WHERE row_num > 1
);
```

### Issue: Performance degradation

**Cause:** Missing statistics or index bloat

**Solution:**
```sql
-- Update statistics
ANALYZE sessions;
ANALYZE orders;
ANALYZE fills;

-- Rebuild specific index if needed
REINDEX INDEX CONCURRENTLY idx_orders_session_symbol;
```

## Maintenance After Migration

### Monitor Index Usage

```sql
-- Check which indexes are being used
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE indexname LIKE 'idx_%'
ORDER BY idx_scan DESC;
```

### Monitor Index Size

```sql
-- Check index sizes
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE indexname LIKE 'idx_%session%symbol%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Vacuum Tables (Monthly Recommended)

```sql
-- Reclaim space and update statistics
VACUUM ANALYZE sessions;
VACUUM ANALYZE orders;
VACUUM ANALYZE fills;
```

## Production Deployment Checklist

- [ ] Migrations tested on staging environment
- [ ] Database backup completed and verified
- [ ] Team notified of maintenance window
- [ ] Trading services stopped (or ready to handle downtime)
- [ ] Migration 001 executed successfully
- [ ] Migration 001 verified (columns exist, data migrated)
- [ ] Migration 002 executed successfully
- [ ] Migration 002 verified (indexes exist, queries perform well)
- [ ] ANALYZE run on all tables
- [ ] Query performance tested
- [ ] Trading services restarted
- [ ] Monitor logs for errors
- [ ] Verify first multi-pair session works correctly
- [ ] Document migration completion in deployment log

## Support

For migration issues:

1. Check migration file comments for specific guidance
2. Review troubleshooting section above
3. Check PostgreSQL logs: `tail -f /var/log/postgresql/postgresql-*.log`
4. Restore from backup if critical issue occurs

## References

- Migration files: `lib/postgresql-api/migrations/`
- Schema definitions: `lib/postgresql-api/schemas/index.js`
- Migration runner: `scripts/db/run-migrations.js`
- Migration README: `lib/postgresql-api/migrations/README.md`
