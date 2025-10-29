/**
 * BacktestingEngine
 *
 * Main orchestrator for running backtests.
 * Coordinates clock, data provider, simulated exchange, and performance analysis.
 *
 * Based on Hummingbot's backtesting engine
 * Reference: hummingbot/strategy_v2/backtesting/backtesting_engine_base.py
 */

import { BacktestClock, CLOCK_MODE_SIMULATION } from './BacktestClock.js';
import { HistoricalDataProvider } from './HistoricalDataProvider.js';
import { SimulatedExchangeAdapter } from './SimulatedExchangeAdapter.js';
import { PerformanceAnalyzer } from './PerformanceAnalyzer.js';

/**
 * Backtest configuration
 */
class BacktestConfig {
  constructor({
    startDate,
    endDate,
    initialBalances = { USD: 10000 },
    pairs = [],
    tickInterval = 2000, // 2 seconds (match production)
    makerFee = 0.0016,   // 0.16% (Kraken)
    takerFee = 0.0026,   // 0.26% (Kraken)
    slippageModel = 'realistic',
    onTick = null,       // Callback on each tick
    onComplete = null    // Callback on completion
  }) {
    this.startDate = startDate instanceof Date ? startDate.getTime() : new Date(startDate).getTime();
    this.endDate = endDate instanceof Date ? endDate.getTime() : new Date(endDate).getTime();
    this.initialBalances = initialBalances;
    this.pairs = pairs;
    this.tickInterval = tickInterval;
    this.makerFee = makerFee;
    this.takerFee = takerFee;
    this.slippageModel = slippageModel;
    this.onTick = onTick;
    this.onComplete = onComplete;
  }
}

/**
 * Backtest result
 */
class BacktestResult {
  constructor({
    config,
    metrics,
    fills,
    initialBalances,
    finalBalances,
    startPrices,
    endPrices,
    duration
  }) {
    this.config = config;
    this.metrics = metrics;
    this.fills = fills;
    this.initialBalances = initialBalances;
    this.finalBalances = finalBalances;
    this.startPrices = startPrices;
    this.endPrices = endPrices;
    this.duration = duration;
  }

  /**
   * Get formatted report
   * @returns {string} Formatted performance report
   */
  getReport() {
    return PerformanceAnalyzer.formatReport(this.metrics);
  }

  /**
   * Export results to JSON
   * @returns {Object} Results as JSON
   */
  toJSON() {
    return {
      config: {
        startDate: new Date(this.config.startDate).toISOString(),
        endDate: new Date(this.config.endDate).toISOString(),
        initialBalances: this.config.initialBalances,
        pairs: this.config.pairs
      },
      metrics: this.metrics,
      fills: this.fills,
      initialBalances: Object.fromEntries(this.initialBalances),
      finalBalances: Object.fromEntries(this.finalBalances),
      startPrices: this.startPrices,
      endPrices: this.endPrices,
      duration: this.duration
    };
  }
}

/**
 * Backtesting engine
 */
class BacktestingEngine {
  constructor(config) {
    this.config = config instanceof BacktestConfig ? config : new BacktestConfig(config);

    // Initialize components
    this.clock = new BacktestClock(CLOCK_MODE_SIMULATION);
    this.clock.setTickInterval(this.config.tickInterval);

    this.dataProvider = new HistoricalDataProvider();

    this.exchange = new SimulatedExchangeAdapter({
      initialBalances: this.config.initialBalances,
      makerFee: this.config.makerFee,
      takerFee: this.config.takerFee,
      slippageModel: this.config.slippageModel
    });

    // State
    this.isRunning = false;
    this.isPaused = false;
    this.startTime = null;
    this.tickCount = 0;
    this.strategy = null;
  }

  /**
   * Load historical data
   * @param {Object} options - Loading options
   * @returns {Promise<number>} Number of ticks loaded
   */
  async loadData(options) {
    if (options.json) {
      return await this.dataProvider.loadFromJSON(options.json);
    } else if (options.csv) {
      return await this.dataProvider.loadFromCSV(options.csv, options.pair);
    } else if (options.array) {
      return this.dataProvider.loadFromArray(options.pair, options.array);
    } else {
      throw new Error('Must specify data source (json, csv, or array)');
    }
  }

  /**
   * Set strategy to backtest
   * @param {Object} strategy - Strategy object with tick() method
   */
  setStrategy(strategy) {
    this.strategy = strategy;

    // Inject simulated exchange and clock into strategy
    if (strategy.setExchange) {
      strategy.setExchange(this.exchange);
    }
    if (strategy.setClock) {
      strategy.setClock(this.clock);
    }
  }

  /**
   * Run backtest
   * @returns {Promise<BacktestResult>} Backtest results
   */
  async run() {
    if (!this.strategy) {
      throw new Error('No strategy set. Call setStrategy() first.');
    }

    if (this.dataProvider.getPairs().length === 0) {
      throw new Error('No historical data loaded. Call loadData() first.');
    }

    this.isRunning = true;
    this.startTime = Date.now();
    this.tickCount = 0;

    // Set clock to start time
    this.clock.setTime(this.config.startDate);

    // Initialize strategy
    if (this.strategy.initialize) {
      await this.strategy.initialize();
    }

    // Get start prices for buy-and-hold comparison
    const startPrices = this.getCurrentPrices(this.config.startDate);

    console.log(`Starting backtest from ${new Date(this.config.startDate).toISOString()} to ${new Date(this.config.endDate).toISOString()}`);
    console.log(`Pairs: ${this.config.pairs.join(', ')}`);
    console.log(`Tick interval: ${this.config.tickInterval}ms`);

    // Main backtest loop
    while (this.clock.now() < this.config.endDate && this.isRunning) {
      await this.processTick();

      // Advance clock by tick interval
      this.clock.advance(this.config.tickInterval);
      this.tickCount++;

      // Callback
      if (this.config.onTick) {
        const progress = ((this.clock.now() - this.config.startDate) / (this.config.endDate - this.config.startDate)) * 100;
        this.config.onTick({
          timestamp: this.clock.now(),
          tickCount: this.tickCount,
          progress: progress.toFixed(2)
        });
      }

      // Pause support
      while (this.isPaused) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Get end prices
    const endPrices = this.getCurrentPrices(this.config.endDate);

    // Finalize strategy
    if (this.strategy.finalize) {
      await this.strategy.finalize();
    }

    const duration = Date.now() - this.startTime;

    console.log(`Backtest completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`Processed ${this.tickCount} ticks`);

    // Analyze performance
    const metrics = PerformanceAnalyzer.analyze({
      fills: this.exchange.getAllFills(),
      initialBalances: new Map(Object.entries(this.config.initialBalances)),
      finalBalances: this.exchange.getAllBalances(),
      startTime: this.config.startDate,
      endTime: this.config.endDate,
      startPrices,
      endPrices
    });

    const result = new BacktestResult({
      config: this.config,
      metrics,
      fills: this.exchange.getAllFills(),
      initialBalances: new Map(Object.entries(this.config.initialBalances)),
      finalBalances: this.exchange.getAllBalances(),
      startPrices,
      endPrices,
      duration
    });

    // Callback
    if (this.config.onComplete) {
      this.config.onComplete(result);
    }

    this.isRunning = false;

    return result;
  }

  /**
   * Process single tick
   * @returns {Promise<void>}
   */
  async processTick() {
    const currentTime = this.clock.now();

    // Get historical data for current time
    const currentData = {};
    for (const pair of this.config.pairs) {
      const tick = this.dataProvider.getTickAt(pair, currentTime);
      if (tick) {
        currentData[pair] = tick;
      }
    }

    // Update strategy with current market data
    if (this.strategy.updateMarketData) {
      this.strategy.updateMarketData(currentData);
    }

    // Execute strategy tick
    if (this.strategy.tick) {
      await this.strategy.tick(currentTime, currentData);
    }

    // Process order matching against historical order books
    const openOrders = this.exchange.getOpenOrders();
    for (const order of openOrders) {
      const tickData = currentData[order.pair];
      if (tickData && tickData.orderBook) {
        this.exchange.processOrderMatching(
          order.id,
          tickData.orderBook,
          currentTime
        );
      }
    }
  }

  /**
   * Get current prices for all pairs
   * @param {number} timestamp - Timestamp
   * @returns {Object} Price map
   */
  getCurrentPrices(timestamp) {
    const prices = {};

    for (const pair of this.config.pairs) {
      const tick = this.dataProvider.getTickAt(pair, timestamp);
      if (tick && tick.orderBook) {
        const midPrice = (tick.orderBook.bids[0]?.[0] + tick.orderBook.asks[0]?.[0]) / 2;
        prices[pair] = midPrice || 0;
      }
    }

    return prices;
  }

  /**
   * Pause backtest
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume backtest
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Stop backtest
   */
  stop() {
    this.isRunning = false;
  }

  /**
   * Get current progress
   * @returns {Object} Progress information
   */
  getProgress() {
    if (!this.isRunning) {
      return {
        progress: 0,
        tickCount: 0,
        currentTime: null
      };
    }

    const progress = ((this.clock.now() - this.config.startDate) / (this.config.endDate - this.config.startDate)) * 100;

    return {
      progress: progress.toFixed(2),
      tickCount: this.tickCount,
      currentTime: this.clock.now(),
      isRunning: this.isRunning,
      isPaused: this.isPaused
    };
  }

  /**
   * Get current exchange stats
   * @returns {Object} Exchange statistics
   */
  getExchangeStats() {
    return this.exchange.getStats();
  }

  /**
   * Reset engine state
   */
  reset() {
    this.clock.reset();
    this.exchange.reset(this.config.initialBalances);
    this.dataProvider.reset();
    this.isRunning = false;
    this.isPaused = false;
    this.tickCount = 0;
  }
}

export {
  BacktestingEngine,
  BacktestConfig,
  BacktestResult
};
