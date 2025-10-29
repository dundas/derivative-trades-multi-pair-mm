/**
 * Session Data Diagnostic Tool
 * 
 * This script checks session data with a focus on buy-sell order relationships,
 * verifying that all sell orders have proper parentOrderId links to their corresponding buy orders.
 * 
 * Usage:
 *   node src/services/market-maker/utils/diagnostics/check-session-data.js <session-id> [--redis-url <url>] [--redis-token <token>]
 */

import dotenv from 'dotenv';
import RedisClient from '../../../../lib/utils/redis-client.js';
import TraditionalStrategyStateManager from '../../strategies/traditional/state-manager.js';

// Load environment variables from .env file
dotenv.config();

async function main() {
  try {
    // Get session ID from command line arguments
    const sessionId = process.argv[2];
    if (!sessionId) {
      console.error('Please provide a session ID as an argument');
      process.exit(1);
    }

    // Check for Redis URL and token in command line arguments
    const args = process.argv.slice(3);
    let redisUrl = process.env.UPSTASH_REDIS_URL;
    let redisToken = process.env.UPSTASH_REDIS_TOKEN;
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--redis-url' && i + 1 < args.length) {
        redisUrl = args[i + 1];
      }
      if (args[i] === '--redis-token' && i + 1 < args.length) {
        redisToken = args[i + 1];
      }
    }

    // Validate Redis credentials
    if (!redisUrl || !redisToken) {
      console.error('Redis URL and token are required. Please set them in .env file or provide via command line arguments.');
      process.exit(1);
    }

    console.log(`Checking data for session ID: ${sessionId}`);

    // Initialize Redis client
    console.log('Initializing Redis client...');
    const redisClient = new RedisClient({
      url: redisUrl,
      token: redisToken
    });
    console.log('✅ Successfully connected to Redis');

    // Initialize state manager
    const stateManager = new TraditionalStrategyStateManager({
      sessionId,
      symbol: 'BTC/USD',
      redis: redisClient,
      logger: console
    });

    // Check session data
    console.log('\n=== SESSION DATA ===');
    const sessionData = await stateManager.getSession();
    console.log(sessionData ? JSON.stringify(sessionData, null, 2) : 'No session data found');

    // Check orders with focus on buy-sell relationships
    console.log('\n=== ORDERS WITH BUY-SELL RELATIONSHIPS ===');
    const orders = await stateManager.loadOrders();
    
    if (orders && orders.orders && Array.isArray(orders.orders)) {
      console.log(`Total orders: ${orders.orders.length}`);
      
      // Find sell orders
      const sellOrders = orders.orders.filter(order => order.side === 'sell');
      console.log(`Total sell orders: ${sellOrders.length}`);
      
      // Find buy orders
      const buyOrders = orders.orders.filter(order => order.side === 'buy');
      console.log(`Total buy orders: ${buyOrders.length}`);
      
      // Check sell orders for parent order links
      console.log('\n=== SELL ORDERS WITH PARENT ORDER LINKS ===');
      const sellOrdersWithParent = sellOrders.filter(order => order.parentOrderId);
      const sellOrdersWithoutParent = sellOrders.filter(order => !order.parentOrderId);
      
      console.log(`Sell orders with parentOrderId: ${sellOrdersWithParent.length}`);
      console.log(`Sell orders WITHOUT parentOrderId: ${sellOrdersWithoutParent.length}`);
      
      if (sellOrdersWithoutParent.length > 0) {
        console.log('\n⚠️ WARNING: The following sell orders have no parent order link:');
        sellOrdersWithoutParent.forEach(order => {
          console.log(`ID: ${order.id}, Price: ${order.price}, Status: ${order.status}`);
        });
      }
      
      // Print detailed info about parent-child relationships
      console.log('\nDetailed Sell Order Parent Relationships:');
      console.log('======================================');
      
      sellOrdersWithParent.forEach(order => {
        const parentOrder = orders.orders.find(o => o.id === order.parentOrderId);
        const parentExists = parentOrder !== undefined;
        
        if (parentExists) {
          console.log(`Sell ${order.id} -> Parent ${order.parentOrderId} (${parentOrder.status})`);
        } else {
          console.log(`⚠️ Sell ${order.id} -> MISSING Parent ${order.parentOrderId}`);
        }
      });
      
      // Check filled buy orders
      console.log('\n=== FILLED BUY ORDERS ===');
      const filledBuyOrders = buyOrders.filter(order => order.status === 'filled');
      console.log(`Total filled buy orders: ${filledBuyOrders.length}`);
      
      filledBuyOrders.forEach(order => {
        console.log(`Buy Order ID: ${order.id}`);
        console.log(`  Fill Price: ${order.fillPrice}`);
        console.log(`  Fill Timestamp: ${new Date(order.fillTimestamp).toISOString()}`);
        
        // Find matching sell orders
        const matchingSellOrders = sellOrders.filter(sellOrder => sellOrder.parentOrderId === order.id);
        
        console.log(`  Matching sell orders: ${matchingSellOrders.length}`);
        if (matchingSellOrders.length === 0) {
          console.log('  ⚠️ NO MATCHING SELL ORDERS FOUND FOR THIS BUY ORDER');
        } else {
          matchingSellOrders.forEach(sellOrder => {
            console.log(`    Sell Order ID: ${sellOrder.id}`);
            console.log(`    Status: ${sellOrder.status}`);
          });
        }
        console.log('');
      });
    } else {
      console.log('No orders found');
    }

    // Check fills
    console.log('\n=== FILLS ===');
    const fills = await stateManager.loadFills();
    if (fills && fills.fills && Array.isArray(fills.fills)) {
      console.log(`Total fills: ${fills.fills.length}`);
      
      // Check for buy-sell pairs in fills
      const buyFills = fills.fills.filter(fill => fill.side === 'buy');
      const sellFills = fills.fills.filter(fill => fill.side === 'sell');
      
      console.log(`Buy fills: ${buyFills.length}`);
      console.log(`Sell fills: ${sellFills.length}`);
      
      // Check sell fills for parent order links
      const sellFillsWithParent = sellFills.filter(f => f.parentOrderId);
      const sellFillsWithoutParent = sellFills.filter(f => !f.parentOrderId);
      
      console.log(`\nSell fills with parent order link: ${sellFillsWithParent.length}`);
      console.log(`Sell fills WITHOUT parent order link: ${sellFillsWithoutParent.length}`);
      
      if (sellFillsWithoutParent.length > 0) {
        console.log('\n⚠️ WARNING: The following sell fills have no parent order link:');
        sellFillsWithoutParent.forEach(fill => {
          console.log(`ID: ${fill.id}, Price: ${fill.fillPrice}, Time: ${new Date(fill.fillTimestamp).toISOString()}`);
        });
      }
    } else {
      console.log('No fills found');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

main();
