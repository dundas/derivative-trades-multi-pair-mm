-- Migration: 002 - Add Symbol and Multi-Pair Performance Indexes
-- Purpose: Add optimized indexes for multi-pair trading queries
-- Date: 2025-10-29
-- Author: Multi-Pair MM Development Team
--
-- This migration adds performance indexes to support efficient querying of:
-- - Orders by session + symbol combinations
-- - Fills by session + symbol combinations
-- - Unique fill deduplication
-- - Sessions by pair count
-- - Multi-pair session discovery
--
-- IMPORTANT: Index creation is online and non-blocking (CONCURRENTLY)
-- - Existing queries will continue to work during index creation
-- - No downtime required
-- - Safe to run on production database

-- ============================================================================
-- FORWARD MIGRATION
-- ============================================================================

-- 1. Composite index for orders by session + symbol
-- This is critical for querying all orders for a specific pair within a session
-- Used by: Settlement service, position tracking, order history queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_session_symbol
ON orders(sessionid, symbol)
WHERE sessionid IS NOT NULL AND symbol IS NOT NULL;

-- 2. Composite index for fills by session + symbol
-- This is critical for querying all fills for a specific pair within a session
-- Used by: Migration service, P&L calculations, fill history queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fills_session_symbol
ON fills(sessionid, symbol)
WHERE sessionid IS NOT NULL AND symbol IS NOT NULL;

-- 3. Composite index for fills by session + order + symbol
-- This supports efficient fill lookups per order within a session
-- Used by: Order fill tracking, execution analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fills_session_order_symbol
ON fills(sessionid, orderid, symbol)
WHERE sessionid IS NOT NULL AND orderid IS NOT NULL;

-- 4. Unique constraint for fill deduplication
-- Prevents duplicate fills from being inserted (idempotent migration)
-- Key: (sessionid, orderid, symbol, timestamp, price, quantity)
-- Note: We use a unique index instead of constraint for CONCURRENTLY support
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'idx_fills_unique_dedup'
    ) THEN
        CREATE UNIQUE INDEX CONCURRENTLY idx_fills_unique_dedup
        ON fills(sessionid, orderid, symbol, timestamp, price, COALESCE(size, amount))
        WHERE sessionid IS NOT NULL
          AND orderid IS NOT NULL
          AND symbol IS NOT NULL
          AND timestamp IS NOT NULL
          AND price IS NOT NULL;
    END IF;
END $$;

-- 5. Index on sessions.pair_count for filtering multi-pair sessions
-- Supports queries like: "Find all sessions with 2+ pairs"
-- Used by: Session discovery, analytics queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_pair_count
ON sessions(pair_count)
WHERE pair_count > 0;

-- 6. GIN index on sessions.pairs JSONB column
-- Enables fast queries like: "Find all sessions trading BTC/USD"
-- PostgreSQL GIN indexes are optimized for JSONB containment queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_pairs_gin
ON sessions USING GIN (pairs)
WHERE pairs IS NOT NULL AND pairs != '[]'::jsonb;

-- 7. Composite index for settlement queries
-- Optimizes: "Find unsettled sessions started in last N hours"
-- Used by: Settlement service session discovery
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_settlement_discovery
ON sessions(settlesession, settledcomplete, startedat)
WHERE settlesession = true
  AND (settledcomplete IS NULL OR settledcomplete = false);

-- 8. Index for orders by symbol + status (across all sessions)
-- Supports global queries like: "Find all open orders for BTC/USD"
-- Used by: Global position tracking, analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_symbol_status
ON orders(symbol, status)
WHERE symbol IS NOT NULL AND status IS NOT NULL;

-- 9. Index for fills by symbol + timestamp (for price analysis)
-- Supports queries like: "Get all BTC/USD fills in time range"
-- Used by: Price analysis, fill history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fills_symbol_timestamp
ON fills(symbol, timestamp)
WHERE symbol IS NOT NULL AND timestamp IS NOT NULL;

-- Add index comments for documentation
COMMENT ON INDEX idx_orders_session_symbol IS 'Composite index for orders by session + symbol (multi-pair support)';
COMMENT ON INDEX idx_fills_session_symbol IS 'Composite index for fills by session + symbol (multi-pair support)';
COMMENT ON INDEX idx_fills_session_order_symbol IS 'Composite index for fills by session + order + symbol';
COMMENT ON INDEX idx_fills_unique_dedup IS 'Unique index for fill deduplication (sessionid, orderid, symbol, timestamp, price, size)';
COMMENT ON INDEX idx_sessions_pair_count IS 'Index on pair_count for filtering multi-pair sessions';
COMMENT ON INDEX idx_sessions_pairs_gin IS 'GIN index on pairs JSONB for containment queries';
COMMENT ON INDEX idx_sessions_settlement_discovery IS 'Composite index for settlement service session discovery';
COMMENT ON INDEX idx_orders_symbol_status IS 'Index for orders by symbol + status (global queries)';
COMMENT ON INDEX idx_fills_symbol_timestamp IS 'Index for fills by symbol + timestamp (price analysis)';

-- ============================================================================
-- INDEX USAGE ANALYSIS QUERIES
-- ============================================================================

-- After migration, you can analyze index usage with these queries:

-- 1. Check index sizes
-- SELECT
--     schemaname,
--     tablename,
--     indexname,
--     pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
-- FROM pg_stat_user_indexes
-- WHERE indexname LIKE 'idx_%session%symbol%'
-- ORDER BY pg_relation_size(indexrelid) DESC;

-- 2. Check index usage statistics
-- SELECT
--     schemaname,
--     tablename,
--     indexname,
--     idx_scan,
--     idx_tup_read,
--     idx_tup_fetch
-- FROM pg_stat_user_indexes
-- WHERE indexname LIKE 'idx_%'
-- ORDER BY idx_scan DESC;

-- 3. Find unused indexes (run after some production time)
-- SELECT
--     schemaname,
--     tablename,
--     indexname
-- FROM pg_stat_user_indexes
-- WHERE idx_scan = 0
--   AND indexname NOT LIKE 'pg_%'
-- ORDER BY pg_relation_size(indexrelid) DESC;

-- ============================================================================
-- PERFORMANCE VALIDATION QUERIES
-- ============================================================================

-- Test query performance with EXPLAIN ANALYZE:

-- 1. Orders by session + symbol (should use idx_orders_session_symbol)
-- EXPLAIN ANALYZE
-- SELECT * FROM orders
-- WHERE sessionid = 'test-session-1'
--   AND symbol = 'BTC/USD';

-- 2. Fills by session + symbol (should use idx_fills_session_symbol)
-- EXPLAIN ANALYZE
-- SELECT * FROM fills
-- WHERE sessionid = 'test-session-1'
--   AND symbol = 'ETH/USD';

-- 3. Sessions with specific pair (should use idx_sessions_pairs_gin)
-- EXPLAIN ANALYZE
-- SELECT * FROM sessions
-- WHERE pairs @> '["BTC/USD"]'::jsonb;

-- 4. Multi-pair sessions (should use idx_sessions_pair_count)
-- EXPLAIN ANALYZE
-- SELECT * FROM sessions
-- WHERE pair_count >= 2;

-- 5. Unsettled sessions (should use idx_sessions_settlement_discovery)
-- EXPLAIN ANALYZE
-- SELECT * FROM sessions
-- WHERE settlesession = true
--   AND (settledcomplete IS NULL OR settledcomplete = false)
--   AND startedat > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000;

-- ============================================================================
-- ROLLBACK MIGRATION
-- ============================================================================

-- To rollback this migration, run the following SQL:
--
-- -- Drop all created indexes
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_session_symbol;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_fills_session_symbol;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_fills_session_order_symbol;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_fills_unique_dedup;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_pair_count;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_pairs_gin;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_sessions_settlement_discovery;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_symbol_status;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_fills_symbol_timestamp;
--
-- Note: Dropping indexes is safe and does not affect data

-- ============================================================================
-- MIGRATION METADATA
-- ============================================================================

-- Record migration in a migrations table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migrations') THEN
        INSERT INTO migrations (version, name, applied_at)
        VALUES ('002', 'add-symbol-indexes', NOW())
        ON CONFLICT (version) DO NOTHING;
    END IF;
END $$;
