/**
 * PriceProvider - Enhanced utility for reliable price data in the AdaptiveMarketMaker
 * 
 * This utility handles:
 * - Buffering recent orderbook data for more stable price calculations
 * - Calculating mid-prices and spreads from orderbook data
 * - Providing fallbacks when ticker data is not available
 * - Detecting market anomalies like crossed orderbooks
 */

import { EventEmitter } from 'events';

export class PriceProvider extends EventEmitter {
  /**
   * Create a new PriceProvider
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {string} options.symbol - Trading symbol (e.g., 'BTC/USD')
   * @param {number} options.bufferSize - Maximum number of orderbook entries to keep in buffer
   * @param {number} options.bufferTimeWindow - Time window in ms for relevant orderbook entries
   * @param {Object} options.memoryManager - Optional memory manager for orderbook storage
   */
  constructor(options = {}) {
    super();
    
    this.logger = options.logger || console;
    if (this.logger && typeof this.logger.error === 'function') {
      this.logger.error('PRICE_PROVIDER_CONSTRUCTOR_DEBUG_LOG: PriceProvider created. My logger level: ' + (this.logger.options ? this.logger.options.level : 'N/A') + ', My stream exists: ' + !!this.logger.fileStream);
    }

    this.symbol = options.symbol || 'BTC/USD';
    this.bufferSize = options.bufferSize || 100;
    this.bufferTimeWindow = options.bufferTimeWindow || 250; // 250ms default
    this.memoryManager = options.memoryManager;
    
    // Create orderbook buffer
    this.orderBookBuffer = [];
    
    // Last known valid prices
    this.lastValidMidPrice = null;
    this.lastValidBestBid = null;
    this.lastValidBestAsk = null;
    this.lastValidSpread = null;
    this.lastValidOrderBook = null;
    
    this.logger.info('PriceProvider initialized', {
      symbol: this.symbol,
      bufferSize: this.bufferSize,
      bufferTimeWindow: this.bufferTimeWindow,
      hasMemoryManager: !!this.memoryManager
    });
  }
  
  /**
   * Add an orderbook to the buffer
   * @param {Object} orderBook - Orderbook data
   * @param {number} timestamp - Optional timestamp (defaults to now)
   * @returns {boolean} Whether the orderbook was successfully added
   */
  addOrderBook(orderBook, timestamp = Date.now()) {
    if (!orderBook || !orderBook.bids || !orderBook.asks) {
      this.logger.debug('Invalid orderbook data provided to PriceProvider');
      return false;
    }
    
    // Normalize and validate the orderbook
    try {
      const normalizedOrderBook = {
        timestamp,
        bids: orderBook.bids,
        asks: orderBook.asks,
        symbol: orderBook.symbol || this.symbol
      };
      
      // Add to buffer
      this.orderBookBuffer.unshift(normalizedOrderBook);
      
      // Trim buffer to max size
      if (this.orderBookBuffer.length > this.bufferSize) {
        this.orderBookBuffer = this.orderBookBuffer.slice(0, this.bufferSize);
      }
      
      // Store in memory manager if available
      if (this.memoryManager) {
        const key = `orderbook:${this.symbol}:${timestamp}`;
        this.memoryManager.addOrderbook(key, normalizedOrderBook);
      }
      
      // Extract and update last valid prices
      this._updateLastValidPrices(normalizedOrderBook);
      
      return true;
    } catch (error) {
      this.logger.error('Error adding orderbook to buffer', { error: error.message });
      return false;
    }
  }
  
  /**
   * Update last valid prices from an orderbook
   * @private
   */
  _updateLastValidPrices(orderBook) {
    if (!orderBook || !orderBook.bids || !orderBook.asks) return;
    
    try {
      // Extract best bid and ask
      // Handle both array format [[price, amount], ...] and object format [{price, amount}, ...]
      let bestBid = null;
      let bestAsk = null;
      
      if (orderBook.bids.length > 0) {
        if (Array.isArray(orderBook.bids[0])) {
          // Handle [[price, amount], ...] format
          bestBid = parseFloat(orderBook.bids[0][0]);
        } else if (typeof orderBook.bids[0] === 'object' && orderBook.bids[0].price !== undefined) {
          // Handle [{price, amount}, ...] format
          bestBid = parseFloat(orderBook.bids[0].price);
        }
      }
      if (!bestBid || !(bestBid > 0)) {
        this.logger.debug('[PriceProvider._updateLastValidPrices] Best bid is invalid or not positive.', { bestBid, bidsData: orderBook.bids.slice(0,2) });
      }
      
      if (orderBook.asks.length > 0) {
        if (Array.isArray(orderBook.asks[0])) {
          // Handle [[price, amount], ...] format
          bestAsk = parseFloat(orderBook.asks[0][0]);
        } else if (typeof orderBook.asks[0] === 'object' && orderBook.asks[0].price !== undefined) {
          // Handle [{price, amount}, ...] format
          bestAsk = parseFloat(orderBook.asks[0].price);
        }
      }
      if (!bestAsk || !(bestAsk > 0)) {
        this.logger.debug('[PriceProvider._updateLastValidPrices] Best ask is invalid or not positive.', { bestAsk, asksData: orderBook.asks.slice(0,2) });
      }
      
      this.logger.debug('Extracted prices from orderbook:', {
        bestBid,
        bestAsk,
        bidsFormat: orderBook.bids.length > 0 ? (Array.isArray(orderBook.bids[0]) ? 'array' : 'object') : 'empty',
        asksFormat: orderBook.asks.length > 0 ? (Array.isArray(orderBook.asks[0]) ? 'array' : 'object') : 'empty'
      });
      
      // Only update if both bid and ask are valid
      if (bestBid && bestAsk && bestBid > 0 && bestAsk > 0) {
        // Detect crossed orderbook
        if (bestBid >= bestAsk) {
          this.logger.warn('Crossed orderbook detected', {
            bestBid,
            bestAsk,
            spread: bestAsk - bestBid
          });
          // Don't update last valid prices with crossed orderbook
          return;
        }
        
        // Update last valid prices
        this.lastValidBestBid = bestBid;
        this.lastValidBestAsk = bestAsk;
        this.lastValidMidPrice = (bestBid + bestAsk) / 2;
        this.lastValidSpread = bestAsk - bestBid;
        this.lastValidOrderBook = orderBook;
        
        this.logger.debug('Updated valid prices', {
          bestBid: this.lastValidBestBid,
          bestAsk: this.lastValidBestAsk,
          midPrice: this.lastValidMidPrice,
          spread: this.lastValidSpread
        });
      } else {
        this.logger.debug('[PriceProvider._updateLastValidPrices] Not updating last valid prices due to invalid bestBid/bestAsk or them not being positive.', { bestBid, bestAsk });
      }
    } catch (error) {
      this.logger.error('Error updating last valid prices', { error: error.message });
    }
  }
  
  /**
   * Get the current price information with fallbacks
   * @param {Object} options - Options for price calculation
   * @param {Object} options.ticker - Current ticker data (optional)
   * @param {Object} options.orderBook - Current orderbook data (optional)
   * @param {boolean} options.useBuffer - Whether to use the orderbook buffer for price calculation
   * @returns {Object} Current price information
   */
  getCurrentPriceInfo(options = {}) {
    const {
      ticker,
      orderBook,
      useBuffer = true
    } = options;
    
    // Add current orderbook to the buffer if provided
    if (orderBook) {
      this.addOrderBook(orderBook);
    }
    
    let result = {
      price: null,
      bid: null,
      ask: null,
      spread: null,
      spreadPercentage: null,
      source: null
    };
    
    // Log the incoming data to help diagnose issues
    this.logger.debug('getCurrentPriceInfo called with options:', {
      hasTicker: !!ticker,
      hasOrderBook: !!orderBook,
      useBuffer: useBuffer,
      bufferSize: this.orderBookBuffer.length,
      lastValidMidPrice: this.lastValidMidPrice
    });
    
    // Try to get price from ticker first
    if (ticker && ticker.last) {
      result.price = parseFloat(ticker.last);
      result.source = 'ticker';
      
      // If ticker also has bid/ask, use them
      if (ticker.bid && ticker.ask) {
        result.bid = parseFloat(ticker.bid);
        result.ask = parseFloat(ticker.ask);
        result.spread = result.ask - result.bid;
        result.spreadPercentage = result.spread / result.bid;
      }
    }
    
    // If we don't have complete price information, try to get from buffer
    if (!result.price || !result.bid || !result.ask || !result.spread) {
      if (useBuffer && this.orderBookBuffer.length > 0) {
        // Calculate using the orderbook buffer
        const bufferResult = this.calculatePriceFromBuffer();
        
        // Use buffer results to fill in missing data
        if (!result.price && bufferResult.midPrice) {
          result.price = bufferResult.midPrice;
          result.source = result.source ? `${result.source}+buffer` : 'buffer';
        }
        
        if (!result.bid && bufferResult.bestBid) {
          result.bid = bufferResult.bestBid;
        }
        
        if (!result.ask && bufferResult.bestAsk) {
          result.ask = bufferResult.bestAsk;
        }
        
        if (!result.spread && bufferResult.spread) {
          result.spread = bufferResult.spread;
          result.spreadPercentage = bufferResult.spreadPercentage;
        }
      }
    }
    
    // Final fallback to last valid prices
    if (!result.price && this.lastValidMidPrice) {
      result.price = this.lastValidMidPrice;
      result.source = result.source ? `${result.source}+lastValid` : 'lastValid';
    }
    
    if (!result.bid && this.lastValidBestBid) {
      result.bid = this.lastValidBestBid;
    }
    
    if (!result.ask && this.lastValidBestAsk) {
      result.ask = this.lastValidBestAsk;
    }
    
    if (!result.spread && this.lastValidSpread) {
      result.spread = this.lastValidSpread;
      result.spreadPercentage = this.lastValidSpread / this.lastValidBestBid;
    }
    
    // Calculate mid price from bid/ask if we have those but no price
    if (!result.price && result.bid && result.ask) {
      result.price = (result.bid + result.ask) / 2;
      result.source = result.source ? `${result.source}+calculated` : 'calculated';
    }
    
    // Log the result
    this.logger.debug('getCurrentPriceInfo result:', {
      price: result.price,
      source: result.source,
      hasPrice: !!result.price,
      hasBid: !!result.bid,
      hasAsk: !!result.ask
    });
    
    return result;
  }
  
  /**
   * Calculate average price from the orderbook buffer
   * Uses time-weighted average of recent orderbook entries
   * @returns {Object} Calculated price information
   */
  calculatePriceFromBuffer() {
    const result = {
      midPrice: null,
      bestBid: null,
      bestAsk: null,
      spread: null,
      spreadPercentage: null
    };
    
    try {
      // Filter entries from the most recent time window
      const now = Date.now();
      const recentTimeWindow = now - this.bufferTimeWindow;

      // Log buffer information before filtering
      this.logger.debug('[PriceProvider.calculatePriceFromBuffer] Initial buffer check', {
        totalBufferLength: this.orderBookBuffer.length,
        bufferTimeWindowMs: this.bufferTimeWindow,
        currentTime: now,
        filterTimestampThreshold: recentTimeWindow
      });
      if (this.orderBookBuffer.length > 0) {
         this.logger.debug('[PriceProvider.calculatePriceFromBuffer] First entry in buffer timestamp:', { timestamp: this.orderBookBuffer[0].timestamp });
         this.logger.debug('[PriceProvider.calculatePriceFromBuffer] Last entry in buffer timestamp:', { timestamp: this.orderBookBuffer[this.orderBookBuffer.length - 1].timestamp });
      }


      const recentEntries = this.orderBookBuffer.filter(entry => {
        return entry.timestamp && entry.timestamp > recentTimeWindow;
      });

      // Log details about recent entries
      this.logger.debug('[PriceProvider.calculatePriceFromBuffer] Filtered recent entries', {
        recentEntriesCount: recentEntries.length,
        // Log the first 3 recent entries, or fewer if not that many
        recentEntriesSample: recentEntries.slice(0, Math.min(3, recentEntries.length)).map(e => ({
          ts: e.timestamp,
          b0_price: e.bids?.[0]?.[0], // Get price from [price, volume]
          b0_volume: e.bids?.[0]?.[1],
          a0_price: e.asks?.[0]?.[0], // Get price from [price, volume]
          a0_volume: e.asks?.[0]?.[1]
        }))
      });
      
      if (recentEntries.length === 0) {
        return result;
      }
      
      // Calculate average bid and ask
      let sumBids = 0;
      let sumAsks = 0;
      let validEntries = 0;
      
      recentEntries.forEach(entry => {
        if (entry.bids && entry.bids.length > 0 && entry.asks && entry.asks.length > 0) {
          let bestBid, bestAsk;
          
          // Handle array format: [[price, amount], ...]
          if (Array.isArray(entry.bids[0])) {
            bestBid = parseFloat(entry.bids[0][0]);
            bestAsk = parseFloat(entry.asks[0][0]);
          } 
          // Handle object format: [{price, amount}, ...]
          else if (typeof entry.bids[0] === 'object' && entry.bids[0].price !== undefined) {
            bestBid = parseFloat(entry.bids[0].price);
            bestAsk = parseFloat(entry.asks[0].price);
          }
          else {
            return; // Skip entries with unrecognized format
          }
          
          // Skip crossed orderbooks or invalid prices
          if (!bestBid || !bestAsk || bestBid >= bestAsk) {
            this.logger.debug('Skipping invalid price entry in buffer calculation', {
              bestBid, bestAsk, crossed: bestBid >= bestAsk
            });
            return;
          }
          
          sumBids += bestBid;
          sumAsks += bestAsk;
          validEntries++;
        }
      });
      
      if (validEntries > 0) {
        result.bestBid = sumBids / validEntries;
        result.bestAsk = sumAsks / validEntries;
        result.midPrice = (result.bestBid + result.bestAsk) / 2;
        result.spread = result.bestAsk - result.bestBid;
        result.spreadPercentage = result.spread / result.bestBid;
        
        this.logger.debug('Calculated price from buffer', {
          midPrice: result.midPrice,
          bestBid: result.bestBid,
          bestAsk: result.bestAsk,
          spread: result.spread,
          validEntries
        });
      }
    } catch (error) {
      this.logger.error('Error calculating price from buffer', { error: error.message });
    }
    
    return result;
  }
  
  /**
   * Get best bid and ask prices with fallbacks
   * @param {Object} options - Options for bid/ask retrieval 
   * @returns {Object} Best bid and ask prices
   */
  getBestBidAsk(options = {}) {
    const priceInfo = this.getCurrentPriceInfo(options);
    return {
      bestBid: priceInfo.bid,
      bestAsk: priceInfo.ask
    };
  }
  
  /**
   * Get current mid price with fallbacks
   * @param {Object} options - Options for price retrieval
   * @returns {number} Current mid price
   */
  getMidPrice(options = {}) {
    const priceInfo = this.getCurrentPriceInfo(options);
    return priceInfo.price;
  }
  
  /**
   * Get the last valid order book object that was processed.
   * @returns {Object | null} The last valid order book, or null if none processed yet.
   */
  getLastValidOrderBook() {
    return this.lastValidOrderBook;
  }
}

export default PriceProvider;
