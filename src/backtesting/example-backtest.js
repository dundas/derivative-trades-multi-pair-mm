/**
 * Example Backtest
 *
 * Demonstrates how to use the backtesting engine to validate a trading strategy.
 * This example implements a simple moving average crossover strategy.
 */

import { BacktestingEngine } from './BacktestingEngine.js';
import { OrderBookAnalyzer } from '../../lib/utils/order-book/OrderBookAnalyzer.js';

/**
 * Simple Moving Average Crossover Strategy
 *
 * Buys when short MA crosses above long MA
 * Sells when short MA crosses below long MA
 */
class MovingAverageCrossoverStrategy {
  constructor({ shortPeriod = 5, longPeriod = 20, positionSize = 0.1 }) {
    this.shortPeriod = shortPeriod;
    this.longPeriod = longPeriod;
    this.positionSize = positionSize;

    this.prices = [];
    this.position = null;
    this.exchange = null;
    this.clock = null;
  }

  setExchange(exchange) {
    this.exchange = exchange;
  }

  setClock(clock) {
    this.clock = clock;
  }

  async initialize() {
    console.log(`Initializing MA Crossover Strategy (${this.shortPeriod}/${this.longPeriod})`);
  }

  async tick(timestamp, marketData) {
    const btcData = marketData['BTC/USD'];
    if (!btcData || !btcData.orderBook) return;

    // Calculate mid price
    const bids = btcData.orderBook.bids;
    const asks = btcData.orderBook.asks;
    if (!bids || !asks || bids.length === 0 || asks.length === 0) return;

    const midPrice = (bids[0][0] + asks[0][0]) / 2;

    // Store price
    this.prices.push(midPrice);

    // Keep only necessary history
    if (this.prices.length > this.longPeriod) {
      this.prices.shift();
    }

    // Need enough data for long MA
    if (this.prices.length < this.longPeriod) return;

    // Calculate MAs
    const shortMA = this.calculateMA(this.shortPeriod);
    const longMA = this.calculateMA(this.longPeriod);

    const prevShortMA = this.calculateMA(this.shortPeriod, 1);
    const prevLongMA = this.calculateMA(this.longPeriod, 1);

    // Check for crossover
    const bullishCrossover = prevShortMA <= prevLongMA && shortMA > longMA;
    const bearishCrossover = prevShortMA >= prevLongMA && shortMA < longMA;

    // Execute trades
    if (bullishCrossover && !this.position) {
      // Buy signal
      const order = this.exchange.placeOrder({
        pair: 'BTC/USD',
        side: 'BUY',
        type: 'MARKET',
        amount: this.positionSize,
        timestamp
      });

      if (order.status !== 'REJECTED') {
        this.position = {
          side: 'LONG',
          entryPrice: midPrice,
          entryTime: timestamp,
          orderId: order.id
        };
        console.log(`[${new Date(timestamp).toISOString()}] BUY ${this.positionSize} BTC @ ${midPrice.toFixed(2)} (MA: ${shortMA.toFixed(2)}/${longMA.toFixed(2)})`);
      }
    } else if (bearishCrossover && this.position && this.position.side === 'LONG') {
      // Sell signal
      const order = this.exchange.placeOrder({
        pair: 'BTC/USD',
        side: 'SELL',
        type: 'MARKET',
        amount: this.positionSize,
        timestamp
      });

      if (order.status !== 'REJECTED') {
        const pnl = (midPrice - this.position.entryPrice) * this.positionSize;
        console.log(`[${new Date(timestamp).toISOString()}] SELL ${this.positionSize} BTC @ ${midPrice.toFixed(2)} (P&L: $${pnl.toFixed(2)})`);
        this.position = null;
      }
    }
  }

  calculateMA(period, offset = 0) {
    const endIndex = this.prices.length - offset;
    const startIndex = endIndex - period;

    if (startIndex < 0) return 0;

    const sum = this.prices.slice(startIndex, endIndex).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  async finalize() {
    console.log('Strategy finalized');
  }
}

/**
 * Generate sample historical data
 * Simulates BTC/USD price movement over time
 */
function generateSampleData(startDate, endDate, tickInterval) {
  const data = [];
  let currentTime = startDate;
  let basePrice = 40000; // Start at $40,000

  while (currentTime <= endDate) {
    // Simulate price movement (random walk with trend)
    const change = (Math.random() - 0.48) * 100; // Slight upward bias
    basePrice = Math.max(30000, Math.min(50000, basePrice + change));

    // Generate order book around current price
    const spread = 10; // $10 spread
    const bids = [];
    const asks = [];

    for (let i = 0; i < 10; i++) {
      bids.push([basePrice - spread / 2 - i * 5, Math.random() * 5 + 1]);
      asks.push([basePrice + spread / 2 + i * 5, Math.random() * 5 + 1]);
    }

    data.push({
      timestamp: currentTime,
      pair: 'BTC/USD',
      orderBook: { bids, asks },
      trades: [],
      fundingRate: null
    });

    currentTime += tickInterval;
  }

  return data;
}

/**
 * Run example backtest
 */
async function runExample() {
  console.log('=== Backtesting Engine Example ===\n');

  // Configure backtest
  const startDate = '2024-01-01T00:00:00Z';
  const endDate = '2024-01-07T00:00:00Z'; // 7 days
  const tickInterval = 3600000; // 1 hour

  console.log(`Period: ${startDate} to ${endDate}`);
  console.log(`Tick interval: ${tickInterval / 1000 / 60} minutes\n`);

  // Create engine
  const engine = new BacktestingEngine({
    startDate,
    endDate,
    initialBalances: { USD: 10000, BTC: 0 },
    pairs: ['BTC/USD'],
    tickInterval,
    onTick: (info) => {
      if (info.tickCount % 24 === 0) { // Log every 24 hours
        console.log(`Progress: ${info.progress}% (${info.tickCount} ticks)`);
      }
    }
  });

  // Generate sample data
  console.log('Generating sample historical data...');
  const sampleData = generateSampleData(
    Date.parse(startDate),
    Date.parse(endDate),
    tickInterval
  );

  await engine.loadData({ pair: 'BTC/USD', array: sampleData });
  console.log(`Loaded ${sampleData.length} ticks of historical data\n`);

  // Create strategy
  const strategy = new MovingAverageCrossoverStrategy({
    shortPeriod: 5,
    longPeriod: 20,
    positionSize: 0.1 // 0.1 BTC per trade
  });

  engine.setStrategy(strategy);

  // Run backtest
  console.log('Running backtest...\n');
  const startTime = Date.now();
  const result = await engine.run();
  const duration = Date.now() - startTime;

  console.log(`\nBacktest completed in ${(duration / 1000).toFixed(2)} seconds\n`);

  // Display results
  console.log(result.getReport());

  // Additional analysis
  console.log('\n=== Additional Statistics ===');
  console.log(`Total fills: ${result.fills.length}`);
  console.log(`Initial balance: $${result.initialBalances.get('USD').toFixed(2)}`);
  console.log(`Final balance: $${result.finalBalances.get('USD').toFixed(2)}, ${result.finalBalances.get('BTC').toFixed(4)} BTC`);

  // Export results to JSON (optional)
  // await fs.promises.writeFile('backtest-results.json', JSON.stringify(result.toJSON(), null, 2));

  return result;
}

// Run example if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample()
    .then(() => {
      console.log('\nExample completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error running example:', error);
      process.exit(1);
    });
}

export { runExample, MovingAverageCrossoverStrategy };
