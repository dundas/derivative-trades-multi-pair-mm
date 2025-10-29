/**
 * MultiPairDataCollector
 * 
 * Manages parallel data collection for multiple trading pairs including:
 * - Real-time orderbook data from spot markets
 * - Futures market data for lead detection
 * - Price history tracking for movement analysis
 * - Correlation data between pairs
 */

import { EventEmitter } from 'events';
import OrderBookBufferManager from '../../../lib/utils/order-book-buffer-manager.js';
import { KrakenFuturesRESTClient } from '../../../lib/exchanges/KrakenFuturesRESTClient.js';
import { CircularBuffer } from '../../../lib/utils/circular-buffer.js';

const FUTURES_PAIRS_MAP = {
  'BTC/USD': 'PF_XBTUSD',
  'ETH/USD': 'PF_ETHUSD',
  'SOL/USD': 'PF_SOLUSD',
  'XRP/USD': 'PF_XRPUSD',
  'MATIC/USD': 'PF_MATICUSD',
  'AVAX/USD': 'PF_AVAXUSD',
  'DOT/USD': 'PF_DOTUSD',
  'LINK/USD': 'PF_LINKUSD'
};

export class MultiPairDataCollector extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Array<String>} options.pairs - Trading pairs to collect data for
   * @param {String} options.exchange - Exchange name
   * @param {Object} options.exchangeAdapter - Exchange adapter for WebSocket data
   * @param {Boolean} options.enableFutures - Enable futures data collection
   * @param {Object} options.logger - Logger instance
   */
  constructor(options = {}) {
    super();
    
    this.pairs = options.pairs || [];
    this.exchange = options.exchange || 'kraken';
    this.exchangeAdapter = options.exchangeAdapter;
    this.enableFutures = options.enableFutures !== false;
    this.logger = options.logger;
    
    // OrderBook managers for each pair
    this.orderBookManagers = new Map();
    
    // Futures clients and data
    this.futuresClient = null;
    this.futuresData = new Map(); // pair -> latest futures data
    this.futuresPriceHistory = new Map(); // pair -> CircularBuffer of prices
    
    // Spot price history for correlation tracking
    this.spotPriceHistory = new Map(); // pair -> CircularBuffer of prices
    
    // Movement tracking
    this.movementWindow = 5000; // 5 seconds for movement calculation
    this.historySize = 600; // 10 minutes of data at 1 second intervals
    
    // Correlation tracking
    this.correlationWindow = 300; // 5 minutes for correlation calculation
    this.correlationCache = new Map(); // "pair1:pair2" -> correlation
    
    // Data collection state
    this.isRunning = false;
    this.dataCollectionInterval = null;
    this.futuresCollectionInterval = null;
    
    this._initializeManagers();
  }
  
  /**
   * Initialize orderbook managers and price history buffers
   * @private
   */
  _initializeManagers() {
    for (const pair of this.pairs) {
      // Create orderbook manager for each pair
      this.orderBookManagers.set(pair, new OrderBookBufferManager({
        symbol: pair,
        logger: this.logger.createChild(`OrderBook-${pair}`),
        bufferTimeWindow: 60000, // 1 minute buffer
        analysisTimeWindow: 250 // 250ms analysis window
      }));
      
      // Initialize price history buffers
      this.spotPriceHistory.set(pair, new CircularBuffer(this.historySize));
      this.futuresPriceHistory.set(pair, new CircularBuffer(this.historySize));
      
      // Initialize futures data
      this.futuresData.set(pair, null);
    }
    
    // Initialize futures client if enabled
    if (this.enableFutures) {
      this.futuresClient = new KrakenFuturesRESTClient({
        logger: this.logger.createChild('FuturesClient')
      });
    }
    
    this.logger.info('Data collectors initialized', {
      pairs: this.pairs,
      futuresEnabled: this.enableFutures
    });
  }
  
  /**
   * Start data collection
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Data collector already running');
      return;
    }
    
    this.isRunning = true;
    
    // Subscribe to WebSocket orderbook updates
    this._subscribeToOrderbooks();
    
    // Start futures data collection if enabled
    if (this.enableFutures) {
      this._startFuturesCollection();
    }
    
    // Start correlation calculation
    this._startCorrelationTracking();
    
    this.logger.info('Data collection started');
  }
  
  /**
   * Stop data collection
   * @returns {Promise<void>}
   */
  async stop() {
    this.isRunning = false;
    
    // Clear intervals
    if (this.dataCollectionInterval) {
      clearInterval(this.dataCollectionInterval);
      this.dataCollectionInterval = null;
    }
    
    if (this.futuresCollectionInterval) {
      clearInterval(this.futuresCollectionInterval);
      this.futuresCollectionInterval = null;
    }
    
    // Unsubscribe from orderbooks
    this._unsubscribeFromOrderbooks();
    
    this.logger.info('Data collection stopped');
  }
  
  /**
   * Subscribe to orderbook updates via WebSocket
   * @private
   */
  _subscribeToOrderbooks() {
    if (!this.exchangeAdapter) {
      this.logger.error('No exchange adapter available for WebSocket subscription');
      return;
    }
    
    // Set up orderbook update handler
    this._handleOrderBookUpdate = (data) => {
      const pair = data.symbol || data.pair;
      if (!this.pairs.includes(pair)) return;
      
      const manager = this.orderBookManagers.get(pair);
      if (manager) {
        const processed = manager.processAndStoreOrderBook(data);
        
        // Update spot price history
        if (processed && processed.midPrice) {
          const history = this.spotPriceHistory.get(pair);
          if (history) {
            history.push({
              timestamp: Date.now(),
              price: processed.midPrice
            });
          }
        }
      }
    };
    
    // Subscribe to orderbook events
    this.exchangeAdapter.on('orderBookUpdate', this._handleOrderBookUpdate);
    
    this.logger.info('Subscribed to orderbook updates for all pairs');
  }
  
  /**
   * Unsubscribe from orderbook updates
   * @private
   */
  _unsubscribeFromOrderbooks() {
    if (this.exchangeAdapter && this._handleOrderBookUpdate) {
      this.exchangeAdapter.off('orderBookUpdate', this._handleOrderBookUpdate);
    }
  }
  
  /**
   * Start futures data collection
   * @private
   */
  _startFuturesCollection() {
    // Collect futures data every second
    this.futuresCollectionInterval = setInterval(() => {
      this._collectFuturesData().catch(error => {
        this.logger.error('Error collecting futures data', error);
      });
    }, 1000);
    
    // Collect immediately
    this._collectFuturesData().catch(error => {
      this.logger.error('Error in initial futures data collection', error);
    });
  }
  
  /**
   * Collect futures data for all pairs
   * @private
   */
  async _collectFuturesData() {
    if (!this.futuresClient) return;
    
    try {
      // Get tickers for all futures pairs
      const tickers = await this.futuresClient.getTickers();
      
      for (const [spotPair, futuresPair] of Object.entries(FUTURES_PAIRS_MAP)) {
        if (!this.pairs.includes(spotPair)) continue;
        
        const ticker = tickers.find(t => t.symbol === futuresPair);
        if (ticker) {
          const futuresData = {
            price: ticker.last,
            bid: ticker.bid,
            ask: ticker.ask,
            volume: ticker.volume,
            timestamp: Date.now()
          };
          
          this.futuresData.set(spotPair, futuresData);
          
          // Update futures price history
          const history = this.futuresPriceHistory.get(spotPair);
          if (history) {
            history.push({
              timestamp: futuresData.timestamp,
              price: futuresData.price
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to collect futures data', error);
    }
  }
  
  /**
   * Collect all current market data
   * @returns {Object} Market data for all pairs
   */
  async collectAllData() {
    const marketData = {};
    
    for (const pair of this.pairs) {
      marketData[pair] = await this.collectPairData(pair);
    }
    
    return marketData;
  }
  
  /**
   * Collect data for a specific pair
   * @param {String} pair - Trading pair
   * @returns {Object} Market data for the pair
   */
  async collectPairData(pair) {
    const orderBookManager = this.orderBookManagers.get(pair);
    const spotOrderbook = orderBookManager ? orderBookManager.getLatestOrderbook() : null;
    
    const data = {
      spot: null,
      futures: null,
      movement: null
    };
    
    // Spot market data
    if (spotOrderbook) {
      data.spot = {
        price: spotOrderbook.midPrice,
        bid: spotOrderbook.bestBid,
        ask: spotOrderbook.bestAsk,
        spread: spotOrderbook.spread,
        liquidity: this._calculateLiquidity(spotOrderbook),
        timestamp: spotOrderbook.timestamp
      };
    }
    
    // Futures market data
    if (this.enableFutures) {
      const futuresData = this.futuresData.get(pair);
      if (futuresData) {
        data.futures = futuresData;
      }
    }
    
    // Movement analysis
    data.movement = {
      spot: this.calculateSpotMovement(pair),
      futures: this.calculateFuturesMovement(pair)
    };
    
    return data;
  }
  
  /**
   * Calculate spot price movement
   * @param {String} pair - Trading pair
   * @returns {Number} Percentage movement
   */
  calculateSpotMovement(pair) {
    const history = this.spotPriceHistory.get(pair);
    if (!history || history.length < 2) return 0;
    
    const now = Date.now();
    const windowStart = now - this.movementWindow;
    
    const recentPrices = history.filter(item => item.timestamp >= windowStart);
    if (recentPrices.length < 2) return 0;
    
    const oldPrice = recentPrices[0].price;
    const currentPrice = recentPrices[recentPrices.length - 1].price;
    
    return ((currentPrice - oldPrice) / oldPrice) * 100;
  }
  
  /**
   * Calculate futures price movement
   * @param {String} pair - Trading pair
   * @returns {Number} Percentage movement
   */
  calculateFuturesMovement(pair) {
    const history = this.futuresPriceHistory.get(pair);
    if (!history || history.length < 2) return 0;
    
    const now = Date.now();
    const windowStart = now - this.movementWindow;
    
    const recentPrices = history.filter(item => item.timestamp >= windowStart);
    if (recentPrices.length < 2) return 0;
    
    const oldPrice = recentPrices[0].price;
    const currentPrice = recentPrices[recentPrices.length - 1].price;
    
    return ((currentPrice - oldPrice) / oldPrice) * 100;
  }
  
  /**
   * Get current price for a pair
   * @param {String} pair - Trading pair
   * @returns {Number} Current spot price
   */
  async getCurrentPrice(pair) {
    const orderBookManager = this.orderBookManagers.get(pair);
    if (orderBookManager) {
      const orderbook = orderBookManager.getLatestOrderbook();
      return orderbook ? orderbook.midPrice : null;
    }
    return null;
  }
  
  /**
   * Calculate liquidity from orderbook
   * @private
   */
  _calculateLiquidity(orderbook) {
    if (!orderbook || !orderbook.bids || !orderbook.asks) return 0;
    
    // Calculate liquidity within 0.1% of mid price
    const midPrice = orderbook.midPrice;
    const priceRange = midPrice * 0.001; // 0.1%
    
    let bidLiquidity = 0;
    let askLiquidity = 0;
    
    // Sum bid liquidity
    for (const [price, amount] of orderbook.bids) {
      if (price >= midPrice - priceRange) {
        bidLiquidity += price * amount;
      }
    }
    
    // Sum ask liquidity
    for (const [price, amount] of orderbook.asks) {
      if (price <= midPrice + priceRange) {
        askLiquidity += price * amount;
      }
    }
    
    return bidLiquidity + askLiquidity;
  }
  
  /**
   * Start correlation tracking
   * @private
   */
  _startCorrelationTracking() {
    // Update correlations every 30 seconds
    setInterval(() => {
      this._updateCorrelations();
    }, 30000);
  }
  
  /**
   * Update correlations between pairs
   * @private
   */
  _updateCorrelations() {
    const pairs = Array.from(this.pairs);
    
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const correlation = this._calculateCorrelation(pairs[i], pairs[j]);
        const key = `${pairs[i]}:${pairs[j]}`;
        this.correlationCache.set(key, correlation);
      }
    }
  }
  
  /**
   * Calculate correlation between two pairs
   * @private
   */
  _calculateCorrelation(pair1, pair2) {
    const history1 = this.spotPriceHistory.get(pair1);
    const history2 = this.spotPriceHistory.get(pair2);
    
    if (!history1 || !history2 || history1.length < 10 || history2.length < 10) {
      return 0;
    }
    
    // Get recent price returns
    const returns1 = this._calculateReturns(history1);
    const returns2 = this._calculateReturns(history2);
    
    if (returns1.length < 5 || returns2.length < 5) {
      return 0;
    }
    
    // Calculate Pearson correlation
    return this._pearsonCorrelation(returns1, returns2);
  }
  
  /**
   * Calculate price returns from history
   * @private
   */
  _calculateReturns(history) {
    const returns = [];
    const data = history.toArray();
    
    for (let i = 1; i < data.length; i++) {
      const return_i = (data[i].price - data[i-1].price) / data[i-1].price;
      returns.push(return_i);
    }
    
    return returns;
  }
  
  /**
   * Calculate Pearson correlation coefficient
   * @private
   */
  _pearsonCorrelation(x, y) {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;
    
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumX2 += x[i] * x[i];
      sumY2 += y[i] * y[i];
    }
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    if (denominator === 0) return 0;
    
    return numerator / denominator;
  }
  
  /**
   * Get all correlations
   * @returns {Object} Correlation matrix
   */
  async calculateCorrelations() {
    const correlations = {};
    
    for (const [key, value] of this.correlationCache) {
      correlations[key] = value;
    }
    
    return correlations;
  }
  
  /**
   * Get market summary for all pairs
   * @returns {Object} Summary of market conditions
   */
  getMarketSummary() {
    const summary = {
      pairs: {},
      strongestMove: null,
      highestCorrelation: null,
      overallTrend: null
    };
    
    let strongestMove = 0;
    let totalMovement = 0;
    
    for (const pair of this.pairs) {
      const spotMovement = this.calculateSpotMovement(pair);
      const futuresMovement = this.calculateFuturesMovement(pair);
      
      summary.pairs[pair] = {
        spotMovement,
        futuresMovement,
        divergence: futuresMovement - spotMovement
      };
      
      if (Math.abs(futuresMovement) > Math.abs(strongestMove)) {
        strongestMove = futuresMovement;
        summary.strongestMove = { pair, movement: futuresMovement };
      }
      
      totalMovement += spotMovement;
    }
    
    // Overall trend
    summary.overallTrend = totalMovement > 0 ? 'BULLISH' : 'BEARISH';
    
    // Highest correlation
    let highestCorr = 0;
    let highestCorrPair = null;
    
    for (const [key, corr] of this.correlationCache) {
      if (Math.abs(corr) > Math.abs(highestCorr)) {
        highestCorr = corr;
        highestCorrPair = key;
      }
    }
    
    if (highestCorrPair) {
      summary.highestCorrelation = {
        pairs: highestCorrPair,
        correlation: highestCorr
      };
    }
    
    return summary;
  }
}

