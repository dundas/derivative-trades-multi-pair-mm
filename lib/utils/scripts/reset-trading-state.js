/**
 * Reset Trading State Script
 * 
 * This script performs a comprehensive reset of the trading state in Redis,
 * ensuring all positions are properly cleaned up and budget allocation is reset.
 * It uses the environment variables from .env for Redis connection.
 */

import dotenv from 'dotenv';
import StateManager from '../state-manager.js';
import RedisClient from '../../../../lib/utils/redis-client.js';

// Load environment variables
dotenv.config();

// Initialize Redis client
const redisClient = new RedisClient({
  url: process.env.REDIS_URL,
  token: process.env.DO_REDIS_TOKEN
});

// Initialize state manager
const stateManager = new StateManager(redisClient);

// Key prefixes
const SYMBOL = 'BTC/USD';
const EXCHANGE = 'kraken';
const BASE_KEY = `market-maker:${EXCHANGE}:${SYMBOL.toLowerCase().replace('/', '-')}`;
const POSITIONS_KEY = `${BASE_KEY}:positions`;
const STATE_KEY = `${BASE_KEY}:state`;
const ACTIVE_SESSION_KEY = `${BASE_KEY}:active-session`;
const RECENT_SESSIONS_KEY = `${BASE_KEY}:recent-sessions`;
const VOLUME_KEY = `${BASE_KEY}:volume`;

// Global recent sessions key (used by RecentSessionsManager and migration service)
const GLOBAL_RECENT_SESSIONS_KEY = 'recent_sessions:active';

async function main() {
  console.log('Starting comprehensive trading state reset...');
  
  try {
    // 1. Reset trading mode using the StateManager
    console.log('\nResetting trading mode using StateManager...');
    const resetResult = await stateManager.resetTradingMode('paper');
    console.log('Reset result:', resetResult);
    
    // 2. Directly clear positions key
    console.log('\nDirectly clearing positions key...');
    await redisClient.set(POSITIONS_KEY, []);
    console.log(`Set ${POSITIONS_KEY} to empty array`);
    
    // 3. Find all position-related keys
    console.log('\nSearching for position-related keys...');
    const positionKeys = await redisClient.keys('*position*');
    console.log(`Found ${positionKeys.length} position-related keys:`);
    positionKeys.forEach(key => console.log(` - ${key}`));
    
    // 4. Delete all position keys
    if (positionKeys.length > 0) {
      console.log('\nDeleting position keys...');
      for (const key of positionKeys) {
        await redisClient.del(key);
        console.log(`Deleted key: ${key}`);
      }
    }
    
    // 5. Reset state with a clean budget
    console.log('\nResetting state...');
    const newState = {
      budget: 1000, // Increased from 200 to 1000 to allow for more positions
      allocatedBudget: 0,
      reservedBudget: 0,
      totalProfitLoss: 0,
      drawdownCurrent: 0,
      drawdownMax: 0
    };
    await redisClient.set(STATE_KEY, newState);
    console.log(`Set new state: ${JSON.stringify(newState)}`);
    
    // 6. Clear active session
    console.log('\nClearing active session...');
    await redisClient.del(ACTIVE_SESSION_KEY);
    console.log(`Deleted active session key: ${ACTIVE_SESSION_KEY}`);
    
    // 7. Reset recent sessions (legacy symbol-specific key)
    console.log('\nResetting recent sessions...');
    await redisClient.set(RECENT_SESSIONS_KEY, []);
    console.log(`Reset recent sessions to empty array`);
    
    // 8. Reset global recent sessions (used by migration service)
    // NOTE: recent_sessions:active must be a Redis sorted set (ZSET), not a string array
    // The migration service expects to use ZRANGEBYSCORE operations on this key
    console.log('\nClearing global recent sessions (sorted set)...');
    await redisClient.del(GLOBAL_RECENT_SESSIONS_KEY);
    console.log(`Cleared global recent sessions sorted set: ${GLOBAL_RECENT_SESSIONS_KEY}`);
    
    // 9. Reset volume data
    console.log('\nResetting volume data...');
    const defaultVolumeData = {
      last24h: 0,
      last7d: 0,
      last30d: 0,
      volumeHistory: [],
      lastUpdated: Date.now()
    };
    await redisClient.set(VOLUME_KEY, defaultVolumeData);
    console.log(`Reset volume data to default values`);
    
    // 10. Find all session-related keys
    console.log('\nSearching for session-related keys...');
    const sessionKeys = await redisClient.keys('*session*');
    console.log(`Found ${sessionKeys.length} session-related keys:`);
    sessionKeys.forEach(key => console.log(` - ${key}`));
    
    // 11. Delete all session keys
    if (sessionKeys.length > 0) {
      console.log('\nDeleting session keys...');
      for (const key of sessionKeys) {
        if (key !== RECENT_SESSIONS_KEY && key !== ACTIVE_SESSION_KEY && key !== GLOBAL_RECENT_SESSIONS_KEY) {
          await redisClient.del(key);
          console.log(`Deleted key: ${key}`);
        }
      }
    }
    
    console.log('\nComprehensive reset complete!');
    console.log('You can now run the paper trading script with a clean state.');
  } catch (error) {
    console.error('Error during reset:', error);
  }
}

// Run the script if called directly
if (process.argv[1].includes('reset-trading-state.js')) {
  main().catch(error => {
    console.error('Error during reset:', error);
    process.exit(1);
  }).finally(() => {
    // Close any connections
    setTimeout(() => process.exit(0), 1000);
  });
}

export default main;
