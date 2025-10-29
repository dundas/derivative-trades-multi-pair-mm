/**
 * CircularBuffer - Efficient fixed-size buffer for time series data
 * 
 * Used for maintaining price history and other time-series data
 * with automatic old data eviction.
 */
export class CircularBuffer {
  constructor(size) {
    if (size <= 0) {
      throw new Error('Buffer size must be positive');
    }
    
    this.size = size;
    this.buffer = [];
    this.head = 0;
  }
  
  /**
   * Add an item to the buffer
   * @param {*} item - Item to add
   */
  push(item) {
    if (this.buffer.length < this.size) {
      this.buffer.push(item);
    } else {
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % this.size;
    }
  }
  
  /**
   * Get all items in chronological order
   * @returns {Array} Array of items from oldest to newest
   */
  toArray() {
    if (this.buffer.length < this.size) {
      return [...this.buffer];
    }
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }
  
  /**
   * Filter items based on predicate
   * @param {Function} predicate - Filter function
   * @returns {Array} Filtered array
   */
  filter(predicate) {
    return this.toArray().filter(predicate);
  }
  
  /**
   * Get the most recent item
   * @returns {*} Most recent item or undefined
   */
  getLast() {
    if (this.buffer.length === 0) return undefined;
    
    if (this.buffer.length < this.size) {
      return this.buffer[this.buffer.length - 1];
    }
    
    const lastIndex = (this.head - 1 + this.size) % this.size;
    return this.buffer[lastIndex];
  }
  
  /**
   * Get the oldest item
   * @returns {*} Oldest item or undefined
   */
  getFirst() {
    if (this.buffer.length === 0) return undefined;
    
    if (this.buffer.length < this.size) {
      return this.buffer[0];
    }
    
    return this.buffer[this.head];
  }
  
  /**
   * Clear the buffer
   */
  clear() {
    this.buffer = [];
    this.head = 0;
  }
  
  /**
   * Check if buffer is empty
   * @returns {boolean}
   */
  isEmpty() {
    return this.buffer.length === 0;
  }
  
  /**
   * Check if buffer is full
   * @returns {boolean}
   */
  isFull() {
    return this.buffer.length === this.size;
  }
  
  /**
   * Get current number of items
   * @returns {number}
   */
  get length() {
    return this.buffer.length;
  }
}

export default CircularBuffer;