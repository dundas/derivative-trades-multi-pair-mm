/**
 * Dynamic Strategy Selector
 * 
 * Automatically selects the optimal strategy combination based on current market conditions.
 * Uses market data to detect the current market condition and applies pre-configured
 * strategy mappings to choose the best pricing and sizing strategies.
 */

import { MarketConditions } from '../data/MarketConditionTypes.js';
import { TradingLogger } from '../../../../utils/trading-logger.js';

export class DynamicStrategySelector {
  /**
   * Create a new DynamicStrategySelector
   * @param {Object} options Configuration options
   * @param {Object} options.pricingStrategies Map of available pricing strategies
   * @param {Object} options.sizingStrategies Map of available sizing strategies
   * @param {Object} [options.strategyMappings] Predefined mappings of market conditions to strategies
   * @param {Object} [options.marketDataProvider] Market data provider instance
   * @param {Object} [options.logger] Logger instance
   */
  constructor(options = {}) {
    this.pricingStrategies = options.pricingStrategies || {};
    this.sizingStrategies = options.sizingStrategies || {};
    this.marketDataProvider = options.marketDataProvider;
    this.symbol = options.symbol || 'BTC/USD';
    
    // Set up logger
    this.logger = options.logger || new TradingLogger({
      component: 'DynamicStrategySelector',
      symbol: this.symbol,
      sessionId: options.sessionId || 'dynamic'
    });
    
    // Default strategy mappings (can be overridden)
    this.strategyMappings = options.strategyMappings || {
      [MarketConditions.HIGH_LIQUIDITY_NORMAL_VOLATILITY]: {
        pricing: 'TraditionalPricingStrategy',
        sizing: 'AverageSizingStrategy'
      },
      [MarketConditions.HIGH_LIQUIDITY_HIGH_VOLATILITY]: {
        pricing: 'RiskAdjustedPricingStrategy',
        sizing: 'DistributionSizingStrategy'
      },
      [MarketConditions.LOW_LIQUIDITY_NORMAL_VOLATILITY]: {
        pricing: 'HybridPricingStrategy',
        sizing: 'MinSizingStrategy'
      },
      [MarketConditions.LOW_LIQUIDITY_HIGH_VOLATILITY]: {
        pricing: 'AvellanedaPricingStrategy',
        sizing: 'DistributionSizingStrategy'
      },
      [MarketConditions.LOW_VOLUME_PERIODS]: {
        pricing: 'VolumeWeightedPricingStrategy',
        sizing: 'FixedSizingStrategy'
      }
    };
    
    // Current state
    this.currentCondition = null;
    this.currentPricingStrategy = null;
    this.currentSizingStrategy = null;
    
    // Market condition detection thresholds
    this.thresholds = options.thresholds || {
      // Liquidity thresholds (total volume in order book)
      lowLiquidity: 10, // BTC
      // Volatility thresholds (% change)
      highVolatility: 1.5, // 1.5% volatility
      // Volume thresholds (trades per minute)
      lowVolume: 5
    };
    
    // Strategy switching cooldown to prevent rapid changes
    this.lastSwitchTime = 0;
    this.switchCooldownMs = options.switchCooldownMs || 60000; // 1 minute default
    
    // Initialize with default strategies
    this.setDefaultStrategies();
  }
  
  /**
   * Set default strategies to use when no specific condition is detected
   */
  setDefaultStrategies() {
    // Use the first available strategies as defaults
    const pricingKeys = Object.keys(this.pricingStrategies);
    const sizingKeys = Object.keys(this.sizingStrategies);
    
    if (pricingKeys.length > 0) {
      this.currentPricingStrategy = this.pricingStrategies[pricingKeys[0]];
    }
    
    if (sizingKeys.length > 0) {
      this.currentSizingStrategy = this.sizingStrategies[sizingKeys[0]];
    }
    
    this.currentCondition = MarketConditions.HIGH_LIQUIDITY_NORMAL_VOLATILITY;
  }
  
  /**
   * Update strategy mappings
   * @param {Object} mappings New strategy mappings
   */
  updateStrategyMappings(mappings) {
    this.strategyMappings = {
      ...this.strategyMappings,
      ...mappings
    };
    
    this.logger.info('Updated strategy mappings', { mappings });
  }
  
  /**
   * Update detection thresholds
   * @param {Object} thresholds New threshold values
   */
  updateThresholds(thresholds) {
    this.thresholds = {
      ...this.thresholds,
      ...thresholds
    };
    
    this.logger.info('Updated detection thresholds', { thresholds });
  }
  
  /**
   * Detect current market condition based on market data
   * @param {Object} marketData Market data to analyze
   * @returns {string} Detected market condition
   */
  async detectMarketCondition() {
    if (!this.marketDataProvider) {
      this.logger.warn('No market data provider available for condition detection');
      return this.currentCondition;
    }
    
    try {
      // Get market data
      const orderBook = await this.marketDataProvider.getOrderBook(10);
      const ticker = await this.marketDataProvider.getTicker();
      const trades = await this.marketDataProvider.getTrades(20);
      const ohlc = await this.marketDataProvider.getOHLC(12); // Last hour with 5-minute intervals
      
      // Calculate liquidity (total volume in order book)
      let totalLiquidity = 0;
      
      if (orderBook && orderBook.bids && orderBook.asks) {
        const bidVolume = orderBook.bids.reduce((sum, level) => sum + parseFloat(level[1]), 0);
        const askVolume = orderBook.asks.reduce((sum, level) => sum + parseFloat(level[1]), 0);
        totalLiquidity = bidVolume + askVolume;
      }
      
      // Calculate volatility from OHLC data
      let volatility = 0;
      
      if (ohlc && ohlc.length > 0) {
        // Calculate average price for each candle
        const prices = ohlc.map(candle => (candle.high + candle.low) / 2);
        
        // Calculate percentage changes between consecutive prices
        const changes = [];
        for (let i = 1; i < prices.length; i++) {
          const percentChange = Math.abs((prices[i] - prices[i-1]) / prices[i-1] * 100);
          changes.push(percentChange);
        }
        
        // Average of absolute percentage changes
        volatility = changes.length > 0 
          ? changes.reduce((sum, change) => sum + change, 0) / changes.length
          : 0;
      }
      
      // Calculate trade volume (trades per minute)
      let tradesPerMinute = 0;
      
      if (trades && trades.length > 0) {
        // Get time range of trades in minutes
        const oldestTrade = new Date(trades[trades.length - 1].time);
        const newestTrade = new Date(trades[0].time);
        const timeRangeMinutes = (newestTrade - oldestTrade) / (1000 * 60);
        
        tradesPerMinute = timeRangeMinutes > 0 
          ? trades.length / timeRangeMinutes
          : trades.length;
      }
      
      // Determine market condition based on calculated metrics
      let condition;
      
      if (tradesPerMinute < this.thresholds.lowVolume) {
        condition = MarketConditions.LOW_VOLUME_PERIODS;
      } else if (totalLiquidity < this.thresholds.lowLiquidity) {
        condition = volatility > this.thresholds.highVolatility
          ? MarketConditions.LOW_LIQUIDITY_HIGH_VOLATILITY
          : MarketConditions.LOW_LIQUIDITY_NORMAL_VOLATILITY;
      } else {
        condition = volatility > this.thresholds.highVolatility
          ? MarketConditions.HIGH_LIQUIDITY_HIGH_VOLATILITY
          : MarketConditions.HIGH_LIQUIDITY_NORMAL_VOLATILITY;
      }
      
      this.logger.info('Detected market condition', {
        condition,
        metrics: {
          liquidity: totalLiquidity,
          volatility,
          tradesPerMinute
        }
      });
      
      return condition;
    } catch (error) {
      this.logger.error('Error detecting market condition', {
        error: error.message
      });
      
      // Return current condition if detection fails
      return this.currentCondition;
    }
  }
  
  /**
   * Get the best strategy combination for the current market condition
   * @returns {Object} Selected strategies
   */
  async selectStrategies() {
    // Check if we're still in cooldown period
    const now = Date.now();
    if (now - this.lastSwitchTime < this.switchCooldownMs) {
      return {
        condition: this.currentCondition,
        pricingStrategy: this.currentPricingStrategy,
        sizingStrategy: this.currentSizingStrategy,
        unchanged: true
      };
    }
    
    // Detect current market condition
    const detectedCondition = await this.detectMarketCondition();
    
    // If condition hasn't changed, keep current strategies
    if (detectedCondition === this.currentCondition) {
      return {
        condition: this.currentCondition,
        pricingStrategy: this.currentPricingStrategy,
        sizingStrategy: this.currentSizingStrategy,
        unchanged: true
      };
    }
    
    // Get strategy mapping for the detected condition
    const mapping = this.strategyMappings[detectedCondition];
    
    if (!mapping) {
      this.logger.warn('No strategy mapping found for condition', {
        condition: detectedCondition
      });
      
      return {
        condition: this.currentCondition,
        pricingStrategy: this.currentPricingStrategy,
        sizingStrategy: this.currentSizingStrategy,
        unchanged: true
      };
    }
    
    // Find pricing strategy
    let pricingStrategy = null;
    for (const [name, strategy] of Object.entries(this.pricingStrategies)) {
      if (strategy.constructor.name === mapping.pricing || name === mapping.pricing) {
        pricingStrategy = strategy;
        break;
      }
    }
    
    // Find sizing strategy
    let sizingStrategy = null;
    for (const [name, strategy] of Object.entries(this.sizingStrategies)) {
      if (strategy.constructor.name === mapping.sizing || name === mapping.sizing) {
        sizingStrategy = strategy;
        break;
      }
    }
    
    // If we couldn't find mapped strategies, keep current ones
    if (!pricingStrategy || !sizingStrategy) {
      this.logger.warn('Could not find mapped strategies', {
        condition: detectedCondition,
        pricingFound: !!pricingStrategy,
        sizingFound: !!sizingStrategy
      });
      
      return {
        condition: this.currentCondition,
        pricingStrategy: this.currentPricingStrategy,
        sizingStrategy: this.currentSizingStrategy,
        unchanged: true
      };
    }
    
    // Update current state
    this.currentCondition = detectedCondition;
    this.currentPricingStrategy = pricingStrategy;
    this.currentSizingStrategy = sizingStrategy;
    this.lastSwitchTime = now;
    
    this.logger.info('Switched strategies based on market condition', {
      condition: detectedCondition,
      pricing: pricingStrategy.constructor.name,
      sizing: sizingStrategy.constructor.name
    });
    
    return {
      condition: detectedCondition,
      pricingStrategy,
      sizingStrategy,
      unchanged: false
    };
  }
}

export default DynamicStrategySelector;
