-- Migration: 001 - Add Multi-Pair Support
-- Purpose: Add multi-pair trading support to sessions table
-- Date: 2025-10-29
-- Author: Multi-Pair MM Development Team
--
-- This migration adds support for tracking multiple trading pairs within a single session.
-- It adds JSONB columns to store pairs array and pair count for efficient querying.
--
-- IMPORTANT: This migration is designed to be non-disruptive:
-- - New columns have defaults (empty array, 0)
-- - Existing sessions will work without modification
-- - No data transformation required for existing rows

-- ============================================================================
-- FORWARD MIGRATION
-- ============================================================================

-- Add pairs JSONB column to sessions table
-- This will store an array of trading pairs like: ["BTC/USD", "ETH/USD", "SOL/USD"]
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS pairs JSONB DEFAULT '[]'::jsonb;

-- Add pair_count INTEGER column for quick filtering
-- This denormalizes the count from pairs array for performance
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS pair_count INTEGER DEFAULT 0;

-- Add symbol column to orders table if it doesn't exist
-- (It should already exist from the schema, but adding for safety)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'symbol'
    ) THEN
        ALTER TABLE orders ADD COLUMN symbol TEXT;
    END IF;
END $$;

-- Add pair_index column to orders for maintaining order of pairs
-- This helps track which pair position an order belongs to
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS pair_index INTEGER DEFAULT 0;

-- Add comment documentation for new columns
COMMENT ON COLUMN sessions.pairs IS 'JSONB array of trading pairs in this session (e.g., ["BTC/USD", "ETH/USD"])';
COMMENT ON COLUMN sessions.pair_count IS 'Number of trading pairs in this session (denormalized from pairs array)';
COMMENT ON COLUMN orders.pair_index IS 'Index of the pair in the session pairs array (0-based)';

-- ============================================================================
-- DATA MIGRATION (Optional - Populate from existing data)
-- ============================================================================

-- Update pair_count for sessions that have a symbol
-- This handles single-pair sessions that existed before multi-pair support
UPDATE sessions
SET
    pairs = CASE
        WHEN symbol IS NOT NULL THEN jsonb_build_array(symbol)
        WHEN tradingpair IS NOT NULL THEN jsonb_build_array(tradingpair)
        ELSE '[]'::jsonb
    END,
    pair_count = CASE
        WHEN symbol IS NOT NULL OR tradingpair IS NOT NULL THEN 1
        ELSE 0
    END
WHERE pairs = '[]'::jsonb AND (symbol IS NOT NULL OR tradingpair IS NOT NULL);

-- ============================================================================
-- VALIDATION QUERIES
-- ============================================================================

-- These queries can be run after migration to verify correctness:

-- 1. Check sessions with pairs
-- SELECT id, symbol, pairs, pair_count FROM sessions WHERE pair_count > 0 LIMIT 10;

-- 2. Verify pair_count matches pairs array length
-- SELECT id, pair_count, jsonb_array_length(pairs) as actual_count
-- FROM sessions
-- WHERE pair_count != COALESCE(jsonb_array_length(pairs), 0);

-- 3. Check orders with pair_index
-- SELECT id, sessionid, symbol, pair_index FROM orders WHERE pair_index > 0 LIMIT 10;

-- ============================================================================
-- ROLLBACK MIGRATION
-- ============================================================================

-- To rollback this migration, run the following SQL:
--
-- -- Remove pairs column
-- ALTER TABLE sessions DROP COLUMN IF EXISTS pairs;
--
-- -- Remove pair_count column
-- ALTER TABLE sessions DROP COLUMN IF EXISTS pair_count;
--
-- -- Remove pair_index column from orders
-- ALTER TABLE orders DROP COLUMN IF EXISTS pair_index;
--
-- Note: Rollback will not delete existing data in other columns

-- ============================================================================
-- MIGRATION METADATA
-- ============================================================================

-- Record migration in a migrations table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migrations') THEN
        INSERT INTO migrations (version, name, applied_at)
        VALUES ('001', 'add-multi-pair-support', NOW())
        ON CONFLICT (version) DO NOTHING;
    END IF;
END $$;
