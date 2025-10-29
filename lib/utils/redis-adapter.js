/**
 * Redis Adapter for Market Maker
 * 
 * Provides Redis client initialization and connection management.
 * This is a simplified implementation specifically for the Market Maker service.
 */

/**
 * Simple Redis client adapter for Upstash Redis REST API
 */

import fetch from 'node-fetch';
import { createLogger } from './logger-factory.js';
import { RedisClient } from '../../../lib/utils/redis-client.js';

// Create Redis-specific logger
const logger = createLogger('redis-adapter');

/**
 * Simple Redis Client for Upstash Redis REST API
 * This is a lightweight implementation designed specifically for Cloudflare Workers
 */
class SimpleRedisClient {
  constructor(options = {}) {
    if (!options.url || !options.token) {
      throw new Error('Redis client requires URL and token');
    }
    
    this.url = options.url;
    this.token = options.token;
    this.debug = options.debug || false;
    this.requestCount = 0;
    this.errorCount = 0;
    this.maxKeyLength = 512; // Maximum key length for Redis
    this.maxMgetBatchSize = options.maxMgetBatchSize || 20; // Reduced from 25 to 20 to avoid 400 errors
    
    // Use structured logger instead of console.log
    logger.info(`Redis adapter initialized with maxMgetBatchSize: ${this.maxMgetBatchSize}`);
  }
  
  /**
   * Make fetch request to Upstash Redis REST API
   */
  async _fetch(endpoint, options = {}) {
    this.requestCount++;
    
    try {
      const headers = {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers
      };
      
      // Fix endpoint - ensure it doesn't have multiple slashes at the end
      const url = this.url.endsWith('/') ? this.url.slice(0, -1) : this.url;
      
      const response = await fetch(`${url}${endpoint}`, {
        ...options,
        headers
      });
      
      if (!response.ok) {
        const text = await response.text();
        this.errorCount++;
        logger.error(`Redis error: ${response.status} ${response.statusText} - ${text}`);
        throw new Error(`Redis error: ${response.status} ${response.statusText} - ${text}`);
      }
      
      // For debugging request stats, use debug level
      if (this.requestCount % 100 === 0) {
        logger.debug(`Redis: processed ${this.requestCount} requests (${this.errorCount} errors)`);
      }
      
      return response.json();
    } catch (error) {
      this.errorCount++;
      logger.error(`Redis fetch error: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Execute a Redis command
   */
  async _command(command, ...args) {
    try {
      // Check for excessively long keys that could cause 400 errors
      if (command === 'GET' || command === 'SET' || command === 'DEL') {
        const key = args[0];
        if (typeof key === 'string' && key.length > this.maxKeyLength) {
          logger.warn(`Redis key exceeds maximum length (${key.length} > ${this.maxKeyLength}): ${key.substring(0, 50)}...`);
          if (command === 'GET') return null;
          if (command === 'SET') return false;
          if (command === 'DEL') return 0;
        }
      }
      
      // Special handling for MGET with lots of keys
      if (command === 'MGET' && args.length > this.maxMgetBatchSize) {
        // Log the beginning of larger batch operations with debug level
        logger.debug(`Redis MGET with ${args.length} keys`);  
        
        // Sample a few keys for logging
        if (args.length > 10) {
          const sampleKeys = args.slice(0, 3).concat(['...'], args.slice(-3));
          logger.debug(`Sample keys: ${sampleKeys.join(', ')}`);
        }
        
        // Process in batches
        const results = [];
        for (let i = 0; i < args.length; i += this.maxMgetBatchSize) {
          const batchArgs = args.slice(i, i + this.maxMgetBatchSize);
          const batchResults = await this._command(command, ...batchArgs);
          results.push(...batchResults);
        }
        
        // Log a sample of the response for debugging
        if (results.length > 10) {
          const resultSample = JSON.stringify(results.slice(0, 2)).substring(0, 50) + '...';
          logger.debug(`MGET response sample: ${resultSample}`);
        }
        
        return results;
      }

      // Format for Upstash Redis REST API
      const result = await this._fetch('/', {
        method: 'POST',
        body: JSON.stringify([command, ...args])
      });
      
      return result.result;
    } catch (error) {
      logger.error(`Redis command error (${command}): ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Ping Redis server
   */
  async ping() {
    try {
      return await this._command('PING');
    } catch (error) {
      logger.error(`Redis ping failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get a value from Redis
   */
  async get(key, parseJson = false) {
    // Check for invalid keys
    if (!key || typeof key !== 'string') {
      return null;
    }
    
    try {
      const result = await this._command('GET', key);
      
      if (result && parseJson) {
        try {
          return JSON.parse(result);
        } catch (parseError) {
          // If JSON parsing fails, return the raw string
          return result;
        }
      }
      
      return result;
    } catch (error) {
      // Simplified error logging
      return null;
    }
  }
  
  /**
   * Set a value in Redis
   */
  async set(key, value, expiry = null) {
    // Check for invalid keys
    if (!key || typeof key !== 'string') {
      return false;
    }
    
    const args = [key];
    
    // Handle object values by converting to JSON
    if (typeof value === 'object') {
      args.push(JSON.stringify(value));
    } else {
      args.push(String(value));
    }
    
    // Add expiry if provided
    if (expiry !== null) {
      args.push('EX', expiry);
    }
    
    try {
      const result = await this._command('SET', ...args);
      return result === 'OK';
    } catch (error) {
      // Simplified error logging
      return false;
    }
  }
  
  /**
   * Delete a key from Redis
   */
  async del(...keys) {
    // Filter out invalid keys
    const validKeys = keys.filter(key => key && typeof key === 'string');
    
    if (validKeys.length === 0) {
      return 0;
    }
    
    try {
      return await this._command('DEL', ...validKeys);
    } catch (error) {
      // Simplified error logging
      return 0;
    }
  }
  
  /**
   * Get multiple values from Redis
   */
  async mget(...keys) {
    // Filter out invalid keys
    const validKeys = keys.filter(key => key && typeof key === 'string');
    
    if (validKeys.length === 0) {
      return [];
    }
    
    try {
      return await this._command('MGET', ...validKeys);
    } catch (error) {
      // Simplified error logging
      return validKeys.map(() => null);
    }
  }
  
  /**
   * Find keys matching a pattern using SCAN (safer than KEYS for production)
   */
  async scan(pattern, limit = 1000) {
    if (!pattern || typeof pattern !== 'string') {
      return [];
    }
    
    try {
      const keys = [];
      let cursor = '0';
      let count = 100; // Process in batches of 100
      
      // Process iteratively until we get all keys or reach the limit
      do {
        // Run SCAN command with cursor, COUNT, and MATCH options
        const result = await this._command('SCAN', cursor, 'MATCH', pattern, 'COUNT', count);
        
        // SCAN returns an array with [nextCursor, keysArray]
        cursor = result[0];
        const batch = result[1] || [];
        
        // Add the batch keys to our results
        keys.push(...batch);
        
        // Stop if we've reached the limit
        if (keys.length >= limit) {
          logger.warn(`Scan reached limit of ${limit} keys for pattern ${pattern}`);
          break;
        }
      } while (cursor !== '0'); // Cursor of '0' means we've completed the scan
      
      return keys.slice(0, limit);
    } catch (error) {
      logger.error(`Redis SCAN error for pattern ${pattern}: ${error.message}`);
      
      // Fallback to KEYS if SCAN fails (only for small datasets)
      try {
        logger.warn(`Falling back to KEYS command for pattern ${pattern}`);
        return await this.keys(pattern);
      } catch (fallbackError) {
        logger.error(`Redis fallback KEYS error: ${fallbackError.message}`);
        return [];
      }
    }
  }
  
  /**
   * Find keys matching a pattern - DEPRECATED, use scan() instead
   * This can cause performance issues on large databases
   */
  async keys(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return [];
    }
    
    try {
      return await this._command('KEYS', pattern);
    } catch (error) {
      logger.error(`Redis KEYS error for pattern ${pattern}: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Set multiple key-value pairs
   */
  async mset(pairs) {
    if (!pairs || typeof pairs !== 'object') {
      return false;
    }
    
    const args = [];
    
    // Convert object to flattened array of key-value pairs
    for (const [key, value] of Object.entries(pairs)) {
      if (key && typeof key === 'string') {
        args.push(key);
        
        if (typeof value === 'object') {
          args.push(JSON.stringify(value));
        } else {
          args.push(String(value));
        }
      }
    }
    
    if (args.length === 0) {
      return false;
    }
    
    try {
      const result = await this._command('MSET', ...args);
      return result === 'OK';
    } catch (error) {
      // Simplified error logging
      return false;
    }
  }
  
  /**
   * Add members to a sorted set
   */
  async zadd(key, ...args) {
    if (!key || typeof key !== 'string') {
      return 0;
    }
    
    try {
      const result = await this._command('ZADD', key, ...args);
      return parseInt(result) || 0;
    } catch (error) {
      logger.error(`Redis ZADD error: ${error.message}`);
      return 0;
    }
  }
  
  /**
   * Increment a key by a value
   */
  async incr(key, value = 1) {
    if (!key || typeof key !== 'string') {
      return null;
    }
    
    try {
      if (value === 1) {
        return await this._command('INCR', key);
      } else {
        return await this._command('INCRBY', key, value);
      }
    } catch (error) {
      // Simplified error logging
      return null;
    }
  }
  
  /**
   * Set a key only if it does not exist (SETNX operation)
   * @param {string} key - The key to set
   * @param {string|object} value - The value to set
   * @param {number|null} expiry - Optional expiry time in seconds
   * @returns {Promise<boolean>} - True if the key was set, false otherwise
   */
  async setnx(key, value, expiry = null) {
    // Check for invalid keys
    if (!key || typeof key !== 'string') {
      return false;
    }
    
    try {
      // Format value for storage
      const formattedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      
      // Use SET with NX option for SETNX behavior
      const args = [key, formattedValue, 'NX'];
      
      // Add expiry if provided
      if (expiry !== null) {
        args.push('EX', expiry);
      }
      
      const result = await this._command('SET', ...args);
      // SET with NX returns null if the key already exists
      return result === 'OK';
    } catch (error) {
      logger.error(`Redis SETNX error for key ${key}: ${error.message}`);
      return false;
    }
  }
}

/**
 * Get Redis client from environment variables
 * 
 * @param {Object} env - Environment variables
 * @param {Object} options - Additional options
 * @returns {Object|null} - Redis client or null on failure
 */
async function getRedisClient(env, options = {}) {
  try {
    // Prefer explicit env passed from caller, fallback to process.env
    const redisUrl = (env && (env.REDIS_URL || env.redis_url)) || process.env.REDIS_URL;
    if (!redisUrl) {
      logger.error('REDIS_URL not found in environment');
      return null;
    }

    // Ensure process.env has REDIS_URL for RedisClient which reads from process.env
    if (!process.env.REDIS_URL) {
      process.env.REDIS_URL = redisUrl;
    }

    logger.info('Initializing Redis client (Valkey/DO) using REDIS_URL');
    const client = new RedisClient({ debug: options.debug === true });

    // Test connection
    const ok = await client.ping();
    if (!ok) {
      logger.error('Redis ping failed');
      return null;
    }

    logger.info('Redis connection successful');
    return client;
  } catch (error) {
    logger.error('Failed to initialize Redis client:', error.message);
    return null;
  }
}

export default {
  getRedisClient,
  SimpleRedisClient
};

export { getRedisClient, SimpleRedisClient };
