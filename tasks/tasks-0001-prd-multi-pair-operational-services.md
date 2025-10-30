# Task List: Multi-Pair Operational Services

> Generated from: `0001-prd-multi-pair-operational-services.md`

## Current State Assessment

The multi-pair MM repository already contains:
- ✅ Redis-Backend-API library (`lib/redis-backend-api/`) with SessionManager, OrderManager, FillManager
- ✅ PostgreSQL-API library (`lib/postgresql-api/`) with database managers
- ✅ KrakenCacheClient (`lib/exchanges/KrakenCacheClient.js`) for rate-limited API access
- ✅ Logger infrastructure (`utils/logger-factory.js`)
- ✅ Exchange adapters (`src/exchanges/kraken/KrakenWebSocketV2ExchangeAdapter.js`)
- ✅ Position tracking (`src/position/DynamicPositionManager.js`)

**Components ported from main repo:** ✅ **COMPLETED**
- ✅ `src/services/shared/take-profit-core.js` - Aging-based pricing engine (with tests - 16/16 passing)
- ✅ `src/services/market-maker/utils/order-id-generator.js` - Order ID generation
- ✅ `src/services/market-maker/utils/comprehensive-balance-validator.js` - Asset availability validation (with tests - 14/14 passing)
- ✅ `lib/trading/pricing-engine.js` - Pricing calculations (dependency)

**Remaining tasks:**
- ❌ PostgreSQL schema updates for multi-pair support (JSONB pairs column)

## Relevant Files

### Files to Create

#### Services
- `src/services/multi-pair-take-profit-service.js` - Main take-profit service with batch API and aging logic
- `src/services/multi-pair-take-profit-service.test.js` - Unit tests for take-profit service
- `src/services/multi-pair-settlement-service.js` - Settlement orchestrator with session discovery and batch processing
- `src/services/multi-pair-settlement-service.test.js` - Unit tests for settlement service
- `src/services/migration/multi-pair-migration-service.js` - Historical data migration to PostgreSQL
- `src/services/migration/multi-pair-migration-service.test.js` - Unit tests for migration service

#### Core Components (Port from main repo)
- `src/services/take-profit-core.js` - Aging-based pricing calculations (ported from main repo)
- `src/services/take-profit-core.test.js` - Unit tests for take-profit core

#### Utilities (Port from main repo)
- `lib/utils/comprehensive-balance-validator.js` - Validates asset availability before order creation
- `lib/utils/comprehensive-balance-validator.test.js` - Unit tests for balance validator

#### Database Migrations
- `lib/postgresql-api/migrations/001-add-multi-pair-support.sql` - Schema updates for pairs JSONB column
- `lib/postgresql-api/migrations/002-add-symbol-indexes.sql` - Performance indexes for symbol queries

#### Configuration
- `.env.example` - Add new environment variables for services
- `src/config/services-config.js` - Centralized service configuration

#### CLI Scripts
- `scripts/run-settlement.js` - CLI to manually trigger settlement
- `scripts/run-migration.js` - CLI to manually trigger migration
- `scripts/verify-coverage.js` - CLI to verify position coverage across all pairs

### Files to Modify

- `package.json` - Add npm scripts for service execution
- `README.md` - Update with operational services documentation
- `lib/redis-backend-api/index.js` - Verify exports for SessionManager, OrderManager, FillManager
- `lib/postgresql-api/index.js` - Verify exports for database managers

### Integration Test Files

- `test/integration/settlement-service.integration.test.js` - End-to-end settlement tests
- `test/integration/take-profit-service.integration.test.js` - End-to-end take-profit tests
- `test/integration/migration-service.integration.test.js` - End-to-end migration tests
- `test/integration/multi-pair-workflow.integration.test.js` - Full workflow test across all services

### Notes

- Use `npm test` to run all tests
- Use `npm test -- --testPathPattern=settlement` to run specific service tests
- Integration tests require Redis and PostgreSQL connections configured in `.env`

## Tasks

- [x] 1.0 Port Core Dependencies from Main Repo ✅ **COMPLETED**
  - [x] 1.1 Copy `src/services/take-profit-core.js` from main repo to multi-pair repo
  - [x] 1.2 Copy `lib/utils/comprehensive-balance-validator.js` from main repo to multi-pair repo
  - [x] 1.3 Review and update import paths in ported files to match multi-pair repo structure
  - [x] 1.4 Create unit tests: `src/services/shared/take-profit-core.test.js` (16/16 tests passing)
  - [x] 1.5 Create unit tests: `src/services/market-maker/utils/comprehensive-balance-validator.test.js` (14/14 tests passing)
  - [x] 1.6 Verify all ported dependencies resolve correctly (all imports working)
  - [x] 1.7 Additional files ported: order-id-generator.js, pricing-engine.js

- [x] 2.0 Implement Multi-Pair Take-Profit Service ✅ **COMPLETED**
  - [x] 2.1 Create `src/services/multi-pair-take-profit-service.js` with class skeleton and constructor
  - [x] 2.2 Implement `createBatchTakeProfits(sessionId, positionsByPair)` main API method
  - [x] 2.3 Implement `_processPositionsForPair(sessionId, symbol, positions)` for single-pair processing
  - [x] 2.4 Implement aging-based pricing using TakeProfitCore integration
  - [x] 2.5 Implement duplicate prevention using Redis keys: `tp_attempt:{sessionId}:{positionId}`
  - [x] 2.6 Implement asset availability validation using ComprehensiveBalanceValidator
  - [x] 2.7 Implement maker-friendly order creation with `postOnly: true` flag
  - [x] 2.8 Implement parallel pair processing with `Promise.allSettled()` and individual error handling
  - [x] 2.9 Implement Redis order tracking: `tp_order:{sessionId}:{orderId}` with metadata
  - [x] 2.10 Add comprehensive logging for each step using MarketMakerLogger
  - [x] 2.11 Create unit tests: `src/services/multi-pair-take-profit-service.test.js` (18/18 tests passing)
  - [x] 2.12 Test aging tier calculations (covered by TakeProfitCore tests)
  - [x] 2.13 Test duplicate prevention logic with concurrent calls
  - [x] 2.14 Test error handling for individual pair failures

- [ ] 3.0 Implement Multi-Pair Settlement Service
  - [ ] 3.1 Create `src/services/multi-pair-settlement-service.js` with class skeleton
  - [ ] 3.2 Implement PostgreSQL session discovery using `getRecentSessions(hoursBack, limit)`
  - [ ] 3.3 Implement session grouping by `sessionId` with pairs extraction from JSONB column
  - [ ] 3.4 Implement Redis uncovered position queries per pair using parallel Promise.allSettled
  - [ ] 3.5 Implement batch take-profit creation by calling MultiPairTakeProfitService
  - [ ] 3.6 Implement settlement status tracking in Redis: `settlement:status:{sessionId}`
  - [ ] 3.7 Implement settlement timestamp tracking: `settlement:last_run:{sessionId}`
  - [ ] 3.8 Implement portfolio-level stop-loss monitoring across all pairs
  - [ ] 3.9 Implement concurrency control using Redis distributed locks: `lock:settlement:{sessionId}`
  - [ ] 3.10 Add comprehensive logging for settlement lifecycle
  - [ ] 3.11 Create CLI script: `scripts/run-settlement.js` for manual execution
  - [ ] 3.12 Create unit tests: `src/services/multi-pair-settlement-service.test.js`
  - [ ] 3.13 Test session discovery and grouping logic
  - [ ] 3.14 Test parallel uncovered position queries
  - [ ] 3.15 Test concurrency control with distributed locks

- [ ] 4.0 Implement Multi-Pair Migration Service
  - [ ] 4.1 Create `src/services/migration/multi-pair-migration-service.js` with class skeleton
  - [ ] 4.2 Implement session ID discovery from PostgreSQL with migration status filtering
  - [ ] 4.3 Implement data fetching using SessionManager, OrderManager, FillManager grouped by (sessionId, symbol)
  - [ ] 4.4 Implement pair extraction from session data for JSONB pairs column population
  - [ ] 4.5 Implement bulk PostgreSQL writer for sessions table with pairs metadata
  - [ ] 4.6 Implement bulk PostgreSQL writer for orders table with symbol column
  - [ ] 4.7 Implement bulk PostgreSQL writer for fills table with deduplication by (sessionId, orderId, symbol, timestamp, price, quantity)
  - [ ] 4.8 Implement pair-level aggregation calculations (orders per pair, fills per pair, P&L per pair)
  - [ ] 4.9 Implement migration completion tracking in Redis: `migration:completed:{sessionId}`
  - [ ] 4.10 Implement batch processing with configurable batch size (default: 10 sessions)
  - [ ] 4.11 Add comprehensive logging for migration progress
  - [ ] 4.12 Create CLI script: `scripts/run-migration.js` for manual execution
  - [ ] 4.13 Create unit tests: `src/services/migration/multi-pair-migration-service.test.js`
  - [ ] 4.14 Test fill deduplication logic
  - [ ] 4.15 Test pair-level aggregation calculations
  - [ ] 4.16 Test batch processing with mock data

- [ ] 5.0 Database Schema Updates and Migrations
  - [ ] 5.1 Review existing PostgreSQL schema for sessions, orders, fills tables
  - [ ] 5.2 Create migration script: `lib/postgresql-api/migrations/001-add-multi-pair-support.sql`
  - [ ] 5.3 Add `sessions.pairs` JSONB column with default empty array
  - [ ] 5.4 Add `sessions.pair_count` INTEGER column with default 0
  - [ ] 5.5 Add `orders.symbol` TEXT column if missing
  - [ ] 5.6 Add `orders.pair_index` INTEGER column for ordering
  - [ ] 5.7 Create migration script: `lib/postgresql-api/migrations/002-add-symbol-indexes.sql`
  - [ ] 5.8 Add composite index: `CREATE INDEX idx_orders_session_symbol ON orders(session_id, symbol)`
  - [ ] 5.9 Add composite index: `CREATE INDEX idx_fills_session_symbol ON fills(session_id, symbol)`
  - [ ] 5.10 Add unique constraint on fills: `UNIQUE(session_id, order_id, symbol, timestamp, price, quantity)`
  - [ ] 5.11 Create migration verification query to check for data integrity
  - [ ] 5.12 Document migration rollback procedure in migration files
  - [ ] 5.13 Test migration on staging database
  - [ ] 5.14 Create backup script before production migration

- [ ] 6.0 Integration Testing and Validation
  - [ ] 6.1 Create `test/integration/take-profit-service.integration.test.js`
  - [ ] 6.2 Test end-to-end take-profit creation for multi-pair session with real Redis
  - [ ] 6.3 Test aging-based pricing calculation with time-mocked positions
  - [ ] 6.4 Test duplicate prevention across multiple service calls
  - [ ] 6.5 Create `test/integration/settlement-service.integration.test.js`
  - [ ] 6.6 Test end-to-end settlement workflow from PostgreSQL discovery to order creation
  - [ ] 6.7 Test parallel pair processing with 5+ concurrent pairs
  - [ ] 6.8 Test concurrency control with simultaneous settlement attempts
  - [ ] 6.9 Create `test/integration/migration-service.integration.test.js`
  - [ ] 6.10 Test end-to-end migration from Redis to PostgreSQL
  - [ ] 6.11 Test fill deduplication with intentionally duplicate data
  - [ ] 6.12 Test pair-level aggregations match raw data
  - [ ] 6.13 Create `test/integration/multi-pair-workflow.integration.test.js`
  - [ ] 6.14 Test full workflow: trading → settlement → migration → analysis query
  - [ ] 6.15 Create verification script: `scripts/verify-coverage.js` to check position coverage
  - [ ] 6.16 Run verification script against paper trading data
  - [ ] 6.17 Create load test with 10+ concurrent pairs and 100+ positions
  - [ ] 6.18 Measure and document average settlement latency

- [ ] 7.0 Production Deployment Configuration
  - [ ] 7.1 Update `.env.example` with all new service environment variables
  - [ ] 7.2 Create `src/config/services-config.js` for centralized configuration
  - [ ] 7.3 Add validation for required environment variables with descriptive errors
  - [ ] 7.4 Update `package.json` with service execution scripts
  - [ ] 7.5 Add npm script: `"settlement:run": "node scripts/run-settlement.js"`
  - [ ] 7.6 Add npm script: `"migration:run": "node scripts/run-migration.js"`
  - [ ] 7.7 Add npm script: `"verify:coverage": "node scripts/verify-coverage.js"`
  - [ ] 7.8 Create PM2 ecosystem file: `ecosystem.config.js` for service management
  - [ ] 7.9 Configure PM2 cron for settlement service (every 3 minutes)
  - [ ] 7.10 Configure PM2 cron for migration service (every hour)
  - [ ] 7.11 Create deployment script: `scripts/deploy/deploy-operational-services.sh`
  - [ ] 7.12 Update README.md with operational services documentation
  - [ ] 7.13 Document service architecture in `docs/OPERATIONAL_SERVICES.md`
  - [ ] 7.14 Document troubleshooting guide in `docs/TROUBLESHOOTING.md`
  - [ ] 7.15 Set up health check endpoints for each service
  - [ ] 7.16 Configure Slack/Discord alerts for service failures
  - [ ] 7.17 Create monitoring dashboard queries in `docs/MONITORING_QUERIES.md`
  - [ ] 7.18 Test deployment on staging environment
  - [ ] 7.19 Gradual production rollout with small position sizes
  - [ ] 7.20 Monitor first 24 hours of production operation

## Implementation Notes

### Recommended Implementation Order

**Phase 1 (Week 1-2):**
- Complete Task 1.0 (Port Dependencies)
- Complete Task 2.0 (Take-Profit Service)
- Complete Task 3.0 (Settlement Service)

**Phase 2 (Week 2-3):**
- Complete Task 5.0 (Database Schema)
- Complete Task 4.0 (Migration Service)

**Phase 3 (Week 3-4):**
- Complete Task 6.0 (Integration Testing)

**Phase 4 (Week 4-5):**
- Complete Task 7.0 (Deployment)

### Testing Strategy

1. **Unit Tests** - Test each component in isolation with mocked dependencies
2. **Integration Tests** - Test services with real Redis/PostgreSQL connections
3. **Load Tests** - Validate performance with 10+ pairs and 100+ positions
4. **End-to-End Tests** - Validate full workflow from trading to analysis

### Success Criteria

- ✅ All unit tests passing
- ✅ All integration tests passing
- ✅ Settlement latency < 5 seconds for 10 pairs
- ✅ 99%+ position coverage within 3 minutes
- ✅ Zero duplicate take-profit orders
- ✅ 100% data migration completeness
- ✅ Zero fill duplicates in PostgreSQL

### Risk Mitigation

- Use dry-run mode for initial production deployment
- Start with small position sizes (< $100)
- Monitor service health with automated alerts
- Implement comprehensive error handling
- Maintain rollback capability with PM2
