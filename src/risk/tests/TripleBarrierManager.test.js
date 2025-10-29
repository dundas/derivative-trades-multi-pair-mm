/**
 * TripleBarrierManager Tests
 *
 * Comprehensive tests for triple barrier risk management
 */

import { test } from 'node:test';
import assert from 'node:assert';
import TripleBarrierManager from '../TripleBarrierManager.js';
import {
  TripleBarrierConfig,
  TrailingStop,
  BarrierStatus
} from '../BarrierConfig.js';

// Mock logger to suppress output during tests
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

function createTestPosition(overrides = {}) {
  return {
    id: 'test-position-1',
    pair: 'BTC/USD',
    side: 'LONG',
    entryPrice: 100.00,
    amount: 1.0,
    entryTime: Date.now(),
    ...overrides
  };
}

test('TripleBarrierManager - initialization', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  assert.ok(manager);
  assert.strictEqual(manager.monitoredPositions.size, 0);
  assert.ok(manager.defaultConfig);
});

test('TripleBarrierManager - add position', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });
  const position = createTestPosition();

  manager.addPosition(position);

  assert.strictEqual(manager.monitoredPositions.size, 1);
  assert.ok(manager.monitoredPositions.has('test-position-1'));
});

test('TripleBarrierManager - remove position', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });
  const position = createTestPosition();

  manager.addPosition(position);
  assert.strictEqual(manager.monitoredPositions.size, 1);

  manager.removePosition('test-position-1');
  assert.strictEqual(manager.monitoredPositions.size, 0);
});

test('TripleBarrierManager - stop loss hit (LONG)', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,  // 2% stop loss
    takeProfit: 0.05
  });

  const position = createTestPosition({ entryPrice: 100.00 });
  manager.addPosition(position, config);

  // Price drops 2% - should hit stop loss
  const status = manager.checkPosition('test-position-1', 98.00);

  assert.strictEqual(status.hitStopLoss, true);
  assert.strictEqual(status.hitTakeProfit, false);
  assert.strictEqual(status.getTriggeredBarrier(), 'STOP_LOSS');
  assert.ok(status.currentPnL < 0); // Negative P&L
});

test('TripleBarrierManager - stop loss hit (SHORT)', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,  // 2% stop loss
    takeProfit: 0.05
  });

  const position = createTestPosition({
    side: 'SHORT',
    entryPrice: 100.00
  });
  manager.addPosition(position, config);

  // Price rises 2% - should hit stop loss for SHORT
  const status = manager.checkPosition('test-position-1', 102.00);

  assert.strictEqual(status.hitStopLoss, true);
  assert.strictEqual(status.hitTakeProfit, false);
  assert.strictEqual(status.getTriggeredBarrier(), 'STOP_LOSS');
  assert.ok(status.currentPnL < 0); // Negative P&L for SHORT
});

test('TripleBarrierManager - take profit hit (LONG)', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.05  // 5% take profit
  });

  const position = createTestPosition({ entryPrice: 100.00 });
  manager.addPosition(position, config);

  // Price rises 5% - should hit take profit
  const status = manager.checkPosition('test-position-1', 105.00);

  assert.strictEqual(status.hitStopLoss, false);
  assert.strictEqual(status.hitTakeProfit, true);
  assert.strictEqual(status.getTriggeredBarrier(), 'TAKE_PROFIT');
  assert.ok(status.currentPnL > 0); // Positive P&L
});

test('TripleBarrierManager - take profit hit (SHORT)', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.05  // 5% take profit
  });

  const position = createTestPosition({
    side: 'SHORT',
    entryPrice: 100.00
  });
  manager.addPosition(position, config);

  // Price drops 5% - should hit take profit for SHORT
  const status = manager.checkPosition('test-position-1', 95.00);

  assert.strictEqual(status.hitStopLoss, false);
  assert.strictEqual(status.hitTakeProfit, true);
  assert.strictEqual(status.getTriggeredBarrier(), 'TAKE_PROFIT');
  assert.ok(status.currentPnL > 0); // Positive P&L for SHORT
});

test('TripleBarrierManager - time limit hit', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.05,
    timeLimit: 1  // 1 second time limit
  });

  const position = createTestPosition({ entryTime: Date.now() - 1500 }); // 1.5 seconds ago
  manager.addPosition(position, config);

  // Price hasn't moved much, but time limit exceeded
  const status = manager.checkPosition('test-position-1', 100.50);

  assert.strictEqual(status.hitTimeLimit, true);
  assert.strictEqual(status.getTriggeredBarrier(), 'TIME_LIMIT');
});

test('TripleBarrierManager - trailing stop activation and trigger (LONG)', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.10,
    trailingStop: new TrailingStop({
      activationPrice: 0.03,  // Activate at 3% profit
      trailingDelta: 0.01     // Trail by 1%
    })
  });

  const position = createTestPosition({ entryPrice: 100.00 });
  manager.addPosition(position, config);

  // Price at 102 - below activation threshold
  let status = manager.checkPosition('test-position-1', 102.00);
  assert.strictEqual(status.hitTrailingStop, false);

  // Price at 104 - activates trailing stop
  status = manager.checkPosition('test-position-1', 104.00);
  assert.strictEqual(status.hitTrailingStop, false); // Not triggered yet

  // Price drops to 102.96 (104 * 0.99) - should trigger trailing stop
  status = manager.checkPosition('test-position-1', 102.90);
  assert.strictEqual(status.hitTrailingStop, true);
  assert.strictEqual(status.getTriggeredBarrier(), 'TRAILING_STOP');
});

test('TripleBarrierManager - no barriers triggered', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.05,
    timeLimit: 300
  });

  const position = createTestPosition({ entryPrice: 100.00 });
  manager.addPosition(position, config);

  // Price moved slightly, but no barriers hit
  const status = manager.checkPosition('test-position-1', 101.00);

  assert.strictEqual(status.hitStopLoss, false);
  assert.strictEqual(status.hitTakeProfit, false);
  assert.strictEqual(status.hitTimeLimit, false);
  assert.strictEqual(status.isTriggered(), false);
  assert.strictEqual(status.getTriggeredBarrier(), null);
});

test('TripleBarrierManager - P&L calculation (LONG)', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  // Long position: bought at 100
  const pnl = manager.calculatePnL(100, 105, 'LONG', 2.0);
  assert.strictEqual(pnl, 10); // (105-100) * 2.0 = 10

  const pnlPercent = manager.calculatePnLPercent(100, 105, 'LONG');
  assert.strictEqual(pnlPercent, 0.05); // 5% profit
});

test('TripleBarrierManager - P&L calculation (SHORT)', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  // Short position: sold at 100
  const pnl = manager.calculatePnL(100, 95, 'SHORT', 2.0);
  assert.strictEqual(pnl, 10); // (100-95) * 2.0 = 10

  const pnlPercent = manager.calculatePnLPercent(100, 95, 'SHORT');
  assert.strictEqual(pnlPercent, 0.05); // 5% profit
});

test('TripleBarrierManager - stop loss price calculation', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  // Long: entry 100, stop loss 2%
  const longStopLoss = manager.calculateStopLossPrice(100, 'LONG', 0.02);
  assert.strictEqual(longStopLoss, 98); // 100 * (1 - 0.02)

  // Short: entry 100, stop loss 2%
  const shortStopLoss = manager.calculateStopLossPrice(100, 'SHORT', 0.02);
  assert.strictEqual(shortStopLoss, 102); // 100 * (1 + 0.02)
});

test('TripleBarrierManager - take profit price calculation', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  // Long: entry 100, take profit 5%
  const longTakeProfit = manager.calculateTakeProfitPrice(100, 'LONG', 0.05);
  assert.strictEqual(longTakeProfit, 105); // 100 * (1 + 0.05)

  // Short: entry 100, take profit 5%
  const shortTakeProfit = manager.calculateTakeProfitPrice(100, 'SHORT', 0.05);
  assert.strictEqual(shortTakeProfit, 95); // 100 * (1 - 0.05)
});

test('TripleBarrierManager - check all positions', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.05
  });

  // Add multiple positions
  manager.addPosition(createTestPosition({ id: 'pos1', pair: 'BTC/USD', entryPrice: 100 }), config);
  manager.addPosition(createTestPosition({ id: 'pos2', pair: 'ETH/USD', entryPrice: 200 }), config);
  manager.addPosition(createTestPosition({ id: 'pos3', pair: 'XRP/USD', entryPrice: 50 }), config);

  const currentPrices = {
    'BTC/USD': 98,   // Hit stop loss
    'ETH/USD': 210,  // Hit take profit
    'XRP/USD': 51    // No barrier hit
  };

  const triggeredStatuses = manager.checkAllPositions(currentPrices);

  assert.strictEqual(triggeredStatuses.length, 2); // pos1 and pos2
  assert.ok(triggeredStatuses.some(s => s.position.id === 'pos1' && s.hitStopLoss));
  assert.ok(triggeredStatuses.some(s => s.position.id === 'pos2' && s.hitTakeProfit));
});

test('TripleBarrierManager - barrier hit callback', () => {
  let callbackFired = false;
  let callbackPositionId = null;
  let callbackBarrier = null;

  const manager = new TripleBarrierManager({
    logger: mockLogger,
    onBarrierHit: (positionId, status) => {
      callbackFired = true;
      callbackPositionId = positionId;
      callbackBarrier = status.getTriggeredBarrier();
    }
  });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.05
  });

  const position = createTestPosition();
  manager.addPosition(position, config);

  // Trigger stop loss
  manager.checkPosition('test-position-1', 98.00);

  assert.strictEqual(callbackFired, true);
  assert.strictEqual(callbackPositionId, 'test-position-1');
  assert.strictEqual(callbackBarrier, 'STOP_LOSS');
});

test('TripleBarrierManager - statistics tracking', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.05
  });

  // Create positions and trigger different barriers
  manager.addPosition(createTestPosition({ id: 'pos1' }), config);
  manager.checkPosition('pos1', 98.00); // Stop loss

  manager.addPosition(createTestPosition({ id: 'pos2' }), config);
  manager.checkPosition('pos2', 105.00); // Take profit

  manager.addPosition(createTestPosition({ id: 'pos3' }), config);
  manager.checkPosition('pos3', 105.00); // Take profit

  const stats = manager.getStatistics();

  assert.strictEqual(stats.stopLossCount, 1);
  assert.strictEqual(stats.takeProfitCount, 2);
  assert.strictEqual(stats.totalExits, 3);
  assert.strictEqual(stats.activePositions, 3);
});

test('TripleBarrierManager - get summary', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.05
  });

  manager.addPosition(createTestPosition({ id: 'pos1', pair: 'BTC/USD' }), config);
  manager.addPosition(createTestPosition({ id: 'pos2', pair: 'ETH/USD' }), config);

  const summary = manager.getSummary();

  assert.strictEqual(summary.monitoredPositions, 2);
  assert.strictEqual(summary.positions.length, 2);
  assert.ok(summary.statistics);
  assert.ok(summary.positions.some(p => p.id === 'pos1'));
  assert.ok(summary.positions.some(p => p.id === 'pos2'));
});

test('TripleBarrierManager - pair-specific configuration', () => {
  const manager = new TripleBarrierManager({ logger: mockLogger });

  // BTC/USD should have default config
  const btcConfig = manager.getConfigForPair('BTC/USD');
  assert.ok(btcConfig);
  assert.strictEqual(btcConfig.stopLoss, 0.02); // BTC default

  // ETH/USD should have its own config
  const ethConfig = manager.getConfigForPair('ETH/USD');
  assert.ok(ethConfig);
  assert.strictEqual(ethConfig.stopLoss, 0.03); // ETH default (higher volatility)

  // Unknown pair should get DEFAULT config
  const unknownConfig = manager.getConfigForPair('UNKNOWN/USD');
  assert.ok(unknownConfig);
});

test('TripleBarrierConfig - validation', () => {
  // Valid config
  assert.doesNotThrow(() => {
    new TripleBarrierConfig({
      stopLoss: 0.02,
      takeProfit: 0.05
    });
  });

  // Invalid: negative stop loss
  assert.throws(() => {
    new TripleBarrierConfig({
      stopLoss: -0.02
    });
  }, /Stop loss must be positive/);

  // Invalid: stop loss >= take profit
  assert.throws(() => {
    new TripleBarrierConfig({
      stopLoss: 0.05,
      takeProfit: 0.02
    });
  }, /Stop loss should be less than take profit/);
});

test('TripleBarrierConfig - adjust for volatility', () => {
  const config = new TripleBarrierConfig({
    stopLoss: 0.02,
    takeProfit: 0.05,
    timeLimit: 300
  });

  // Adjust for 1.5x volatility
  const adjusted = config.adjustForVolatility(1.5);

  assert.ok(Math.abs(adjusted.stopLoss - 0.03) < 0.0001);  // ~0.03 (0.02 * 1.5)
  assert.ok(Math.abs(adjusted.takeProfit - 0.075) < 0.0001); // ~0.075 (0.05 * 1.5)
  assert.strictEqual(adjusted.timeLimit, 300); // Time limit not adjusted
});

test('TrailingStop - activation and tracking (LONG)', () => {
  const trailingStop = new TrailingStop({
    activationPrice: 0.03,  // Activate at 3% profit
    trailingDelta: 0.01     // Trail by 1%
  });

  // Not yet profitable enough
  let shouldExit = trailingStop.update(102, 100, 'LONG');
  assert.strictEqual(shouldExit, false);
  assert.strictEqual(trailingStop.activated, false);

  // Reaches activation threshold
  shouldExit = trailingStop.update(103, 100, 'LONG');
  assert.strictEqual(shouldExit, false);
  assert.strictEqual(trailingStop.activated, true);

  // Price continues up
  shouldExit = trailingStop.update(105, 100, 'LONG');
  assert.strictEqual(shouldExit, false);

  // Price drops below trailing threshold (105 * 0.99 = 103.95)
  shouldExit = trailingStop.update(103.90, 100, 'LONG');
  assert.strictEqual(shouldExit, true);
});

test('TrailingStop - get stop price', () => {
  const trailingStop = new TrailingStop({
    activationPrice: 0.03,
    trailingDelta: 0.01
  });

  // Not activated yet
  let stopPrice = trailingStop.getStopPrice('LONG');
  assert.strictEqual(stopPrice, null);

  // Activate and set highest price
  trailingStop.update(105, 100, 'LONG');

  // Should trail by 1%
  stopPrice = trailingStop.getStopPrice('LONG');
  assert.strictEqual(stopPrice, 103.95); // 105 * 0.99
});

console.log('All TripleBarrierManager tests completed!');
