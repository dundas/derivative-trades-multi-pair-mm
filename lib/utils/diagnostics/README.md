# Market Maker Diagnostic Tools

This directory contains diagnostic tools for inspecting and analyzing trading session data in the market maker service.

## Available Tools

### Session Data Inspection

#### check-session-redis.js
Examines raw Redis data for a specific trading session, including session details, orders, fills, positions, and all related Redis keys.

```bash
node check-session-redis.js <session-id>
```

#### check-session-data.js
Focuses on verifying buy-sell order relationships, checking that all sell orders have proper parentOrderId links to their corresponding buy orders.

```bash
node check-session-data.js <session-id>
```

#### check-session-redis-only.js
Lists all active trading sessions in Redis and displays basic information about each session.

```bash
node check-session-redis-only.js
```

## Usage Examples

### Checking a Specific Session

```bash
# View detailed Redis data for a session
node check-session-redis.js 4e408c05-383b-47bf-a003-0f6c93101561

# Verify buy-sell order relationships
node check-session-data.js 4e408c05-383b-47bf-a003-0f6c93101561
```

### Checking All Active Sessions

```bash
# List all active sessions
node check-session-redis-only.js
```

## Common Issues

### Redis Connection Errors

If you encounter Redis connection errors, ensure your `.env` file contains the correct Redis credentials:

```
UPSTASH_REDIS_URL=your-redis-url
UPSTASH_REDIS_TOKEN=your-redis-token
```

### Missing Session Data

If a session ID returns no data, it may have been:
- Expired (TTL exceeded)
- Migrated to D1 and removed from Redis
- Never existed with that ID

Check the D1 database for migrated sessions using the trading session manager API.
