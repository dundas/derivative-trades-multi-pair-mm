# Database Migration Cheat Sheet

Quick reference for running multi-pair database migrations.

## Quick Start

```bash
# 1. Backup database
export DATABASE_URL="postgresql://user:pass@host:port/db"
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# 2. Run migrations
node scripts/db/run-migrations.js

# 3. Verify
psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_name='sessions' AND column_name='pairs';"
```

## Common Commands

### Backup

```bash
# Full backup
pg_dump $DATABASE_URL > backup.sql

# Tables only
pg_dump $DATABASE_URL -t sessions -t orders -t fills > tables.sql
```

### Run Migrations

```bash
# All pending migrations
node scripts/db/run-migrations.js

# Specific migration
node scripts/db/run-migrations.js 001

# Dry-run (preview)
node scripts/db/run-migrations.js --dry-run

# Using psql
psql $DATABASE_URL -f lib/postgresql-api/migrations/001-add-multi-pair-support.sql
```

### Verify

```bash
# Check columns
psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_name='sessions' AND column_name IN ('pairs', 'pair_count');"

# Check indexes
psql $DATABASE_URL -c "SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_%session%symbol%';"

# Check data migration
psql $DATABASE_URL -c "SELECT COUNT(*) FROM sessions WHERE pair_count != COALESCE(jsonb_array_length(pairs), 0);"
```

### Analyze Tables

```bash
psql $DATABASE_URL -c "ANALYZE sessions; ANALYZE orders; ANALYZE fills;"
```

## Rollback

### Rollback Migration 002 (Indexes - Safe)

```bash
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
```

### Rollback Migration 001 (Columns - Data Loss)

```bash
psql $DATABASE_URL -c "
ALTER TABLE sessions DROP COLUMN IF EXISTS pairs;
ALTER TABLE sessions DROP COLUMN IF EXISTS pair_count;
ALTER TABLE orders DROP COLUMN IF EXISTS pair_index;
"
```

### Full Restore from Backup

```bash
psql $DATABASE_URL < backup.sql
```

## Troubleshooting

### Find Duplicate Fills

```sql
SELECT sessionid, orderid, symbol, timestamp, price, COUNT(*)
FROM fills
GROUP BY sessionid, orderid, symbol, timestamp, price, COALESCE(size, amount)
HAVING COUNT(*) > 1;
```

### Remove Duplicate Fills

```sql
DELETE FROM fills
WHERE id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY sessionid, orderid, symbol, timestamp, price, COALESCE(size, amount)
            ORDER BY id
        ) as row_num
        FROM fills
    ) t
    WHERE row_num > 1
);
```

### Check Index Usage

```sql
SELECT indexname, idx_scan
FROM pg_stat_user_indexes
WHERE indexname LIKE 'idx_%'
ORDER BY idx_scan DESC;
```

### Check Index Sizes

```sql
SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
WHERE indexname LIKE 'idx_%session%symbol%';
```

## Environment Variables

```bash
# Required
export DATABASE_URL="postgresql://username:password@host:port/database"

# Optional
export LOG_LEVEL="INFO"
```

## File Locations

| File | Path |
|------|------|
| Migration 001 | `lib/postgresql-api/migrations/001-add-multi-pair-support.sql` |
| Migration 002 | `lib/postgresql-api/migrations/002-add-symbol-indexes.sql` |
| Migration Runner | `scripts/db/run-migrations.js` |
| Schema Definitions | `lib/postgresql-api/schemas/index.js` |
| Full Guide | `docs/DATABASE_MIGRATION_GUIDE.md` |

## Support

- Full guide: `docs/DATABASE_MIGRATION_GUIDE.md`
- Migration README: `lib/postgresql-api/migrations/README.md`
- Check migration file comments for specific guidance
