/**
 * Redis Session Diagnostic Tool
 * 
 * This script checks Redis for session data, positions, orders, and fills for a given session ID.
 * 
 * Usage:
 *   node src/services/market-maker/utils/diagnostics/check-session-redis.js <session-id>
 */

import dotenv from 'dotenv';
import RedisClient from '../../../../lib/utils/redis-client.js';
import TraditionalStrategyStateManager from '../../strategies/traditional/state-manager.js';

// Load environment variables
dotenv.config();

// Get session ID from command line arguments
const sessionId = process.argv[2];
if (!sessionId) {
  console.error('Please provide a session ID as an argument');
  process.exit(1);
}

console.log(`Checking Redis data for session ID: ${sessionId}`);

// Function to initialize Redis client
async function initRedis() {
  const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
  const REDIS_TOKEN = process.env.REDIS_TOKEN || process.env.UPSTASH_REDIS_TOKEN;

  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error('Redis URL or token not found in environment variables');
    process.exit(1);
  }

  const client = new RedisClient({
    url: REDIS_URL,
    token: REDIS_TOKEN,
    debug: true
  });
  
  try {
    // Test connection
    await client.ping();
    console.log('✅ Successfully connected to Redis');
    return client;
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    process.exit(1);
  }
}

// Main function to check session state
async function checkSessionState(sessionId, symbol = 'BTC-USD') {
  try {
    console.log(`Checking Redis state for session ${sessionId} (${symbol})...\n`);
    
    // Initialize Redis client
    const client = await initRedis();
    
    // Create state manager
    const stateManager = new TraditionalStrategyStateManager({
      redis: client,
      symbol,
      sessionId,
      logger: console
    });
    
    // Get base key
    const baseKey = `strategy:traditional:${symbol.replace('/', '_')}:${sessionId}`;
    console.log(`Base Redis key: ${baseKey}\n`);
    
    // Check what keys exist for this session
    const keys = await client.keys(`${baseKey}*`);
    console.log(`Found ${keys.length} keys for this session:`);
    keys.forEach(key => console.log(`- ${key}`));
    console.log('');
    
    // Get session information
    const sessionData = await client.get(`${baseKey}:session`);
    if (sessionData) {
      console.log('=== SESSION INFORMATION ===');
      console.log('Raw session data:');
      console.log(sessionData);
      console.log('\n');
      const session = JSON.parse(sessionData);
      console.log(JSON.stringify(session, null, 2));
      console.log('');
    }
    
    // Load orders
    const ordersData = await stateManager.loadOrders();
    console.log('=== ORDERS ===');
    
    if (!ordersData) {
      console.log('No orders data found');
      return;
    }
    
    console.log('Raw orders data:');
    console.log(JSON.stringify(ordersData, null, 2));
    console.log('\n');
    
    // Process orders for display
    const ordersArray = Array.isArray(ordersData) ? ordersData : ordersData.orders;
    
    if (!ordersArray || !Array.isArray(ordersArray)) {
      console.log('Orders data is not in expected format:');
      console.log(`Orders data type: ${typeof ordersArray}`);
      console.log('Orders value:', ordersArray);
      return;
    }
    
    console.log(`Total orders: ${ordersArray.length}`);
    const buyOrders = ordersArray.filter(order => order.side === 'buy');
    const sellOrders = ordersArray.filter(order => order.side === 'sell');
    console.log(`Buy orders: ${buyOrders.length}`);
    console.log(`Sell orders: ${sellOrders.length}`);

    const activeOrders = ordersArray.filter(o => o.status === 'open');
    const filledOrders = ordersArray.filter(o => o.status === 'filled');
    const canceledOrders = ordersArray.filter(o => o.status === 'canceled');
    
    console.log(`Order status breakdown:`);
    console.log(`- Open: ${activeOrders.length}`);
    console.log(`- Filled: ${filledOrders.length}`);
    console.log(`- Canceled: ${canceledOrders.length}`);
    
    console.log('\nMost recent orders:');
    const recentOrders = ordersArray.slice(-5).reverse(); // Get last 5 orders in reverse chronological order
    recentOrders.forEach(order => {
      console.log(`- ${order.id}: ${order.side} ${order.size} @ ${order.price} (${order.status})`);
    });
    console.log('');
    
    // Load fills
    const fillsData = await stateManager.loadFills();
    console.log('=== FILLS ===');
    
    if (!fillsData) {
      console.log('No fills data found');
      return;
    }
    
    console.log('Raw fills data:');
    console.log(JSON.stringify(fillsData, null, 2));
    console.log('\n');
    
    // Process fills for display
    const fillsArray = Array.isArray(fillsData) ? fillsData : (fillsData.fills || []);
    
    if (!fillsArray || !Array.isArray(fillsArray)) {
      console.log('Fills data is not in expected format:');
      console.log(`Fills data type: ${typeof fillsArray}`);
      console.log('Fills value:', fillsArray);
      return;
    }
    
    console.log(`Total fills: ${fillsArray.length}`);
    const buyFills = fillsArray.filter(fill => fill.side === 'buy');
    const sellFills = fillsArray.filter(fill => fill.side === 'sell');
    console.log(`Buy fills: ${buyFills.length}`);
    console.log(`Sell fills: ${sellFills.length}`);
    
    // Check sell fills with parent order links
    const sellFillsWithParent = sellFills.filter(f => f.parentOrderId);
    const sellFillsWithoutParent = sellFills.filter(f => !f.parentOrderId);
    
    console.log(`\nSell fills with parent order link: ${sellFillsWithParent.length}`);
    console.log(`Sell fills WITHOUT parent order link: ${sellFillsWithoutParent.length}`);
    
    if (sellFillsWithoutParent.length > 0) {
      console.log('\nWARNING: Found sell fills without parent order links:');
      sellFillsWithoutParent.forEach(fill => {
        console.log(`- ${fill.id}: ${fill.price} @ ${fill.timestamp}`);
      });
    }

    // Display recent fills
    console.log('\nMost recent fills:');
    const recentFills = fillsArray.slice(-5).reverse(); // Get last 5 fills in reverse chronological order
    recentFills.forEach(fill => {
      const parentInfo = fill.parentOrderId ? ` (parent: ${fill.parentOrderId})` : '';
      console.log(`- ${fill.id || fill.orderId}: ${fill.side} ${fill.size} @ ${fill.price}${parentInfo}`);
    });
    console.log('');
    
    // Load positions
    const positions = await stateManager.loadPositions();
    if (positions) {
      console.log('=== POSITIONS ===');
      console.log('Raw positions data:');
      console.log(JSON.stringify(positions, null, 2));
      console.log('\n');
      console.log(JSON.stringify(positions, null, 2));
      console.log('');
    }
    
    // Load balances
    const balances = await stateManager.loadBalances();
    if (balances) {
      console.log('=== BALANCES ===');
      console.log(JSON.stringify(balances, null, 2));
      console.log('');
    }
    
    // Load metrics
    const metrics = await client.get(`${baseKey}:metrics`);
    if (metrics) {
      console.log('=== METRICS ===');
      console.log(JSON.stringify(JSON.parse(metrics), null, 2));
      console.log('');
    }
    
    console.log('=== SESSION COMPLETE ===');
    console.log(`Session check complete for ${sessionId}`);
    
    // Clean up Redis connection
    try {
      if (client && typeof client.disconnect === 'function') {
        await client.disconnect();
      }
    } catch (error) {
      console.warn('Error disconnecting from Redis:', error.message);
    }
  } catch (error) {
    console.error('Error checking session state:', error);
  }
}

// Run the check
checkSessionState(sessionId);
