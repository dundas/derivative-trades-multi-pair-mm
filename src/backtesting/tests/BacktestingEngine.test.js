/**
 * BacktestingEngine Tests
 *
 * Comprehensive tests for the backtesting engine and components
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { BacktestClock, CLOCK_MODE_SIMULATION, CLOCK_MODE_REALTIME } from '../BacktestClock.js';
import { HistoricalDataProvider, HistoricalTick } from '../HistoricalDataProvider.js';
import { SimulatedExchangeAdapter } from '../SimulatedExchangeAdapter.js';
import { PerformanceAnalyzer } from '../PerformanceAnalyzer.js';
import { BacktestingEngine, BacktestConfig } from '../BacktestingEngine.js';

// Helper: Create sample order book
function createOrderBook() {
  return {
    bids: [
      [100.00, 10],
      [99.50, 15],
      [99.00, 20]
    ],
    asks: [
      [100.50, 10],
      [101.00, 15],
      [101.50, 20]
    ]
  };
}

// ========== BacktestClock Tests ==========

test('BacktestClock - initialization', () => {
  const clock = new BacktestClock(CLOCK_MODE_SIMULATION);

  assert.ok(clock);
  assert.strictEqual(clock.isSimulation(), true);
  assert.strictEqual(clock.isRealtime(), false);
});

test('BacktestClock - advance time', () => {
  const clock = new BacktestClock(CLOCK_MODE_SIMULATION);
  const startTime = Date.now();

  clock.setTime(startTime);
  assert.strictEqual(clock.now(), startTime);

  clock.advance(5000); // 5 seconds
  assert.strictEqual(clock.now(), startTime + 5000);
});

test('BacktestClock - tick listeners', () => {
  const clock = new BacktestClock(CLOCK_MODE_SIMULATION);
  const ticks = [];

  const unsubscribe = clock.onTick((timestamp) => {
    ticks.push(timestamp);
  });

  clock.setTime(1000);
  clock.setTickInterval(100);

  // Advance past tick interval
  clock.advance(150);

  assert.ok(ticks.length >= 1);
  unsubscribe();
});

test('BacktestClock - sleep in simulation', async () => {
  const clock = new BacktestClock(CLOCK_MODE_SIMULATION);
  clock.setTime(1000);

  await clock.sleep(500);

  assert.strictEqual(clock.now(), 1500);
});

// ========== HistoricalDataProvider Tests ==========

test('HistoricalDataProvider - load from array', () => {
  const provider = new HistoricalDataProvider();

  const ticks = [
    { timestamp: 1000, pair: 'BTC/USD', orderBook: createOrderBook() },
    { timestamp: 2000, pair: 'BTC/USD', orderBook: createOrderBook() },
    { timestamp: 3000, pair: 'BTC/USD', orderBook: createOrderBook() }
  ];

  const count = provider.loadFromArray('BTC/USD', ticks);

  assert.strictEqual(count, 3);
  assert.strictEqual(provider.getPairs().length, 1);
});

test('HistoricalDataProvider - get tick at timestamp', () => {
  const provider = new HistoricalDataProvider();

  provider.loadFromArray('BTC/USD', [
    { timestamp: 1000, pair: 'BTC/USD', orderBook: createOrderBook() },
    { timestamp: 2000, pair: 'BTC/USD', orderBook: createOrderBook() },
    { timestamp: 3000, pair: 'BTC/USD', orderBook: createOrderBook() }
  ]);

  const tick = provider.getTickAt('BTC/USD', 2500);
  assert.ok(tick);
  assert.strictEqual(tick.timestamp, 2000); // Closest tick at or before 2500
});

test('HistoricalDataProvider - get ticks in range', () => {
  const provider = new HistoricalDataProvider();

  provider.loadFromArray('BTC/USD', [
    { timestamp: 1000, pair: 'BTC/USD', orderBook: createOrderBook() },
    { timestamp: 2000, pair: 'BTC/USD', orderBook: createOrderBook() },
    { timestamp: 3000, pair: 'BTC/USD', orderBook: createOrderBook() },
    { timestamp: 4000, pair: 'BTC/USD', orderBook: createOrderBook() }
  ]);

  const ticks = provider.getTicksInRange('BTC/USD', 1500, 3500);
  assert.strictEqual(ticks.length, 2); // Timestamps 2000 and 3000
});

test('HistoricalDataProvider - statistics', () => {
  const provider = new HistoricalDataProvider();

  provider.loadFromArray('BTC/USD', [
    { timestamp: 1000, pair: 'BTC/USD', orderBook: createOrderBook() },
    { timestamp: 2000, pair: 'BTC/USD', orderBook: createOrderBook() }
  ]);

  const stats = provider.getStats();

  assert.strictEqual(stats.pairs, 1);
  assert.strictEqual(stats.totalTicks, 2);
  assert.strictEqual(stats.startTime, 1000);
  assert.strictEqual(stats.endTime, 2000);
});

// ========== SimulatedExchangeAdapter Tests ==========

test('SimulatedExchangeAdapter - place limit order', () => {
  const exchange = new SimulatedExchangeAdapter({
    initialBalances: { USD: 10000, BTC: 0 }
  });

  const order = exchange.placeOrder({
    pair: 'BTC/USD',
    side: 'BUY',
    type: 'LIMIT',
    price: 100,
    amount: 1,
    timestamp: Date.now()
  });

  assert.ok(order);
  assert.strictEqual(order.status, 'OPEN');
});

test('SimulatedExchangeAdapter - place market order', () => {
  const exchange = new SimulatedExchangeAdapter({
    initialBalances: { USD: 10000, BTC: 0 }
  });

  const order = exchange.placeOrder({
    pair: 'BTC/USD',
    side: 'BUY',
    type: 'MARKET',
    amount: 1,
    timestamp: Date.now()
  });

  assert.ok(order);
  assert.strictEqual(order.type, 'MARKET');
});

test('SimulatedExchangeAdapter - insufficient balance rejection', () => {
  const exchange = new SimulatedExchangeAdapter({
    initialBalances: { USD: 10, BTC: 0 } // Only $10
  });

  const order = exchange.placeOrder({
    pair: 'BTC/USD',
    side: 'BUY',
    type: 'LIMIT',
    price: 100,
    amount: 1, // Requires $100
    timestamp: Date.now()
  });

  assert.strictEqual(order.status, 'REJECTED');
});

test('SimulatedExchangeAdapter - market order fill', () => {
  const exchange = new SimulatedExchangeAdapter({
    initialBalances: { USD: 10000, BTC: 0 }
  });

  const order = exchange.placeOrder({
    pair: 'BTC/USD',
    side: 'BUY',
    type: 'MARKET',
    amount: 5,
    timestamp: Date.now()
  });

  const orderBook = createOrderBook();
  const fills = exchange.processOrderMatching(order.id, orderBook, Date.now());

  assert.ok(fills.length > 0);
  assert.strictEqual(order.status, 'FILLED');
  assert.ok(order.filledAmount > 0);
});

test('SimulatedExchangeAdapter - limit order fill when price crosses', () => {
  const exchange = new SimulatedExchangeAdapter({
    initialBalances: { USD: 10000, BTC: 0 }
  });

  const order = exchange.placeOrder({
    pair: 'BTC/USD',
    side: 'BUY',
    type: 'LIMIT',
    price: 100.50, // Willing to buy at ask price
    amount: 5,
    timestamp: Date.now()
  });

  const orderBook = createOrderBook(); // Best ask is 100.50
  const fills = exchange.processOrderMatching(order.id, orderBook, Date.now());

  assert.ok(fills.length > 0);
  assert.ok(order.filledAmount > 0);
});

test('SimulatedExchangeAdapter - balance updates after fill', () => {
  const exchange = new SimulatedExchangeAdapter({
    initialBalances: { USD: 10000, BTC: 0 }
  });

  const initialUSD = exchange.getBalance('USD');

  const order = exchange.placeOrder({
    pair: 'BTC/USD',
    side: 'BUY',
    type: 'MARKET',
    amount: 5,
    timestamp: Date.now()
  });

  exchange.processOrderMatching(order.id, createOrderBook(), Date.now());

  const finalUSD = exchange.getBalance('USD');
  const finalBTC = exchange.getBalance('BTC');

  assert.ok(finalUSD < initialUSD); // Spent USD
  assert.ok(finalBTC > 0); // Received BTC
});

// ========== PerformanceAnalyzer Tests ==========

test('PerformanceAnalyzer - basic metrics', () => {
  const fills = [
    { pair: 'BTC/USD', side: 'BUY', amount: 1, price: 100, fee: 0.16, timestamp: 1000 },
    { pair: 'BTC/USD', side: 'SELL', amount: 1, price: 105, fee: 0.16, timestamp: 2000 }
  ];

  const metrics = PerformanceAnalyzer.analyze({
    fills,
    initialBalances: new Map([['USD', 10000]]),
    finalBalances: new Map([['USD', 10004.68]]), // +5 profit - 0.32 fees
    startTime: 0,
    endTime: 3000,
    startPrices: { 'BTC/USD': 100 },
    endPrices: { 'BTC/USD': 105 }
  });

  assert.ok(metrics.totalTrades > 0);
  assert.ok(metrics.totalPnL > 0);
});

test('PerformanceAnalyzer - win rate calculation', () => {
  const fills = [
    // Winning trade
    { pair: 'BTC/USD', side: 'BUY', amount: 1, price: 100, fee: 0.16, timestamp: 1000 },
    { pair: 'BTC/USD', side: 'SELL', amount: 1, price: 105, fee: 0.16, timestamp: 2000 },
    // Losing trade
    { pair: 'BTC/USD', side: 'BUY', amount: 1, price: 105, fee: 0.16, timestamp: 3000 },
    { pair: 'BTC/USD', side: 'SELL', amount: 1, price: 100, fee: 0.16, timestamp: 4000 }
  ];

  const metrics = PerformanceAnalyzer.analyze({
    fills,
    initialBalances: new Map([['USD', 10000]]),
    finalBalances: new Map([['USD', 9999.36]]),
    startTime: 0,
    endTime: 5000,
    startPrices: { 'BTC/USD': 100 },
    endPrices: { 'BTC/USD': 100 }
  });

  assert.strictEqual(metrics.totalTrades, 2);
  assert.strictEqual(metrics.winningTrades, 1);
  assert.strictEqual(metrics.losingTrades, 1);
  assert.strictEqual(metrics.winRate, 50);
});

// ========== BacktestingEngine Integration Tests ==========

test('BacktestingEngine - simple buy-and-hold strategy', async () => {
  // Create simple strategy that buys once and holds
  class BuyAndHoldStrategy {
    constructor() {
      this.exchange = null;
      this.hasBought = false;
    }

    setExchange(exchange) {
      this.exchange = exchange;
    }

    setClock(clock) {
      this.clock = clock;
    }

    async tick(timestamp, marketData) {
      if (!this.hasBought && marketData['BTC/USD']) {
        // Buy 0.1 BTC
        this.exchange.placeOrder({
          pair: 'BTC/USD',
          side: 'BUY',
          type: 'MARKET',
          amount: 0.1,
          timestamp
        });
        this.hasBought = true;
      }
    }
  }

  // Create engine
  const engine = new BacktestingEngine({
    startDate: '2024-01-01T00:00:00Z',
    endDate: '2024-01-01T00:01:00Z', // 1 minute
    initialBalances: { USD: 10000 },
    pairs: ['BTC/USD'],
    tickInterval: 10000 // 10 seconds
  });

  // Load sample data
  const sampleData = [];
  for (let i = 0; i < 6; i++) {
    sampleData.push({
      timestamp: Date.parse('2024-01-01T00:00:00Z') + (i * 10000),
      pair: 'BTC/USD',
      orderBook: createOrderBook()
    });
  }

  await engine.loadData({ pair: 'BTC/USD', array: sampleData });

  // Set strategy
  engine.setStrategy(new BuyAndHoldStrategy());

  // Run backtest
  const result = await engine.run();

  assert.ok(result);
  assert.ok(result.metrics);
  assert.ok(result.fills.length > 0);
});

test('BacktestingEngine - result report generation', async () => {
  const engine = new BacktestingEngine({
    startDate: '2024-01-01T00:00:00Z',
    endDate: '2024-01-01T00:00:30Z',
    initialBalances: { USD: 10000 },
    pairs: ['BTC/USD'],
    tickInterval: 10000
  });

  const sampleData = [
    {
      timestamp: Date.parse('2024-01-01T00:00:00Z'),
      pair: 'BTC/USD',
      orderBook: createOrderBook()
    },
    {
      timestamp: Date.parse('2024-01-01T00:00:10Z'),
      pair: 'BTC/USD',
      orderBook: createOrderBook()
    },
    {
      timestamp: Date.parse('2024-01-01T00:00:20Z'),
      pair: 'BTC/USD',
      orderBook: createOrderBook()
    }
  ];

  await engine.loadData({ pair: 'BTC/USD', array: sampleData });

  class DummyStrategy {
    setExchange() {}
    setClock() {}
    async tick() {}
  }

  engine.setStrategy(new DummyStrategy());

  const result = await engine.run();
  const report = result.getReport();

  assert.ok(report.includes('BACKTEST PERFORMANCE REPORT'));
  assert.ok(report.includes('Total Trades'));
  assert.ok(report.includes('Return'));
});

console.log('All BacktestingEngine tests completed!');
