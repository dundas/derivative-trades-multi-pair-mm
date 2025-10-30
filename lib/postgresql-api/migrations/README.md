# PostgreSQL Database Migrations

This directory contains SQL migration scripts for the multi-pair market maker PostgreSQL database schema.

## Migration Overview

| Migration | Purpose | Impact | Rollback Safe |
|-----------|---------|--------|---------------|
| `001-add-multi-pair-support.sql` | Add JSONB pairs column and pair tracking | New columns with defaults | ✅ Yes |
| `002-add-symbol-indexes.sql` | Add performance indexes for multi-pair queries | Read-only, performance improvement | ✅ Yes |

## Quick Start

### Prerequisites

1. PostgreSQL database connection configured in `.env`:
```bash
DATABASE_URL=postgresql://username:password@host/database
```

2. Database backup (recommended before any migration):
```bash
pg_dump -h host -U username -d database > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Running Migrations

**Option 1: Using psql (Recommended)**

```bash
# Set connection string
export DATABASE_URL="postgresql://username:password@host/database"

# Run migration 001
psql $DATABASE_URL -f lib/postgresql-api/migrations/001-add-multi-pair-support.sql

# Run migration 002
psql $DATABASE_URL -f lib/postgresql-api/migrations/002-add-symbol-indexes.sql
```

**Option 2: Using migration runner script**

```bash
# Run all pending migrations
node scripts/db/run-migrations.js

# Run specific migration
node scripts/db/run-migrations.js 001
```

**Option 3: Manual execution via database client**

1. Connect to your PostgreSQL database using pgAdmin, DBeaver, or similar tool
2. Open the migration file
3. Execute the SQL script
4. Verify success using validation queries included in the migration file

## Migration Details

### Migration 001: Add Multi-Pair Support

**Purpose:** Enable tracking of multiple trading pairs within a single session.

**Changes:**
- Adds `sessions.pairs` JSONB column (default: `[]`)
- Adds `sessions.pair_count` INTEGER column (default: `0`)
- Adds `orders.pair_index` INTEGER column (default: `0`)
- Migrates existing single-pair sessions to new format

**Impact:**
- Non-disruptive: Existing sessions work without modification
- No data loss: All existing data preserved
- Automatic population: Single-pair sessions auto-migrated

**Validation:**
```sql
-- Check sessions with pairs
SELECT id, symbol, pairs, pair_count
FROM sessions
WHERE pair_count > 0
LIMIT 10;

-- Verify pair_count accuracy
SELECT id, pair_count, jsonb_array_length(pairs) as actual_count
FROM sessions
WHERE pair_count != COALESCE(jsonb_array_length(pairs), 0);
```

**Rollback:**
```sql
ALTER TABLE sessions DROP COLUMN IF EXISTS pairs;
ALTER TABLE sessions DROP COLUMN IF EXISTS pair_count;
ALTER TABLE orders DROP COLUMN IF EXISTS pair_index;
```

### Migration 002: Add Symbol Indexes

**Purpose:** Add optimized indexes for multi-pair trading queries.

**Changes:**
- Adds 9 new indexes for performance:
  - `idx_orders_session_symbol` - Orders by session + symbol
  - `idx_fills_session_symbol` - Fills by session + symbol
  - `idx_fills_session_order_symbol` - Fills by session + order + symbol
  - `idx_fills_unique_dedup` - Unique constraint for fill deduplication
  - `idx_sessions_pair_count` - Sessions by pair count
  - `idx_sessions_pairs_gin` - GIN index for JSONB pairs queries
  - `idx_sessions_settlement_discovery` - Settlement service queries
  - `idx_orders_symbol_status` - Global orders by symbol + status
  - `idx_fills_symbol_timestamp` - Fills by symbol + time

**Impact:**
- Read-only changes: No data modification
- Performance improvement: 10-100x faster queries for multi-pair operations
- Online creation: Uses `CONCURRENTLY` to avoid blocking
- No downtime: Safe to run on production database

**Performance Validation:**
```sql
-- Test settlement discovery query
EXPLAIN ANALYZE
SELECT * FROM sessions
WHERE settlesession = true
  AND (settledcomplete IS NULL OR settledcomplete = false)
  AND startedat > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000;

-- Test multi-pair session query
EXPLAIN ANALYZE
SELECT * FROM sessions
WHERE pairs @> '["BTC/USD"]'::jsonb;
```

**Rollback:**
```sql
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

## Best Practices

### Before Running Migrations

1. **Backup Database:**
```bash
pg_dump $DATABASE_URL > backup_pre_migration_$(date +%Y%m%d).sql
```

2. **Test on Staging:**
Run migrations on a staging environment first

3. **Review Migration SQL:**
Read through the migration file to understand changes

4. **Check Disk Space:**
Indexes can be large. Ensure sufficient disk space:
```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
```

### During Migration

1. **Monitor Progress:**
For large tables, index creation can take time:
```sql
SELECT pid, query, state, query_start
FROM pg_stat_activity
WHERE query LIKE 'CREATE INDEX%';
```

2. **Check for Errors:**
Watch for constraint violations or data type issues

3. **Verify Completion:**
Run validation queries included in migration files

### After Migration

1. **Analyze Tables:**
Update statistics for query planner:
```sql
ANALYZE sessions;
ANALYZE orders;
ANALYZE fills;
```

2. **Vacuum Tables:**
Reclaim space and update statistics:
```sql
VACUUM ANALYZE sessions;
VACUUM ANALYZE orders;
VACUUM ANALYZE fills;
```

3. **Monitor Performance:**
Check index usage statistics:
```sql
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE indexname LIKE 'idx_%'
ORDER BY idx_scan DESC;
```

4. **Document Migration:**
Update your deployment logs with migration date and results

## Troubleshooting

### Migration Fails with "relation already exists"

**Cause:** Migration was partially applied before

**Solution:** Migrations use `IF NOT EXISTS` clauses, safe to re-run

### Index Creation Times Out

**Cause:** Large table size

**Solution:**
1. Increase statement timeout:
```sql
SET statement_timeout = '60min';
```
2. Run during low-traffic period
3. Create indexes one at a time

### Fill Deduplication Constraint Violation

**Cause:** Duplicate fills exist in database

**Solution:**
1. Find duplicates:
```sql
SELECT sessionid, orderid, symbol, timestamp, price, COUNT(*)
FROM fills
GROUP BY sessionid, orderid, symbol, timestamp, price, COALESCE(size, amount)
HAVING COUNT(*) > 1;
```
2. Remove duplicates before running migration 002
3. Or modify migration to skip unique constraint

### Performance Degradation After Migration

**Cause:** Missing statistics or index bloat

**Solution:**
```sql
-- Update statistics
ANALYZE sessions;
ANALYZE orders;
ANALYZE fills;

-- Rebuild bloated indexes
REINDEX INDEX CONCURRENTLY idx_orders_session_symbol;
```

## Migration Verification

After running both migrations, verify the schema:

```sql
-- Check new columns exist
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name IN ('pairs', 'pair_count')
ORDER BY column_name;

-- Check indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('sessions', 'orders', 'fills')
  AND indexname LIKE 'idx_%session%symbol%'
ORDER BY indexname;

-- Check for constraint violations
SELECT COUNT(*) as duplicate_fills
FROM (
    SELECT sessionid, orderid, symbol, timestamp, price, COUNT(*)
    FROM fills
    GROUP BY sessionid, orderid, symbol, timestamp, price, COALESCE(size, amount)
    HAVING COUNT(*) > 1
) duplicates;
```

## Emergency Rollback Procedure

If you need to rollback migrations immediately:

```bash
# Rollback migration 002 (indexes only, fast)
psql $DATABASE_URL -c "
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_session_symbol;
DROP INDEX CONCURRENTLY IF EXISTS idx_fills_session_symbol;
DROP INDEX CONCURRENTLY IF EXISTS idx_fills_session_order_symbol;
DROP INDEX CONCURRENTLY IF EXISTS idx_fills_unique_dedup;
DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_pair_count;
DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_pairs_gin;
DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_settlement_discovery;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_symbol_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_fills_symbol_timestamp;
"

# Rollback migration 001 (columns, may lose multi-pair data)
psql $DATABASE_URL -c "
ALTER TABLE sessions DROP COLUMN IF EXISTS pairs;
ALTER TABLE sessions DROP COLUMN IF EXISTS pair_count;
ALTER TABLE orders DROP COLUMN IF EXISTS pair_index;
"
```

## Support

For migration issues or questions:

1. Check migration file comments for specific guidance
2. Review troubleshooting section above
3. Check PostgreSQL logs for detailed error messages
4. Create an issue in the repository with:
   - PostgreSQL version
   - Migration file being run
   - Full error message
   - Output of verification queries

## Migration History Tracking

Create a migrations tracking table (optional):

```sql
CREATE TABLE IF NOT EXISTS migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT NOW(),
    applied_by TEXT DEFAULT CURRENT_USER,
    checksum TEXT
);

-- View migration history
SELECT * FROM migrations ORDER BY applied_at;
```
