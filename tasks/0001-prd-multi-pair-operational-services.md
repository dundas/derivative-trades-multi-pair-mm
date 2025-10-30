# PRD: Multi-Pair Operational Services

## 1. Introduction/Overview

The Multi-Pair Market Maker currently lacks critical operational services for post-trade management. This PRD defines the implementation of three essential services that will enable production-ready operations:

1. **Multi-Pair Settlement Service** - Batch processing to ensure all open positions have take-profit orders
2. **Multi-Pair Take-Profit Service** - Centralized engine for creating exit orders with aging-based pricing
3. **Multi-Pair Migration Service** - Historical data migration from Redis to PostgreSQL for SQL-based analysis

**Problem Statement:** The multi-pair MM can open positions across multiple trading pairs but lacks automated position coverage, exit order management, and historical data persistence for analysis.

**Solution:** Port and adapt proven operational services from the single-pair market maker to support multi-pair trading with parallel processing, pair-aware data structures, and portfolio-level risk management.

## 2. Goals

1. **Zero Uncovered Positions** - Automatically create take-profit orders for any position missing coverage within 3 minutes
2. **Batch Settlement Efficiency** - Process 10+ active trading pairs in parallel with <5 second total latency
3. **Historical Data Persistence** - Migrate 100% of Redis session data to PostgreSQL within 1 hour of session completion
4. **Fee-Optimized Exits** - Use aging-based pricing strategies to maximize net profit after trading fees
5. **Production Reliability** - Support cron-based execution every 3 minutes with comprehensive error handling

## 3. User Stories

**As a Market Maker Operator:**
- I want uncovered positions to be automatically detected and covered so that I don't have manual intervention risks
- I want settlement to run automatically every 3 minutes so that positions are quickly covered even if the reconciler fails
- I want historical trading data in PostgreSQL so that I can run SQL-based performance analysis
- I want aging-based take-profit pricing so that old positions are exited faster to free up capital

**As a Trading System:**
- I want to process multiple trading pairs in parallel so that settlement completes quickly
- I want duplicate order prevention so that I don't accidentally create multiple take-profit orders for the same position
- I want portfolio-level stop-loss monitoring so that daily loss limits are enforced across all pairs
- I want comprehensive logging so that I can debug settlement issues

**As a Data Analyst:**
- I want all session data (orders, fills, positions) in PostgreSQL so that I can query trading performance
- I want pair-level aggregations so that I can compare profitability across different trading pairs
- I want fill-level deduplication so that my P&L calculations are accurate

## 4. Functional Requirements

### 4.1 Multi-Pair Settlement Service

**FR-1.1** The service MUST discover active sessions from PostgreSQL using `getRecentSessions(hoursBack=24, limit=100)`

**FR-1.2** The service MUST group sessions by `sessionId` and identify all trading pairs per session from the `pairs` JSONB column

**FR-1.3** The service MUST query Redis for uncovered positions across all pairs in parallel using `Promise.allSettled()`

**FR-1.4** The service MUST create batch take-profit orders by calling `multiPairTakeProfitService.createBatchTakeProfits(sessionId, positionsByPair)`

**FR-1.5** The service MUST track settlement status in Redis with keys:
- `settlement:status:{sessionId}` → IN_PROGRESS | COMPLETED | FAILED
- `settlement:last_run:{sessionId}` → ISO timestamp

**FR-1.6** The service MUST evaluate portfolio-level stop-loss across all pairs and trigger emergency exit if daily loss exceeds threshold

**FR-1.7** The service MUST support cron execution every 3 minutes with concurrency control using Redis locks

**FR-1.8** The service MUST log all settlement actions to both console and file logs at `session-logs/{sessionId}/settlement.log`

### 4.2 Multi-Pair Take-Profit Service

**FR-2.1** The service MUST provide a batch API: `createBatchTakeProfits(sessionId, positionsByPair)` where `positionsByPair` is structured as:
```javascript
{
  "BTC/USD": [{ positionId, buyOrderId, quantity, buyPrice, ... }],
  "ETH/USD": [{ positionId, buyOrderId, quantity, buyPrice, ... }]
}
```

**FR-2.2** The service MUST calculate aging-based take-profit prices using `TakeProfitCore.calculateAgingBasedParameters()` with position age in hours

**FR-2.3** The service MUST use maker-friendly limit orders with `postOnly: true` flag to minimize trading fees

**FR-2.4** The service MUST prevent duplicate orders using Redis keys: `tp_attempt:{sessionId}:{positionId}` with 1-hour TTL

**FR-2.5** The service MUST validate asset availability before creating orders using `ComprehensiveBalanceValidator`

**FR-2.6** The service MUST process pairs in parallel with individual error handling (one pair failure doesn't block others)

**FR-2.7** The service MUST support aging tiers:
- 0-1 hour: Base target profit (e.g., 0.5%)
- 1-4 hours: Reduced profit target (e.g., 0.3%)
- 4-12 hours: Breakeven + fees
- 12+ hours: Slightly below breakeven to force exit

**FR-2.8** The service MUST track created take-profit orders in Redis: `tp_order:{sessionId}:{orderId}` with order metadata

### 4.3 Multi-Pair Migration Service

**FR-3.1** The service MUST use Redis-Backend-API managers (`SessionManager`, `OrderManager`, `FillManager`) for data fetching

**FR-3.2** The service MUST fetch session data grouped by (sessionId, symbol) for efficient batch processing

**FR-3.3** The service MUST persist data to PostgreSQL with pair-aware schema:
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  pairs JSONB,
  pair_count INTEGER,
  total_orders INTEGER,
  total_fills INTEGER,
  total_pnl NUMERIC,
  started_at TIMESTAMP,
  ended_at TIMESTAMP
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  pair_index INTEGER,
  side TEXT,
  type TEXT,
  quantity NUMERIC,
  price NUMERIC,
  status TEXT,
  created_at TIMESTAMP,
  INDEX idx_orders_session_symbol (session_id, symbol)
);

CREATE TABLE fills (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quantity NUMERIC,
  price NUMERIC,
  fee NUMERIC,
  timestamp TIMESTAMP,
  UNIQUE (session_id, order_id, symbol, timestamp, price, quantity)
);
```

**FR-3.4** The service MUST deduplicate fills by (sessionId, orderId, symbol, timestamp, price, quantity) composite key

**FR-3.5** The service MUST support batch processing with configurable batch size (default: 10 sessions)

**FR-3.6** The service MUST calculate pair-level aggregations:
- Total orders per pair
- Total fills per pair
- Total P&L per pair
- Average spread per pair

**FR-3.7** The service MUST support incremental migration (only migrate sessions not yet in PostgreSQL)

**FR-3.8** The service MUST mark migrated sessions in Redis: `migration:completed:{sessionId}` → ISO timestamp

### 4.4 Shared Infrastructure

**FR-4.1** All services MUST use the `MarketMakerLogger` from `utils/logger-factory.js` with component-specific prefixes

**FR-4.2** All services MUST support configurable log levels via `LOG_LEVEL` environment variable (TRACE, DEBUG, INFO, WARN, ERROR)

**FR-4.3** All services MUST support dry-run mode for testing without creating actual orders or database writes

**FR-4.4** All services MUST expose health check endpoints for monitoring

**FR-4.5** All services MUST emit metrics to Redis for dashboard visualization:
- `metrics:settlement:{sessionId}` → { uncoveredCount, coveredCount, duration }
- `metrics:takeprofit:{sessionId}` → { created, failed, totalValue }
- `metrics:migration:{sessionId}` → { orders, fills, duration }

## 5. Non-Goals (Out of Scope)

**NG-1** Real-time order reconciliation (WebSocket-based) - Will be addressed in a separate PRD

**NG-2** Stop-loss order creation - Only monitoring and alerting for now

**NG-3** Portfolio rebalancing across pairs - Future enhancement

**NG-4** Advanced analytics UI - Only raw PostgreSQL data provision

**NG-5** Multi-exchange support - Initially Kraken-only

**NG-6** Options/futures contracts - Spot pairs only

## 6. Design Considerations

### 6.1 Directory Structure
```
src/services/
├── multi-pair-settlement-service.js        # Main settlement orchestrator
├── multi-pair-take-profit-service.js       # Take-profit engine
└── migration/
    └── multi-pair-migration-service.js     # Historical data migration
```

### 6.2 Shared Components to Port
- `src/services/take-profit-core.js` (from main repo) - Aging-based pricing logic
- `lib/utils/comprehensive-balance-validator.js` - Asset availability validation
- `lib/redis-backend-api/` - SessionManager, OrderManager, FillManager

### 6.3 Configuration
All services should be configurable via environment variables:
```bash
# Settlement Service
SETTLEMENT_INTERVAL_MINUTES=3
SETTLEMENT_LOOKBACK_HOURS=24
SETTLEMENT_MAX_SESSIONS=100

# Take-Profit Service
TP_BASE_TARGET_PERCENT=0.5
TP_AGING_TIER_1_HOURS=1
TP_AGING_TIER_2_HOURS=4
TP_AGING_TIER_3_HOURS=12

# Migration Service
MIGRATION_BATCH_SIZE=10
MIGRATION_LOOKBACK_HOURS=48
```

## 7. Technical Considerations

### 7.1 Dependencies
- **Existing in multi-pair repo:**
  - `ioredis` - Redis client
  - `winston` - Logging (via TradingLogger)
  - `uuid` - Unique ID generation
  - `dotenv` - Environment configuration

- **Need to port from main repo:**
  - `lib/redis-backend-api/` - Session/Order/Fill managers
  - `lib/utils/comprehensive-balance-validator.js`
  - `src/services/take-profit-core.js`
  - `lib/exchanges/kraken/kraken-cache-client.js`

### 7.2 Data Flow
```
┌─────────────────────────────────────┐
│  Cron Trigger (every 3 minutes)    │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Multi-Pair Settlement Service      │
│  - Discover sessions (PostgreSQL)   │
│  - Group by sessionId, pairs        │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Query Redis for Uncovered          │
│  Positions (per pair, parallel)     │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Multi-Pair Take-Profit Service     │
│  - Calculate aging-based prices     │
│  - Create batch take-profit orders  │
│  - Update Redis: tp_order keys      │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  KrakenWebSocketV2ExchangeAdapter   │
│  - Submit limit orders to exchange  │
└─────────────────────────────────────┘
```

### 7.3 Migration Data Flow
```
┌─────────────────────────────────────┐
│  Multi-Pair Migration Service       │
│  - Fetch session IDs (PostgreSQL)   │
│  - Filter: not yet migrated         │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Redis-Backend-API                  │
│  - SessionManager.getSessionData()  │
│  - OrderManager.getOrders()         │
│  - FillManager.getFills()           │
│  (grouped by sessionId + symbol)    │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  PostgreSQL Bulk Writer             │
│  - sessions table (JSONB pairs)     │
│  - orders table (symbol column)     │
│  - fills table (deduplication)      │
│  - Mark migration:completed in Redis│
└─────────────────────────────────────┘
```

### 7.4 Error Handling Strategy
- **Transient errors** (network timeouts): Retry with exponential backoff (max 3 attempts)
- **Permanent errors** (invalid order params): Log error, continue with next position
- **Critical errors** (database connection lost): Exit process, rely on cron retry

### 7.5 Concurrency Control
- Use Redis distributed locks for settlement: `lock:settlement:{sessionId}` with 5-minute TTL
- Prevent duplicate take-profit creation: `tp_attempt:{sessionId}:{positionId}` with 1-hour TTL
- Migration service: Single-threaded per session to avoid race conditions

## 8. Success Metrics

**SM-1** Settlement Coverage Rate: 99%+ of positions should have take-profit orders within 3 minutes of being opened

**SM-2** Settlement Latency: Average settlement cycle should complete in <5 seconds for 10 active pairs

**SM-3** Migration Completeness: 100% of sessions should be migrated to PostgreSQL within 1 hour of completion

**SM-4** Order Creation Success Rate: 95%+ of take-profit order creation attempts should succeed (excluding balance issues)

**SM-5** Fee Optimization: Average take-profit execution should use limit orders (maker fees) 90%+ of the time

**SM-6** Data Deduplication: Zero duplicate fills in PostgreSQL (enforced by unique constraint)

**SM-7** Service Reliability: Settlement service should run successfully 99%+ of scheduled executions

## 9. Open Questions

**Q1** Should we implement portfolio-level stop-loss in Phase 1 or defer to Phase 2?
- **Recommendation:** Implement monitoring/alerting in Phase 1, actual order creation in Phase 2

**Q2** What is the priority order for implementation?
- **Recommendation:**
  1. Take-Profit Service (shared engine)
  2. Settlement Service (depends on take-profit)
  3. Migration Service (can be done in parallel)

**Q3** Should migration service run on a schedule or be triggered manually?
- **Recommendation:** Both - scheduled for automatic operation, CLI for manual backfills

**Q4** How should we handle exchange rate limits for multi-pair batch operations?
- **Recommendation:** Use KrakenCacheClient with 500ms delays between order creation calls per pair

**Q5** What PostgreSQL schema changes are needed in the existing database?
- **Action:** Need to review existing `sessions`, `orders`, `fills` tables and add:
  - `sessions.pairs` JSONB column
  - `sessions.pair_count` INTEGER column
  - `orders.symbol` TEXT column (if missing)
  - `orders.pair_index` INTEGER column
  - Update indexes for multi-pair queries

**Q6** Should we maintain backwards compatibility with single-pair settlement service?
- **Recommendation:** Yes - Multi-pair services should detect single-pair sessions and process them correctly

**Q7** How do we test these services without risking real funds?
- **Recommendation:**
  1. Implement comprehensive dry-run mode
  2. Use paper trading environment first
  3. Start with small position sizes in production

## 10. Implementation Phases

### Phase 1: Core Services (Week 1-2)
- Port TakeProfitCore and dependencies
- Implement Multi-Pair Take-Profit Service
- Implement Multi-Pair Settlement Service
- Unit tests for aging calculations

### Phase 2: Migration Service (Week 2-3)
- Design PostgreSQL schema updates
- Implement Multi-Pair Migration Service
- Batch processing with deduplication
- Migration verification queries

### Phase 3: Integration Testing (Week 3-4)
- End-to-end testing with paper trading
- Load testing with 10+ concurrent pairs
- Error injection and recovery testing
- Performance optimization

### Phase 4: Production Deployment (Week 4-5)
- Deploy to DigitalOcean with PM2
- Configure cron jobs
- Set up monitoring and alerting
- Gradual rollout with small position sizes

## 11. References

**Main Repo Services (to port from):**
- `src/services/market-maker/settlement-service/run-settlement-service-unified.js`
- `src/services/take-profit-service.js`
- `src/services/take-profit-core.js`
- `src/services/market-maker/migration/run-redis-to-sql-migration-unified.js`

**Multi-Pair Repo Files (existing):**
- `src/core/MultiPairOpportunisticTrader.js` - Main trading orchestrator
- `src/position/DynamicPositionManager.js` - Position tracking (stub reconciliation at line 157)
- `src/exchanges/kraken/KrakenWebSocketV2ExchangeAdapter.js` - Exchange adapter
- `utils/logger-factory.js` - Logging infrastructure

**Documentation:**
- Main repo: `docs/MULTI_PAIR_ARCHITECTURE.md`
- Multi-pair repo: `README.md`
