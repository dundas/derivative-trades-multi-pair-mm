import WebSocket from 'ws';
import { EventEmitter } from 'events';

const DEFAULT_KRAKEN_PUBLIC_WS_URL = 'wss://ws.kraken.com/v2';

/**
 * KrakenDataStreamAdapter - Handles WebSocket connections to Kraken for market data
 * 
 * This adapter connects to Kraken's public WebSocket API and streams market data.
 * It emits events that can be consumed by any exchange adapter, including PaperExchangeAdapter.
 */
export class KrakenDataStreamAdapter extends EventEmitter {
  /**
   * Create a new KrakenDataStreamAdapter
   * @param {Object} config Configuration options
   * @param {string} config.symbol Trading pair symbol (e.g., 'BTC/USD')
   * @param {Object} config.logger Logger instance
   * @param {string} [config.wsPublicUrl] WebSocket public URL (default: 'wss://ws.kraken.com/v2')
   * @param {number} [config.reconnectDelayMs] Reconnect delay in milliseconds (default: 5000)
   * @param {number} [config.orderBookDepth] Order book depth (default: 10)
   */
  constructor(config) {
    super();
    
    this.symbol = config.symbol;
    this.logger = config.logger;
    this.wsPublicUrl = config.wsPublicUrl || DEFAULT_KRAKEN_PUBLIC_WS_URL;
    this.reconnectDelayMs = config.reconnectDelayMs || 5000;
    this.orderBookDepth = config.orderBookDepth || 10;
    
    this.logger.info(`KrakenDataStreamAdapter initialized with symbol ${this.symbol}`);
    
    // WebSocket connection state
    this.publicWs = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.subscriptions = new Set();
    
    // Data storage
    this.orderBook = {
      bids: [],
      asks: [],
      lastUpdated: 0
    };
    this.lastTrades = [];
    this.ticker = null;
    
    // Bind event handlers
    this._onPublicOpen = this._onPublicOpen.bind(this);
    this._onPublicMessage = this._onPublicMessage.bind(this);
    this._onPublicError = this._onPublicError.bind(this);
    this._onPublicClose = this._onPublicClose.bind(this);
  }
  
  /**
   * Connect to Kraken WebSocket API
   * @returns {Promise<boolean>} True if connection successful
   */
  async connect() {
    this.logger.info(`Connecting to Kraken public WebSocket at ${this.wsPublicUrl}...`);
    
    // Create connection promise to await connection
    this.connectionPromise = new Promise((resolve, reject) => {
      this._connectPromiseResolve = resolve;
      this._connectPromiseReject = reject;
      
      // Set a timeout for connection
      this.connectionTimeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 15000); // 15 second timeout
    });
    
    try {
      // Check if we already have an active connection
      if (this.publicWs && this.publicWs.readyState === WebSocket.OPEN) {
        this.logger.info('WebSocket connection already established');
        return true;
      }

      // Close existing connection if any
      if (this.publicWs) {
        this.logger.info('Closing existing WebSocket connection before creating a new one');
        this.publicWs.removeAllListeners();
        if (this.publicWs.readyState === WebSocket.OPEN) {
          this.publicWs.close();
        }
        this.publicWs = null;
      }
      
      // Establish WebSocket connection
      this.logger.info(`Creating new WebSocket connection to ${this.wsPublicUrl}`);
      this.publicWs = new WebSocket(this.wsPublicUrl);
      
      // Set up event handlers
      this.publicWs.on('open', this._onPublicOpen);
      this.publicWs.on('message', this._onPublicMessage);
      this.publicWs.on('error', this._onPublicError);
      this.publicWs.on('close', this._onPublicClose);
      
      // Wait for connection to be established
      await this.connectionPromise;
      this.logger.info('Kraken public WebSocket connection established');
      
      // Subscribe to channels
      await this._subscribeToChannels();
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to connect to Kraken WebSocket: ${error.message}`, { stack: error.stack });
      // Force reconnect
      this._reconnect();
      throw error;
    } finally {
      // Clear connection timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
    }
  }
  
  /**
   * Subscribe to WebSocket channels
   * @private
   */
  async _subscribeToChannels() {
    try {
      this.logger.info('Subscribing to Kraken WebSocket channels...');

      // Subscribe to order book
      await this._subscribe('book', { depth: this.orderBookDepth });
      
      // Subscribe to ticker
      await this._subscribe('ticker');
      
      // Subscribe to trades
      await this._subscribe('trade');
      
      this.logger.info(`Successfully subscribed to Kraken channels for ${this.symbol}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to subscribe to channels: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Subscribe to a specific channel
   * @param {string} channel Channel name
   * @param {Object} [params] Additional parameters
   * @private
   */
  async _subscribe(channel, params = {}) {
    if (!this.publicWs || this.publicWs.readyState !== WebSocket.OPEN) {
      throw new Error(`WebSocket is not connected. Current state: ${this.publicWs ? this.publicWs.readyState : 'null'}`);
    }
    
    const subscriptionKey = `${channel}-${this.symbol}`;
    if (this.subscriptions.has(subscriptionKey)) {
      this.logger.debug(`Already subscribed to ${channel} for ${this.symbol}`);
      return;
    }
    
    const subscribeMsg = {
      method: 'subscribe',
      params: {
        channel: channel,
        ...params,
        symbol: [this.symbol]
      }
    };
    
    this.logger.info(`Subscribing to ${channel} for ${this.symbol} with params:`, subscribeMsg);
    this.publicWs.send(JSON.stringify(subscribeMsg));
    this.subscriptions.add(subscriptionKey);
  }
  
  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    this.logger.info('Disconnecting from Kraken WebSocket...');
    
    // Clear any pending reconnect attempts
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Close WebSocket connection
    if (this.publicWs) {
      // Remove event listeners
      this.publicWs.removeListener('open', this._onPublicOpen);
      this.publicWs.removeListener('message', this._onPublicMessage);
      this.publicWs.removeListener('error', this._onPublicError);
      this.publicWs.removeListener('close', this._onPublicClose);
      
      // Close connection
      if (this.publicWs.readyState === WebSocket.OPEN) {
        this.publicWs.close();
      }
      this.publicWs = null;
    }
    
    this.isConnected = false;
    this.subscriptions.clear();
    this.logger.info('Disconnected from Kraken WebSocket');
  }
  
  /**
   * Reconnect to WebSocket
   * @private
   */
  _reconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(30000, this.reconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1));
    
    this.logger.info(`Reconnecting to Kraken WebSocket in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    
    this.reconnectTimer = setTimeout(async () => {
      try {
        // Close existing connection if any
        if (this.publicWs) {
          this.publicWs.removeAllListeners();
          if (this.publicWs.readyState === WebSocket.OPEN) {
            this.publicWs.close();
          }
          this.publicWs = null;
        }
        
        // Clear subscriptions
        this.subscriptions.clear();
        
        // Reconnect
        await this.connect();
        
        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
      } catch (error) {
        this.logger.error(`Reconnection attempt failed: ${error.message}`);
        this._reconnect(); // Try again
      }
    }, delay);
  }
  
  /**
   * Handle WebSocket open event
   * @private
   */
  _onPublicOpen() {
    this.logger.info('Kraken public WebSocket connection opened');
    this.isConnected = true;
    
    // Resolve connection promise
    if (this._connectPromiseResolve) {
      this._connectPromiseResolve(true);
      this._connectPromiseResolve = null;
      this._connectPromiseReject = null;
    }
    
    // Emit connected event
    this.emit('connected');
  }
  
  /**
   * Handle WebSocket message event
   * @param {string} data Message data
   * @private
   */
  _onPublicMessage(data) {
    try {
      const message = JSON.parse(data);
      
      this.logger.debug(`Received WebSocket message: ${JSON.stringify(message).substring(0, 200)}...`);

      // Handle subscription status messages
      if (message.method === 'subscribe' || message.method === 'unsubscribe') {
        this.logger.info(`Received ${message.method} response:`, message);
        if (message.success === false) {
          this.logger.error(`Subscription/Unsubscription failed: ${message.error}`, message);
          // Potentially attempt to resubscribe or handle error
        }
        return;
      }
      
      // Handle heartbeat
      if (message.channel === 'heartbeat') {
        this.logger.debug('Received heartbeat');
        // Optional: Respond with a pong message if needed
        return;
      }
      
      // Handle channel data
      if (message.channel && message.data) {
        // Log the entire message object to inspect its structure for the symbol
        this.logger.debug('RAW CHANNEL DATA MESSAGE:', JSON.stringify(message).substring(0, 500)); 

        const { channel, data } = message; 
        const firstDataElement = data[0];
        const symbolFromData = firstDataElement && firstDataElement.symbol ? firstDataElement.symbol : 'UNKNOWN';
        
        this.logger.debug(`Processing ${channel} data for ${symbolFromData}, data elements: ${data.length}`);

        // Process based on channel
        switch (channel) {
          case 'book':
            this.logger.debug(`Processing orderbook update for ${symbolFromData}`);
            this._processOrderBook(firstDataElement, message.type); // Pass firstDataElement AND message.type
            break;
          case 'trade':
            this.logger.debug(`Processing trade update for ${symbolFromData}`);
            this._processTrade(firstDataElement);
            break;
          case 'ticker':
            this.logger.debug(`Processing ticker update for ${symbolFromData}`);
            this._processTicker(firstDataElement);
            break;
          default:
            this.logger.warn(`Unknown channel type: ${channel}`);
            break;
        }
      } else if (message.type === 'error') {
        this.logger.error(`WebSocket error: ${message.data || message.error || 'Unknown error'}`, message);
      } else {
        this.logger.debug(`Unhandled message type: ${JSON.stringify(message).substring(0, 200)}`);
      }
    } catch (error) {
      this.logger.error(`Error processing WebSocket message: ${error.message}`, { error, data });
    }
  }
  
  /**
   * Handle WebSocket error event
   * @param {Error} error Error object
   * @private
   */
  _onPublicError(error) {
    this.logger.error(`Kraken public WebSocket error: ${error.message}`, { stack: error.stack });
    
    // Reject connection promise if it exists
    if (this._connectPromiseReject) {
      this._connectPromiseReject(error);
      this._connectPromiseResolve = null;
      this._connectPromiseReject = null;
    }
    
    // Emit error event
    this.emit('error', error);
  }
  
  /**
   * Handle WebSocket close event
   * @param {number} code Close code
   * @param {string} reason Close reason
   * @private
   */
  _onPublicClose(code, reason) {
    this.logger.info(`Kraken public WebSocket closed. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
    this.isConnected = false;
    
    // Reject connection promise if it exists
    if (this._connectPromiseReject) {
      this._connectPromiseReject(new Error(`WebSocket closed. Code: ${code}, Reason: ${reason || 'No reason provided'}`));
      this._connectPromiseResolve = null;
      this._connectPromiseReject = null;
    }
    
    // Emit disconnected event
    this.emit('disconnected', { code, reason });
    
    // Reconnect if not intentionally closed
    if (code !== 1000) {
      this._reconnect();
    }
  }
  
  /**
   * Process order book update
   * @param {Object} data Order book data (expects data[0] from the message)
   * @param {string} type The type of the message (e.g., 'snapshot', 'update')
   * @private
   */
  _processOrderBook(data, type) {
    if (!data) {
      this.logger.debug('Received empty orderbook data element');
      return;
    }

    this.logger.debug(`Processing orderbook ${type || 'unknown type'} for ${data.symbol || 'unknown symbol'}`, {
      dataKeys: Object.keys(data),
      hasBids: !!data.bids,
      bidCount: data.bids ? data.bids.length : 0,
      hasAsks: !!data.asks,
      askCount: data.asks ? data.asks.length : 0
    });

    if (!type) {
      this.logger.warn('Unknown order book data type: undefined');
    }

    try {
      const timestamp = new Date().getTime();

      // If this is a snapshot, reset the orderbook
      if (type === 'snapshot') {
        this.orderBook = {
          bids: [],
          asks: [],
          lastUpdated: timestamp
        };
      }

      // Process bids if present - store in array format [[price, amount], ...]
      if (data.bids && data.bids.length > 0) {
        data.bids.forEach(bid => {
          // --- BEGIN ADDED DEBUG LOGGING ---
          this.logger.debug(`[KDS_BID_DEBUG] Raw bid data: ${JSON.stringify(bid)}`);
          const rawQty = bid.qty;
          const rawIndex1 = bid[1];
          this.logger.debug(`[KDS_BID_DEBUG] bid.qty: ${rawQty} (type: ${typeof rawQty}), bid[1]: ${rawIndex1} (type: ${typeof rawIndex1})`);
          // --- END ADDED DEBUG LOGGING ---

          const price = parseFloat(bid.price || bid[0]);
          // Corrected logic for amount parsing
          const valueToParseForAmount = (typeof rawQty === 'number') ? rawQty : rawIndex1;
          const amount = parseFloat(valueToParseForAmount);

          // --- BEGIN ADDED DEBUG LOGGING ---
          this.logger.debug(`[KDS_BID_DEBUG] Value for parseFloat(amount): ${valueToParseForAmount} (type: ${typeof valueToParseForAmount}), Parsed price: ${price}, Parsed amount: ${amount}`);
          if (isNaN(amount)) {
            this.logger.warn(`[KDS_BID_DEBUG_NaN] NaN detected for amount. Raw bid: ${JSON.stringify(bid)}, bid.qty: ${rawQty} (type: ${typeof rawQty}), bid[1]: ${rawIndex1} (type: ${typeof rawIndex1}), eval_for_parseFloat: ${valueToParseForAmount}`);
          }
          // --- END ADDED DEBUG LOGGING ---
          
          // Skip entries with amount 0 (these are deletions)
          if (amount === 0) {
            // Find the price level to remove
            const indexToRemove = this.orderBook.bids.findIndex(entry => 
              Math.abs(parseFloat(entry[0]) - price) < 0.00001
            );
            if (indexToRemove !== -1) {
              this.orderBook.bids.splice(indexToRemove, 1);
            }
            return;
          }
          
          // Store as [price, amount] array
          const priceLevel = [price, amount];
          
          // Find if this price level already exists
          const existingIndex = this.orderBook.bids.findIndex(entry => 
            Math.abs(parseFloat(entry[0]) - price) < 0.00001
          );
          
          if (existingIndex !== -1) {
            // Update existing price level
            this.orderBook.bids[existingIndex] = priceLevel;
          } else {
            // Add new price level
            this.orderBook.bids.push(priceLevel);
            
            // Sort bids in descending order (highest price first)
            this.orderBook.bids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
            
            // Trim to maintain depth
            if (this.orderBook.bids.length > this.orderBookDepth) {
              this.orderBook.bids = this.orderBook.bids.slice(0, this.orderBookDepth);
            }
          }
        });
      }

      // Process asks if present - store in array format [[price, amount], ...]
      if (data.asks && data.asks.length > 0) {
        data.asks.forEach(ask => {
          // --- BEGIN ADDED DEBUG LOGGING ---
          this.logger.debug(`[KDS_ASK_DEBUG] Raw ask data: ${JSON.stringify(ask)}`);
          const rawQty = ask.qty;
          const rawIndex1 = ask[1];
          this.logger.debug(`[KDS_ASK_DEBUG] ask.qty: ${rawQty} (type: ${typeof rawQty}), ask[1]: ${rawIndex1} (type: ${typeof rawIndex1})`);
          // --- END ADDED DEBUG LOGGING ---

          const price = parseFloat(ask.price || ask[0]);
          // Corrected logic for amount parsing
          const valueToParseForAmount = (typeof rawQty === 'number') ? rawQty : rawIndex1;
          const amount = parseFloat(valueToParseForAmount);

          // --- BEGIN ADDED DEBUG LOGGING ---
          this.logger.debug(`[KDS_ASK_DEBUG] Value for parseFloat(amount): ${valueToParseForAmount} (type: ${typeof valueToParseForAmount}), Parsed price: ${price}, Parsed amount: ${amount}`);
          if (isNaN(amount)) {
            this.logger.warn(`[KDS_ASK_DEBUG_NaN] NaN detected for amount. Raw ask: ${JSON.stringify(ask)}, ask.qty: ${rawQty} (type: ${typeof rawQty}), ask[1]: ${rawIndex1} (type: ${typeof rawIndex1}), eval_for_parseFloat: ${valueToParseForAmount}`);
          }
          // --- END ADDED DEBUG LOGGING ---
          
          // Skip entries with amount 0 (these are deletions)
          if (amount === 0) {
            // Find the price level to remove
            const indexToRemove = this.orderBook.asks.findIndex(entry => 
              Math.abs(parseFloat(entry[0]) - price) < 0.00001
            );
            if (indexToRemove !== -1) {
              this.orderBook.asks.splice(indexToRemove, 1);
            }
            return;
          }
          
          // Store as [price, amount] array
          const priceLevel = [price, amount];
          
          // Find if this price level already exists
          const existingIndex = this.orderBook.asks.findIndex(entry => 
            Math.abs(parseFloat(entry[0]) - price) < 0.00001
          );
          
          if (existingIndex !== -1) {
            // Update existing price level
            this.orderBook.asks[existingIndex] = priceLevel;
          } else {
            // Add new price level
            this.orderBook.asks.push(priceLevel);
            
            // Sort asks in ascending order (lowest price first)
            this.orderBook.asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
            
            // Trim to maintain depth
            if (this.orderBook.asks.length > this.orderBookDepth) {
              this.orderBook.asks = this.orderBook.asks.slice(0, this.orderBookDepth);
            }
          }
        });
      }

      // Update last updated timestamp
      this.orderBook.lastUpdated = timestamp;

      // Validate order book before emission
      const currentBestBid = (this.orderBook.bids && this.orderBook.bids.length > 0) ? parseFloat(this.orderBook.bids[0][0]) : null;
      const currentBestAsk = (this.orderBook.asks && this.orderBook.asks.length > 0) ? parseFloat(this.orderBook.asks[0][0]) : null;

      if (currentBestBid !== null && currentBestAsk !== null && currentBestBid >= currentBestAsk) {
        this.logger.warn('Internal crossed/flat order book detected before emission. Suppressing this update.', {
          bestBid: currentBestBid,
          bestAsk: currentBestAsk,
          bidCount: this.orderBook.bids.length,
          askCount: this.orderBook.asks.length,
          symbol: this.symbol,
          timestamp: timestamp
        });
        return; // Do not emit this crossed/flat order book update
      }

      // Emit the complete orderbook as an event
      const completeOrderbook = {
        bids: [...this.orderBook.bids],  // Create copies to avoid reference issues
        asks: [...this.orderBook.asks],
        timestamp: timestamp,
        symbol: this.symbol
      };

      this.logger.info(`Emitting orderbook update with ${completeOrderbook.bids.length} bids and ${completeOrderbook.asks.length} asks`, {
        bestBid: completeOrderbook.bids.length > 0 ? completeOrderbook.bids[0][0] : 'none',
        bestAsk: completeOrderbook.asks.length > 0 ? completeOrderbook.asks[0][0] : 'none'
      });
      
      // Emit the orderbook update event
      this.emit('orderbook', completeOrderbook);
    } catch (error) {
      this.logger.error(`Error processing order book data: ${error.message}`, { error, data });
    }
  }
  
  /**
   * Process trade update
   * @param {Object} data Trade data
   * @private
   */
  _processTrade(data) {
    if (!data) {
      this.logger.debug('Received empty trade data');
      return;
    }
    
    this.logger.debug(`Processing trade for ${data.symbol}`);
    
    try {
      if (!data.trades || !Array.isArray(data.trades)) {
        this.logger.debug('No trades array in trade data');
        return;
      }
      
      const processedTrades = data.trades.map(trade => ({
        price: parseFloat(trade.price),
        amount: parseFloat(trade.volume),
        side: trade.side,
        timestamp: new Date(trade.time * 1000).getTime(),
        id: trade.id || `kraken-${Date.now()}-${Math.random()}`
      }));
      
      // Add to last trades buffer (keep only most recent trades)
      this.lastTrades = [...processedTrades, ...this.lastTrades].slice(0, 100);
      
      // Emit trade update event for each trade
      processedTrades.forEach(trade => {
        this.emit('trade', trade);
      });
      
      this.logger.debug(`Processed ${processedTrades.length} trades`);
    } catch (error) {
      this.logger.error(`Error processing trade data: ${error.message}`, { error, data });
    }
  }
  
  /**
   * Process ticker update
   * @param {Object} data Ticker data
   * @private
   */
  _processTicker(data) {
    if (!data) {
      this.logger.debug('Received empty ticker data element');
      return;
    }
    
    this.logger.debug(`Processing ticker update for ${data.symbol}`);
    
    try {
      const ticker = {
        bid: parseFloat(data.bid),
        ask: parseFloat(data.ask),
        lastPrice: parseFloat(data.last || data.lastPrice),
        volume24h: parseFloat(data.volume || data.vol24h),
        volumeWeightedAveragePrice: parseFloat(data.vwap || data.vwap24h),
        low: parseFloat(data.low),
        high: parseFloat(data.high),
        change: parseFloat(data.change || 0),
        changePercent: parseFloat(data.changePercent || data.change_percent || 0),
        timestamp: Date.now()
      };
      
      this.ticker = ticker;
      
      this.logger.info('Processed ticker data - SENDING TO LISTENERS', {
        bid: ticker.bid,
        ask: ticker.ask,
        lastPrice: ticker.lastPrice
      });
      
      // Emit ticker update event
      this.emit('ticker', ticker);
    } catch (error) {
      this.logger.error(`Error processing ticker data: ${error.message}`, { error, data });
    }
  }
  
  /**
   * Get current order book
   * @returns {Object} Current order book state
   */
  getOrderBook() {
    this.logger.debug(`getOrderBook called - returning orderbook with ${this.orderBook.bids.length} bids and ${this.orderBook.asks.length} asks`);
    return {
      bids: [...this.orderBook.bids],
      asks: [...this.orderBook.asks],
      timestamp: Date.now(),
      symbol: this.symbol
    };
  }
  
  /**
   * Get recent trades
   * @param {number} [limit=20] Number of trades to retrieve
   * @returns {Array} Recent trades
   */
  getTrades(limit = 20) {
    return this.lastTrades.slice(0, limit);
  }
  
  /**
   * Get current ticker
   * @returns {Object} Current ticker data
   */
  getTicker() {
    this.logger.debug('getTicker called', { ticker: this.ticker ? 'has data' : 'is null' });
    return this.ticker;
  }
}

export default KrakenDataStreamAdapter; 