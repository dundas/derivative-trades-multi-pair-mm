/**
 * Active Sessions Diagnostic Tool
 * 
 * This script lists all active trading sessions in Redis and displays basic information
 * about each session, including status, order counts, and position information.
 * 
 * Usage:
 *   node src/services/market-maker/utils/diagnostics/check-session-redis-only.js
 */

import { config } from 'dotenv';
import { RedisClient } from '../../../../lib/utils/redis-client.js';
import TraditionalStrategyStateManager from '../../strategies/traditional/state-manager.js';

// Load environment variables
config();

async function checkActiveSessions() {
  // Initialize Redis client
  const redis = new RedisClient({
    url: process.env.UPSTASH_REDIS_URL,
    token: process.env.UPSTASH_REDIS_TOKEN
  });

  try {
    // Find all session keys in Redis
    const sessionKeys = await redis.keys('traditional:kraken:*:*:session');
    console.log(`Found ${sessionKeys.length} sessions in Redis`);

    // Process each session
    for (const key of sessionKeys) {
      const keyParts = key.split(':');
      if (keyParts.length < 4) continue;

      // Extract session ID and symbol from the key
      const sessionId = keyParts[3];
      const symbol = keyParts[2].toUpperCase().replace('-', '/');

      console.log(`\n=== Session ${sessionId} (${symbol}) ===`);
      
      // Create a state manager for this session
      const stateManager = new TraditionalStrategyStateManager({
        symbol,
        sessionId,
        redis,
        logger: console
      });

      // Get session details
      const session = await stateManager.getSession();
      if (!session) {
        console.log(`  No session data found for ${sessionId}`);
        continue;
      }

      // Print basic session info
      console.log(`  Status: ${session.status}`);
      console.log(`  Started: ${new Date(session.startedAt).toLocaleString()}`);
      console.log(`  Budget: $${session.budget}`);
      console.log(`  Trading Mode: ${session.tradingMode}`);
      
      // Get orders if available
      const orders = await stateManager.loadOrders();
      if (orders && orders.orders) {
        console.log(`  Orders: ${orders.orders.length}`);
        
        // Count orders by status
        const ordersByStatus = orders.orders.reduce((acc, order) => {
          acc[order.status] = (acc[order.status] || 0) + 1;
          return acc;
        }, {});
        
        console.log('  Order Status Counts:', ordersByStatus);
      }

      // Get positions if available
      const positions = await stateManager.loadPositions();
      if (positions && positions.positions && positions.positions.length > 0) {
        console.log(`  Positions: ${positions.positions.length}`);
        
        // Count positions by status
        const positionsByStatus = positions.positions.reduce((acc, position) => {
          if (position && position.status) {
            acc[position.status] = (acc[position.status] || 0) + 1;
          }
          return acc;
        }, {});
        
        console.log('  Position Status Counts:', positionsByStatus);
      } else {
        console.log('  No positions found');
      }
    }
  } catch (error) {
    console.error('Error checking sessions:', error);
  } finally {
    await redis.disconnect();
  }
}

checkActiveSessions().catch(console.error);