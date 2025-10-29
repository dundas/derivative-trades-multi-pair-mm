/**
 * Mock Redis Adapter
 * 
 * A simple in-memory implementation of Redis client methods for development
 * and testing when a real Redis instance is not available.
 */

class MockRedisAdapter {
  constructor() {
    this.data = new Map();
    this.sets = new Map();
    this.expirations = new Map();
    console.log('MockRedisAdapter initialized - all operations will be in-memory');
  }

  /**
   * Set a key-value pair
   * 
   * @param {string} key - Key to set
   * @param {string|Object} value - Value to set (objects will be stringified)
   * @param {string} [expireFlag] - Optional expiration flag (e.g., 'EX')
   * @param {number} [expireValue] - Optional expiration value
   * @returns {Promise<string>} - 'OK' if successful
   */
  async set(key, value, expireFlag, expireValue) {
    // Handle object values by stringifying them
    const valueToStore = typeof value === 'object' ? JSON.stringify(value) : value;
    
    // Store the value
    this.data.set(key, valueToStore);
    
    // Handle expiration if provided
    if (expireFlag === 'EX' && typeof expireValue === 'number') {
      const expirationTime = Date.now() + (expireValue * 1000);
      this.expirations.set(key, expirationTime);
      
      // Set up auto-expiration
      setTimeout(() => {
        if (this.expirations.get(key) === expirationTime) {
          this.data.delete(key);
          this.expirations.delete(key);
        }
      }, expireValue * 1000);
    }
    
    return 'OK';
  }

  /**
   * Get a value by key
   * 
   * @param {string} key - Key to retrieve
   * @returns {Promise<string|null>} - Value or null if not found
   */
  async get(key) {
    // Check if key exists and not expired
    if (this.expirations.has(key)) {
      const expirationTime = this.expirations.get(key);
      if (Date.now() > expirationTime) {
        // Key has expired, remove it
        this.data.delete(key);
        this.expirations.delete(key);
        return null;
      }
    }
    
    return this.data.get(key) || null;
  }

  /**
   * Delete a key
   * 
   * @param {string} key - Key to delete
   * @returns {Promise<number>} - 1 if deleted, 0 if not found
   */
  async del(key) {
    const existed = this.data.has(key);
    this.data.delete(key);
    this.expirations.delete(key);
    return existed ? 1 : 0;
  }

  /**
   * Add members to a set
   * 
   * @param {string} key - Set key
   * @param {...string} members - Members to add
   * @returns {Promise<number>} - Number of members added
   */
  async sAdd(key, ...members) {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    
    const set = this.sets.get(key);
    let added = 0;
    
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }
    
    return added;
  }

  /**
   * Get all members of a set
   * 
   * @param {string} key - Set key
   * @returns {Promise<string[]>} - Array of set members
   */
  async sMembers(key) {
    if (!this.sets.has(key)) {
      return [];
    }
    
    return Array.from(this.sets.get(key));
  }

  /**
   * Remove members from a set
   * 
   * @param {string} key - Set key
   * @param {...string} members - Members to remove
   * @returns {Promise<number>} - Number of members removed
   */
  async sRem(key, ...members) {
    if (!this.sets.has(key)) {
      return 0;
    }
    
    const set = this.sets.get(key);
    let removed = 0;
    
    for (const member of members) {
      if (set.has(member)) {
        set.delete(member);
        removed++;
      }
    }
    
    return removed;
  }

  /**
   * Check if a key exists
   * 
   * @param {string} key - Key to check
   * @returns {Promise<number>} - 1 if exists, 0 if not
   */
  async exists(key) {
    // Check for expiration
    if (this.expirations.has(key)) {
      const expirationTime = this.expirations.get(key);
      if (Date.now() > expirationTime) {
        // Key has expired, remove it
        this.data.delete(key);
        this.expirations.delete(key);
        return 0;
      }
    }
    
    return this.data.has(key) || this.sets.has(key) ? 1 : 0;
  }

  /**
   * Increment a key by 1 or a specified amount
   * 
   * @param {string} key - Key to increment
   * @returns {Promise<number>} - New value
   */
  async incr(key) {
    let value = parseInt(this.data.get(key) || '0', 10);
    value += 1;
    this.data.set(key, value.toString());
    return value;
  }

  /**
   * Increment a key by a specified amount
   * 
   * @param {string} key - Key to increment
   * @param {number} increment - Amount to increment by
   * @returns {Promise<number>} - New value
   */
  async incrBy(key, increment) {
    let value = parseInt(this.data.get(key) || '0', 10);
    value += increment;
    this.data.set(key, value.toString());
    return value;
  }

  /**
   * Set a key only if it doesn't exist
   * 
   * @param {string} key - Key to set
   * @param {string|Object} value - Value to set
   * @returns {Promise<number>} - 1 if set, 0 if already exists
   */
  async setnx(key, value) {
    if (this.data.has(key)) {
      return 0;
    }
    
    const valueToStore = typeof value === 'object' ? JSON.stringify(value) : value;
    this.data.set(key, valueToStore);
    return 1;
  }

  /**
   * Clear all data (for testing)
   */
  async flushAll() {
    this.data.clear();
    this.sets.clear();
    this.expirations.clear();
    return 'OK';
  }
}

export default MockRedisAdapter;
