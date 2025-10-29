/**
 * Strategy Performance Analyzer
 * 
 * Analyzes the performance of different strategy combinations across various market conditions.
 * Helps identify optimal strategy parameters and combinations for different market scenarios.
 */

import { MarketDataProviderFactory } from '../data/MarketDataProviderFactory.js';
import { MarketConditions } from '../data/MarketConditionTypes.js';
import { TradingLogger } from '../../../../utils/trading-logger.js';

export class StrategyPerformanceAnalyzer {
  /**
   * Create a new StrategyPerformanceAnalyzer
   * @param {Object} options Configuration options
   * @param {Object} options.pricingStrategies Map of pricing strategies to analyze
   * @param {Object} options.sizingStrategies Map of sizing strategies to analyze
   * @param {string} [options.symbol] Trading symbol
   * @param {Object} [options.logger] Logger instance
   */
  constructor(options = {}) {
    this.pricingStrategies = options.pricingStrategies || {};
    this.sizingStrategies = options.sizingStrategies || {};
    this.symbol = options.symbol || 'BTC/USD';
    
    // Set up logger
    this.logger = options.logger || new TradingLogger({
      component: 'StrategyPerformanceAnalyzer',
      symbol: this.symbol,
      sessionId: options.sessionId || 'analysis'
    });
    
    // Initialize market data providers
    this.marketDataProviders = {};
    for (const condition of Object.values(MarketConditions)) {
      this.marketDataProviders[condition] = MarketDataProviderFactory.create({
        type: 'test',
        providerOptions: {
          marketCondition: condition,
          symbol: this.symbol,
          logger: this.logger
        }
      });
    }
    
    // Default position and balance data
    this.positionData = options.positionData || {
      netPosition: 0.1,
      targetPosition: 0.05
    };
    
    this.balanceData = options.balanceData || {
      available: 10000 // $10,000 budget
    };
    
    // Results storage
    this.results = {
      byCondition: {},
      byStrategy: {},
      summary: {}
    };
  }
  
  /**
   * Run analysis across all strategies and market conditions
   * @returns {Object} Analysis results
   */
  async analyzeAll() {
    this.logger.info('Starting comprehensive strategy analysis');
    
    // Analyze each strategy combination in each market condition
    for (const [pricingName, pricingStrategy] of Object.entries(this.pricingStrategies)) {
      for (const [sizingName, sizingStrategy] of Object.entries(this.sizingStrategies)) {
        const strategyKey = `${pricingName}+${sizingName}`;
        this.results.byStrategy[strategyKey] = {};
        
        for (const condition of Object.values(MarketConditions)) {
          // Initialize condition results if needed
          if (!this.results.byCondition[condition]) {
            this.results.byCondition[condition] = {};
          }
          
          // Run analysis for this combination
          const result = await this.analyzeStrategyWithCondition(
            pricingStrategy,
            sizingStrategy,
            condition
          );
          
          // Store results by condition and strategy
          this.results.byCondition[condition][strategyKey] = result;
          this.results.byStrategy[strategyKey][condition] = result;
        }
      }
    }
    
    // Generate summary metrics
    this.generateSummary();
    
    return this.results;
  }
  
  /**
   * Analyze a specific strategy combination in a specific market condition
   * @param {Object} pricingStrategy Pricing strategy instance
   * @param {Object} sizingStrategy Sizing strategy instance
   * @param {string} condition Market condition identifier
   * @returns {Object} Analysis results
   */
  async analyzeStrategyWithCondition(pricingStrategy, sizingStrategy, condition) {
    try {
      const provider = this.marketDataProviders[condition];
      
      // Get market data
      const orderBook = await provider.getOrderBook(10);
      const ticker = await provider.getTicker();
      const trades = await provider.getTrades(20);
      
      // Calculate mid price
      const midPrice = (ticker.bid + ticker.ask) / 2;
      
      // Calculate prices
      const pricingParams = {
        midPrice,
        orderBook,
        marketData: ticker,
        positionData: this.positionData,
        overrides: {}
      };
      
      const prices = pricingStrategy.calculatePrices(pricingParams);
      
      // Handle invalid prices
      if (!prices || prices.bidPrice === null || prices.askPrice === null) {
        return {
          condition,
          pricingStrategy: pricingStrategy.constructor.name,
          sizingStrategy: sizingStrategy.constructor.name,
          valid: false,
          error: 'Invalid prices calculated',
          metrics: {
            spreadPercentage: null,
            bidToMid: null,
            askToMid: null,
            estimatedProfitPotential: null,
            riskScore: null
          }
        };
      }
      
      // Calculate sizes
      const sizingParams = {
        orderBook,
        marketData: ticker,
        balanceData: this.balanceData,
        positionData: this.positionData,
        bidPrice: prices.bidPrice,
        askPrice: prices.askPrice,
        overrides: {}
      };
      
      const sizes = sizingStrategy.calculateSizes(sizingParams);
      
      // Handle invalid sizes
      if (!sizes || sizes.bidSize === null || sizes.askSize === null) {
        return {
          condition,
          pricingStrategy: pricingStrategy.constructor.name,
          sizingStrategy: sizingStrategy.constructor.name,
          valid: true,
          prices,
          sizes: { bidSize: 0, askSize: 0 },
          error: 'Invalid sizes calculated',
          metrics: this.calculateMetrics(prices, { bidSize: 0, askSize: 0 }, midPrice, orderBook, trades)
        };
      }
      
      // Calculate performance metrics
      const metrics = this.calculateMetrics(prices, sizes, midPrice, orderBook, trades);
      
      return {
        condition,
        pricingStrategy: pricingStrategy.constructor.name,
        sizingStrategy: sizingStrategy.constructor.name,
        valid: true,
        prices,
        sizes,
        metrics
      };
    } catch (error) {
      this.logger.error('Error analyzing strategy with condition', {
        pricingStrategy: pricingStrategy.constructor.name,
        sizingStrategy: sizingStrategy.constructor.name,
        condition,
        error: error.message
      });
      
      return {
        condition,
        pricingStrategy: pricingStrategy.constructor.name,
        sizingStrategy: sizingStrategy.constructor.name,
        valid: false,
        error: error.message,
        metrics: {
          spreadPercentage: null,
          bidToMid: null,
          askToMid: null,
          estimatedProfitPotential: null,
          riskScore: null
        }
      };
    }
  }
  
  /**
   * Calculate performance metrics for a strategy
   * @param {Object} prices Calculated prices
   * @param {Object} sizes Calculated sizes
   * @param {number} midPrice Current mid price
   * @param {Object} orderBook Order book data
   * @param {Array} trades Recent trades data
   * @returns {Object} Performance metrics
   */
  calculateMetrics(prices, sizes, midPrice, orderBook, trades) {
    // Basic spread metrics
    const spread = prices.askPrice - prices.bidPrice;
    const spreadPercentage = (spread / midPrice) * 100;
    const bidToMid = ((midPrice - prices.bidPrice) / midPrice) * 100;
    const askToMid = ((prices.askPrice - midPrice) / midPrice) * 100;
    
    // Calculate estimated fill probability based on order book
    let bidFillProbability = 0;
    let askFillProbability = 0;
    
    if (orderBook && orderBook.bids && orderBook.asks) {
      // For bid (buy) orders, calculate probability based on asks
      const totalAskVolume = orderBook.asks.reduce((sum, level) => sum + parseFloat(level[1]), 0);
      const asksBelowOurBid = orderBook.asks.filter(level => parseFloat(level[0]) <= prices.bidPrice);
      const volumeBelowOurBid = asksBelowOurBid.reduce((sum, level) => sum + parseFloat(level[1]), 0);
      bidFillProbability = totalAskVolume > 0 ? volumeBelowOurBid / totalAskVolume : 0;
      
      // For ask (sell) orders, calculate probability based on bids
      const totalBidVolume = orderBook.bids.reduce((sum, level) => sum + parseFloat(level[1]), 0);
      const bidsAboveOurAsk = orderBook.bids.filter(level => parseFloat(level[0]) >= prices.askPrice);
      const volumeAboveOurAsk = bidsAboveOurAsk.reduce((sum, level) => sum + parseFloat(level[1]), 0);
      askFillProbability = totalBidVolume > 0 ? volumeAboveOurAsk / totalBidVolume : 0;
    }
    
    // Calculate market volatility from trades
    let volatility = 0;
    if (trades && trades.length > 1) {
      const prices = trades.map(trade => trade.price);
      const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      const squaredDiffs = prices.map(price => Math.pow(price - mean, 2));
      const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / prices.length;
      volatility = Math.sqrt(variance) / mean * 100; // Percentage volatility
    }
    
    // Calculate estimated profit potential
    // Simple model: (spread * sizes * fill probability)
    const bidPotential = spread * sizes.bidSize * bidFillProbability;
    const askPotential = spread * sizes.askSize * askFillProbability;
    const estimatedProfitPotential = bidPotential + askPotential;
    
    // Calculate risk score (lower is better)
    // Factors: volatility, exposure (size), and spread
    const exposure = (sizes.bidSize + sizes.askSize) * midPrice;
    const riskScore = (volatility * exposure) / (spread * 100);
    
    return {
      spreadPercentage,
      bidToMid,
      askToMid,
      bidFillProbability,
      askFillProbability,
      volatility,
      exposure,
      estimatedProfitPotential,
      riskScore
    };
  }
  
  /**
   * Generate summary metrics across all strategies and conditions
   */
  generateSummary() {
    const summary = {
      bestByCondition: {},
      bestOverall: null,
      bestLowRisk: null,
      bestHighVolatility: null,
      bestLowLiquidity: null,
      strategyRankings: []
    };
    
    // Find best strategy for each condition
    for (const condition of Object.values(MarketConditions)) {
      const conditionResults = this.results.byCondition[condition];
      if (!conditionResults) continue;
      
      let bestStrategy = null;
      let bestScore = -Infinity;
      
      for (const [strategyKey, result] of Object.entries(conditionResults)) {
        if (!result.valid) continue;
        
        // Simple scoring: profit potential / risk score (higher is better)
        const score = result.metrics.estimatedProfitPotential / 
                     (result.metrics.riskScore || 1);
        
        if (score > bestScore) {
          bestScore = score;
          bestStrategy = {
            key: strategyKey,
            ...result,
            score
          };
        }
      }
      
      summary.bestByCondition[condition] = bestStrategy;
    }
    
    // Calculate overall strategy rankings
    const strategyScores = {};
    
    for (const [strategyKey, conditionResults] of Object.entries(this.results.byStrategy)) {
      let totalScore = 0;
      let validConditions = 0;
      
      for (const [condition, result] of Object.entries(conditionResults)) {
        if (!result.valid) continue;
        
        const score = result.metrics.estimatedProfitPotential / 
                     (result.metrics.riskScore || 1);
        totalScore += score;
        validConditions++;
      }
      
      if (validConditions > 0) {
        strategyScores[strategyKey] = {
          key: strategyKey,
          averageScore: totalScore / validConditions,
          validConditions
        };
      }
    }
    
    // Sort strategies by average score
    summary.strategyRankings = Object.values(strategyScores)
      .sort((a, b) => b.averageScore - a.averageScore);
    
    // Find best overall strategy
    if (summary.strategyRankings.length > 0) {
      summary.bestOverall = summary.strategyRankings[0].key;
    }
    
    // Find best strategy for specific scenarios
    summary.bestLowRisk = this.findBestForScenario(
      result => result.metrics.riskScore || Infinity,
      'min'
    );
    
    summary.bestHighVolatility = this.findBestForScenario(
      result => {
        if (!result.valid) return -Infinity;
        return result.metrics.estimatedProfitPotential / (result.metrics.volatility || 1);
      },
      'max',
      [MarketConditions.HIGH_LIQUIDITY_HIGH_VOLATILITY, MarketConditions.LOW_LIQUIDITY_HIGH_VOLATILITY]
    );
    
    summary.bestLowLiquidity = this.findBestForScenario(
      result => {
        if (!result.valid) return -Infinity;
        return result.metrics.estimatedProfitPotential;
      },
      'max',
      [MarketConditions.LOW_LIQUIDITY_NORMAL_VOLATILITY, MarketConditions.LOW_LIQUIDITY_HIGH_VOLATILITY]
    );
    
    this.results.summary = summary;
  }
  
  /**
   * Find the best strategy for a specific scenario
   * @param {Function} scoreFn Function to calculate score from result
   * @param {string} mode 'min' or 'max' to determine best score
   * @param {Array} [conditions] Specific conditions to consider, or all if not specified
   * @returns {string} Best strategy key
   */
  findBestForScenario(scoreFn, mode = 'max', conditions = null) {
    let bestStrategy = null;
    let bestScore = mode === 'min' ? Infinity : -Infinity;
    
    const targetConditions = conditions || Object.values(MarketConditions);
    
    for (const [strategyKey, strategyResults] of Object.entries(this.results.byStrategy)) {
      let totalScore = 0;
      let validConditions = 0;
      
      for (const condition of targetConditions) {
        const result = strategyResults[condition];
        if (!result || !result.valid) continue;
        
        const score = scoreFn(result);
        totalScore += score;
        validConditions++;
      }
      
      if (validConditions > 0) {
        const avgScore = totalScore / validConditions;
        
        if ((mode === 'min' && avgScore < bestScore) || 
            (mode === 'max' && avgScore > bestScore)) {
          bestScore = avgScore;
          bestStrategy = strategyKey;
        }
      }
    }
    
    return bestStrategy;
  }
  
  /**
   * Generate a detailed report of the analysis results
   * @returns {string} Formatted report
   */
  generateReport() {
    const report = [];
    
    report.push('# Strategy Performance Analysis Report');
    report.push(`Generated: ${new Date().toISOString()}`);
    report.push(`Symbol: ${this.symbol}`);
    report.push('');
    
    // Summary section
    report.push('## Summary');
    report.push('');
    
    if (this.results.summary.bestOverall) {
      report.push(`Best Overall Strategy: **${this.results.summary.bestOverall}**`);
    }
    
    if (this.results.summary.bestLowRisk) {
      report.push(`Best Low-Risk Strategy: **${this.results.summary.bestLowRisk}**`);
    }
    
    if (this.results.summary.bestHighVolatility) {
      report.push(`Best for High Volatility: **${this.results.summary.bestHighVolatility}**`);
    }
    
    if (this.results.summary.bestLowLiquidity) {
      report.push(`Best for Low Liquidity: **${this.results.summary.bestLowLiquidity}**`);
    }
    
    report.push('');
    report.push('### Strategy Rankings');
    report.push('');
    report.push('| Rank | Strategy | Average Score | Valid Conditions |');
    report.push('|------|----------|---------------|-----------------|');
    
    this.results.summary.strategyRankings.forEach((strategy, index) => {
      report.push(`| ${index + 1} | ${strategy.key} | ${strategy.averageScore.toFixed(4)} | ${strategy.validConditions} |`);
    });
    
    report.push('');
    
    // Best strategies by condition
    report.push('## Best Strategies by Market Condition');
    report.push('');
    
    for (const condition of Object.values(MarketConditions)) {
      const best = this.results.summary.bestByCondition[condition];
      
      report.push(`### ${condition}`);
      report.push('');
      
      if (best) {
        report.push(`Best Strategy: **${best.key}**`);
        report.push(`Score: ${best.score.toFixed(4)}`);
        report.push('');
        report.push('#### Metrics:');
        report.push('');
        report.push(`- Spread: ${best.metrics.spreadPercentage.toFixed(4)}%`);
        report.push(`- Estimated Profit Potential: $${best.metrics.estimatedProfitPotential.toFixed(4)}`);
        report.push(`- Risk Score: ${best.metrics.riskScore.toFixed(4)}`);
        report.push(`- Bid Fill Probability: ${(best.metrics.bidFillProbability * 100).toFixed(2)}%`);
        report.push(`- Ask Fill Probability: ${(best.metrics.askFillProbability * 100).toFixed(2)}%`);
        report.push(`- Market Volatility: ${best.metrics.volatility.toFixed(4)}%`);
      } else {
        report.push('No valid strategy found for this condition.');
      }
      
      report.push('');
    }
    
    // Detailed metrics for all strategies
    report.push('## Detailed Strategy Metrics');
    report.push('');
    
    for (const [strategyKey, conditionResults] of Object.entries(this.results.byStrategy)) {
      report.push(`### ${strategyKey}`);
      report.push('');
      report.push('| Market Condition | Spread % | Profit Potential | Risk Score | Fill Probability |');
      report.push('|------------------|----------|------------------|------------|------------------|');
      
      for (const [condition, result] of Object.entries(conditionResults)) {
        if (!result.valid) {
          report.push(`| ${condition} | Invalid | Invalid | Invalid | Invalid |`);
          continue;
        }
        
        const metrics = result.metrics;
        const fillProb = ((metrics.bidFillProbability + metrics.askFillProbability) / 2 * 100).toFixed(2);
        
        report.push(`| ${condition} | ${metrics.spreadPercentage.toFixed(4)}% | $${metrics.estimatedProfitPotential.toFixed(4)} | ${metrics.riskScore.toFixed(4)} | ${fillProb}% |`);
      }
      
      report.push('');
    }
    
    return report.join('\n');
  }
}

export default StrategyPerformanceAnalyzer;
