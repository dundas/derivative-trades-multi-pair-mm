/**
 * Enhanced OrderBookManager with MemoryManager integration
 * 
 * Handles parsing, processing and managing orderbook data with
 * efficient memory usage through the MemoryManager service.
 */

import MemoryManager from './memory-manager.js';

class OrderBookManager {
  /**
   * Create a new OrderBookManager
   * @param {Object} config - Configuration options
   */
  constructor(config) {
    this.symbol = config.symbol;
    this.logger = config.logger || console;
    
    // Initialize with default configuration if not provided
    this.orderBookBufferMaxSize = config.orderBookBufferMaxSize || 10000;
    this.orderBookBufferMaxAge = config.orderBookBufferMaxAge || 900000; // 15 minutes
    this.orderBookRefreshInterval = config.orderBookRefreshInterval || 1000;
    this.lastOrderBookRefresh = 0;
    this.minRefreshInterval = config.minRefreshInterval || 200;
    this.maxRefreshInterval = config.maxRefreshInterval || 2000;
    this.forceTrade = config.forceTrade || false;
    
    // Sequence tracking
    this.lastSequenceNumber = 0;
    this.lastBidUpdateTime = 0;
    this.lastAskUpdateTime = 0;
    this.staleDataThreshold = config.staleDataThreshold || 5000;
    this.lastBestBid = 0;
    this.lastBestAsk = 0;
    this.updateCounter = 0;
    
    // Initialize or use provided memory manager
    this.memoryManager = config.memoryManager || new MemoryManager({
      symbol: this.symbol,
      logger: this.logger,
      orderbookMaxSize: this.orderBookBufferMaxSize,
      orderbookTTL: this.orderBookBufferMaxAge
    });
    
    // Keep the latest snapshot for quick access
    this.orderBookSnapshot = null;
    
    // Statistics for monitoring
    this.stats = {
      processedUpdates: 0,
      skippedUpdates: 0,
      partialUpdates: 0,
      fullUpdates: 0
    };
    
    this.logger.debug(`OrderBookManager initialized for ${this.symbol}`, {
      bufferMaxSize: this.orderBookBufferMaxSize,
      bufferMaxAge: this.orderBookBufferMaxAge
    });
  }
  
  /**
   * Process incoming order book data
   * 
   * @param {Object} data - Order book data
   * @returns {Object} - Processed order book
   */
  processOrderBook(data) {
    try {
      // Validate incoming data
      if (!data) {
        this.logger.warn('Received invalid orderbook data');
        return this.orderBookSnapshot;
      }
      
      // Log incoming data structure
      const keys = Object.keys(data).join(',');
      const dataHasBids = data && data.bids && Array.isArray(data.bids) && data.bids.length > 0;
      const dataHasAsks = data && data.asks && Array.isArray(data.asks) && data.asks.length > 0;
      const bidCount = dataHasBids ? data.bids.length : 0;
      const askCount = dataHasAsks ? data.asks.length : 0;
      
      this.logger.debug(`Processing OrderBook: {"hasBids":${dataHasBids},"hasAsks":${dataHasAsks},"bidCount":${bidCount},"askCount":${askCount},"allKeys":"${keys}","timestamp":${Date.now()}}`);
      
      // Add timestamp if not provided
      if (!data.timestamp) {
        data.timestamp = Date.now();
      }
      
      // Extract sequence number if available (use timestamp as fallback)
      const sequenceNumber = data.sequenceNumber || data.seqNum || data.timestamp;
      
      // Check if this update is older than our last processed update
      if (sequenceNumber < this.lastSequenceNumber && this.lastSequenceNumber > 0) {
        this.logger.debug(`Skipping out-of-order update: seq ${sequenceNumber} < last ${this.lastSequenceNumber}`);
        this.stats.skippedUpdates++;
        return this.orderBookSnapshot;
      }
      
      // Update our sequence tracking
      this.lastSequenceNumber = sequenceNumber;
      
      // Determine if this is a partial update
      const isPartialUpdate = data.isPartialUpdate || 
                             (data.a !== undefined || data.b !== undefined) || 
                             (data.as !== undefined || data.bs !== undefined);
      
      // Handle different types of updates
      let processedBook;
      
      if (isPartialUpdate) {
        this.stats.partialUpdates++;
        processedBook = this.processPartialUpdate(data, sequenceNumber);
      } else {
        this.stats.fullUpdates++;
        processedBook = this.processFullUpdate(data, sequenceNumber);
      }
      
      if (!processedBook) {
        return this.orderBookSnapshot;
      }
      
      // Store in memory manager with TTL based on book quality
      // Important books (lots of levels) get longer TTL
      const bookQuality = Math.min(1, 
        (processedBook.bids.length + processedBook.asks.length) / 20
      );
      const ttl = this.orderBookBufferMaxAge * bookQuality;
      
      const key = `${this.symbol}-${sequenceNumber}`;
      this.memoryManager.addOrderbook(key, processedBook, { ttl });
      
      // Update our snapshot
      this.orderBookSnapshot = processedBook;
      
      // Update statistics
      this.stats.processedUpdates++;
      
      return processedBook;
    } catch (error) {
      this.logger.error(`Error processing orderbook: ${error.message}`, {
        stack: error.stack,
        dataKeys: data ? Object.keys(data) : 'no data'
      });
      
      return this.orderBookSnapshot;
    }
  }
  
  /**
   * Process a partial orderbook update
   * 
   * @param {Object} data - Partial orderbook data
   * @param {number} sequenceNumber - Sequence number
   * @returns {Object|null} - Updated orderbook or null
   */
  processPartialUpdate(data, sequenceNumber) {
    // Need an existing snapshot to apply partial updates
    if (!this.orderBookSnapshot) {
      this.logger.warn('Received partial update but no snapshot exists');
      return null;
    }
    
    // Create a deep copy of the current snapshot
    const updatedBook = JSON.parse(JSON.stringify(this.orderBookSnapshot));
    updatedBook.timestamp = data.timestamp;
    updatedBook.sequenceNumber = sequenceNumber;
    
    // Handle different formats of partial updates
    
    // Format 1: {a: [...], b: [...]} (Kraken style)
    if (data.a || data.b) {
      if (data.a && Array.isArray(data.a)) {
        this.updatePriceLevels(updatedBook.asks, data.a, 'ask');
      }
      
      if (data.b && Array.isArray(data.b)) {
        this.updatePriceLevels(updatedBook.bids, data.b, 'bid');
      }
    }
    
    // Format 2: {as: [...], bs: [...]} (Alternative style)
    if (data.as || data.bs) {
      if (data.as && Array.isArray(data.as)) {
        this.updatePriceLevels(updatedBook.asks, data.as, 'ask');
      }
      
      if (data.bs && Array.isArray(data.bs)) {
        this.updatePriceLevels(updatedBook.bids, data.bs, 'bid');
      }
    }
    
    // Sort the book after updates
    this.sortOrderBook(updatedBook);
    
    return updatedBook;
  }
  
  /**
   * Process a full orderbook update
   * 
   * @param {Object} data - Full orderbook data
   * @param {number} sequenceNumber - Sequence number
   * @returns {Object} - Processed orderbook
   */
  processFullUpdate(data, sequenceNumber) {
    // Create a new orderbook from the full data
    const processedBook = {
      bids: [],
      asks: [],
      timestamp: data.timestamp,
      sequenceNumber: sequenceNumber
    };
    
    // Process bids and asks
    if (data.bids && Array.isArray(data.bids)) {
      processedBook.bids = this.normalizePriceLevels(data.bids);
    }
    
    if (data.asks && Array.isArray(data.asks)) {
      processedBook.asks = this.normalizePriceLevels(data.asks);
    }
    
    // Sort the book
    this.sortOrderBook(processedBook);
    
    return processedBook;
  }
  
  /**
   * Update price levels in an orderbook side
   * 
   * @param {Array} bookSide - Array of price levels
   * @param {Array} updates - Array of updates
   * @param {string} side - 'bid' or 'ask'
   */
  updatePriceLevels(bookSide, updates, side) {
    // Process each update
    for (const update of updates) {
      // Skip invalid updates
      if (!Array.isArray(update) || update.length < 2) continue;
      
      const price = parseFloat(update[0]);
      const volume = parseFloat(update[1]);
      
      // Remove price level if volume is 0
      if (volume === 0) {
        const index = bookSide.findIndex(level => parseFloat(level[0]) === price);
        if (index !== -1) {
          bookSide.splice(index, 1);
        }
        continue;
      }
      
      // Update or add price level
      const index = bookSide.findIndex(level => parseFloat(level[0]) === price);
      if (index !== -1) {
        bookSide[index] = this.normalizeLevel(update);
      } else {
        bookSide.push(this.normalizeLevel(update));
      }
    }
  }
  
  /**
   * Normalize a set of price levels to a consistent format
   * 
   * @param {Array} levels - Array of price levels
   * @returns {Array} - Normalized price levels
   */
  normalizePriceLevels(levels) {
    return levels
      .map(level => this.normalizeLevel(level))
      .filter(level => level !== null);
  }
  
  /**
   * Normalize a single price level to a consistent format
   * 
   * @param {Array} level - Price level [price, volume, ...]
   * @returns {Array|null} - Normalized price level or null
   */
  normalizeLevel(level) {
    if (!Array.isArray(level) || level.length < 2) return null;
    
    const price = parseFloat(level[0]);
    const volume = parseFloat(level[1]);
    
    if (isNaN(price) || isNaN(volume)) return null;
    if (volume === 0) return null;
    
    // Return a standardized format [price, volume]
    return [price.toString(), volume.toString()];
  }
  
  /**
   * Sort an orderbook
   * 
   * @param {Object} book - Orderbook to sort
   */
  sortOrderBook(book) {
    // Sort bids descending (highest first)
    if (book.bids && Array.isArray(book.bids)) {
      book.bids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
    }
    
    // Sort asks ascending (lowest first)
    if (book.asks && Array.isArray(book.asks)) {
      book.asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    }
  }
  
  /**
   * Check if we have a valid orderbook
   * 
   * @returns {boolean} - True if valid book exists
   */
  hasValidOrderBook() {
    if (!this.orderBookSnapshot) return false;
    
    const hasBids = this.orderBookSnapshot.bids && 
                   Array.isArray(this.orderBookSnapshot.bids) && 
                   this.orderBookSnapshot.bids.length > 0;
    
    const hasAsks = this.orderBookSnapshot.asks && 
                   Array.isArray(this.orderBookSnapshot.asks) && 
                   this.orderBookSnapshot.asks.length > 0;
    
    return hasBids && hasAsks;
  }
  
  /**
   * Get the latest orderbook snapshot
   * 
   * @returns {Object|null} - Latest orderbook snapshot
   */
  getOrderBook() {
    return this.orderBookSnapshot;
  }
  
  /**
   * Get best bid and ask prices
   * 
   * @returns {Object} - Best bid and ask prices
   */
  getBestPrices() {
    if (!this.hasValidOrderBook()) {
      return { bid: 0, ask: 0, spread: 0, spreadPct: 0 };
    }
    
    const bestBid = parseFloat(this.orderBookSnapshot.bids[0][0]);
    const bestAsk = parseFloat(this.orderBookSnapshot.asks[0][0]);
    const spread = bestAsk - bestBid;
    const spreadPct = (spread / bestBid) * 100;
    
    return {
      bid: bestBid,
      ask: bestAsk,
      spread: spread,
      spreadPct: spreadPct
    };
  }
  
  /**
   * Get order book statistics
   * 
   * @returns {Object} - Statistics
   */
  getStats() {
    const memStats = this.memoryManager ? 
      this.memoryManager.getStats().orderbook : 
      { currentSize: 0, maxSize: 0 };
    
    return {
      ...this.stats,
      bufferSize: memStats.currentSize,
      bufferMaxSize: memStats.maxSize,
      hasValidBook: this.hasValidOrderBook(),
      lastSequence: this.lastSequenceNumber,
      lastUpdate: this.orderBookSnapshot ? this.orderBookSnapshot.timestamp : 0
    };
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    // Nothing to clean up in this implementation
  }
}

export default OrderBookManager;
