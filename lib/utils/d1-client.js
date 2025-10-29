/**
 * D1 Database Client
 * 
 * Provides direct access to the D1 database via the Cloudflare worker API
 * for immediate session data insertion, bypassing the Redis sync delay.
 */

import fetch from 'node-fetch';
import { serviceLogger } from './logger-factory.js';

// Default Analytics API URL - can be overridden by environment variables
const ANALYTICS_API_URL = process.env.ANALYTICS_API_URL || 'https://trading-session-manager.david-525.workers.dev';

/**
 * Helper function to retry a fetch request with exponential backoff
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} retries - Number of retries
 * @param {number} backoff - Initial backoff in ms
 * @returns {Promise<Object>} - Response data
 */
async function executeFetchWithRetry(url, options, retries = 3, backoff = 300) {
  try {
    const response = await fetch(url, options);
    return await response.json();
  } catch (error) {
    if (retries <= 0) throw error;
    
    await new Promise(resolve => setTimeout(resolve, backoff));
    return executeFetchWithRetry(url, options, retries - 1, backoff * 2);
  }
}

/**
 * Insert a new trading session directly into D1 database
 * @param {Object} sessionData - The session data to insert
 * @returns {Promise<Object>} The API response
 */
export async function insertSessionToD1(sessionData) {
  try {
    // Build the SQL query to insert the new session
    const query = `
      INSERT INTO sessions (
        id, 
        symbol, 
        strategy, 
        status, 
        startedAt, 
        budget, 
        duration,
        lastUpdated,
        tradingMode,
        exchange,
        settings
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    // Current timestamp for startedAt and lastUpdated
    const timestamp = Date.now();
    
    // Format settings as JSON string if provided
    const settingsJson = sessionData.settings ? 
      JSON.stringify(sessionData.settings) : 
      JSON.stringify({
        budget: sessionData.budget,
        symbol: sessionData.tradingPair,
        strategy: sessionData.strategy
      });
    
    // Params for the query
    const params = [
      sessionData.sessionId,
      sessionData.tradingPair,
      sessionData.strategy,
      'active',  // Default status for new sessions
      timestamp,
      sessionData.budget,
      sessionData.sessionLength || 1800000, // 30 minutes default
      timestamp, // lastUpdated same as startedAt initially
      sessionData.tradingMode || 'paper',
      sessionData.exchange || 'kraken',
      settingsJson
    ];
    
    // Call the Cloudflare worker API to execute the query
    serviceLogger.info('Inserting session data directly to D1 database', {
      sessionId: sessionData.sessionId,
      symbol: sessionData.tradingPair,
      strategy: sessionData.strategy
    });
    
    // Make the request to the new direct write endpoint in the Cloudflare worker
    const response = await fetch(`${ANALYTICS_API_URL}/api/v1/direct-write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: sessionData.sessionId,
        query,
        params
      }),
    });
    
    // Parse the response
    const data = await response.json();
    
    // Log the result
    if (data.success) {
      serviceLogger.info('Successfully inserted session data to D1', {
        sessionId: sessionData.sessionId,
        response: data
      });
    } else {
      serviceLogger.error('Failed to insert session data to D1', {
        sessionId: sessionData.sessionId,
        error: data.error || 'Unknown error',
        response: data
      });
    }
    
    return data;
  } catch (error) {
    serviceLogger.error('Error inserting session data to D1', {
      sessionId: sessionData.sessionId,
      error: error.message,
      stack: error.stack
    });
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Insert a fill record into the D1 database based on a filled order
 * @param {Object} orderData - The filled order data
 * @returns {Promise<Object>} The API response
 */
export async function insertFillToD1(orderData) {
  // Only process orders that are filled and have the necessary fill data
  if (orderData.status !== 'filled' || !orderData.fillPrice || !orderData.fillTimestamp) {
    return {
      success: false,
      error: 'Order is not filled or missing fill data',
      data: { orderId: orderData.id }
    };
  }
  
  try {
    // Build the SQL query to insert the fill
    const query = `
      INSERT INTO fills (
        id,
        sessionId,
        orderId,
        symbol,
        side,
        price,
        size,
        timestamp,
        usdValue,
        marketPrice,
        tradingMode,
        exchange
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    // Generate a unique fill ID based on order ID
    const fillId = `fill-${orderData.id}-${Date.now()}`;
    
    // Calculate USD value of the fill
    const usdValue = orderData.fillPrice * orderData.size;
    
    // Params for the query
    const params = [
      fillId,
      orderData.sessionId,
      orderData.id,
      orderData.symbol,
      orderData.side,
      orderData.fillPrice,
      orderData.size,
      orderData.fillTimestamp,
      usdValue,
      orderData.marketPrice,
      orderData.tradingMode || 'paper',
      orderData.exchange || 'kraken'
    ];
    
    // Log the fill insertion
    serviceLogger.info('Inserting fill data directly to D1 database', {
      fillId,
      orderId: orderData.id,
      sessionId: orderData.sessionId,
      symbol: orderData.symbol,
      fillPrice: orderData.fillPrice
    });
    
    // Make the request to the query API in the Cloudflare worker
    const data = await executeFetchWithRetry(`${ANALYTICS_API_URL}/api/v1/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        params
      }),
    });
    
    // Log the result
    if (data.success && data.data && data.data.success) {
      serviceLogger.info('Successfully inserted fill data to D1', {
        fillId,
        orderId: orderData.id,
        sessionId: orderData.sessionId
      });
      
      return {
        success: true,
        data: {
          fillId,
          orderId: orderData.id
        }
      };
    } else {
      serviceLogger.error('Failed to insert fill data to D1', {
        fillId,
        orderId: orderData.id,
        error: (data.data && data.data.error) || data.error || 'Unknown error',
        response: data
      });
      
      return {
        success: false,
        error: (data.data && data.data.error) || data.error || 'Unknown error',
        data: {
          fillId,
          orderId: orderData.id
        }
      };
    }
  } catch (error) {
    serviceLogger.error('Error inserting fill data to D1', {
      orderId: orderData.id,
      error: error.message,
      stack: error.stack
    });
    
    return {
      success: false,
      error: error.message,
      data: {
        orderId: orderData.id
      }
    };
  }
}
