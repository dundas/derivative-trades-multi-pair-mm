/**
 * OrderBookAnalyzer Tests
 *
 * Comprehensive tests for order book analytics functionality
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  OrderBookAnalyzer,
  OrderBookSnapshot,
  OrderBookLevel
} from '../OrderBookAnalyzer.js';

// Test data: Sample order book
function createSampleOrderBook() {
  const bids = [
    new OrderBookLevel(100.00, 10),  // Best bid
    new OrderBookLevel(99.50, 15),
    new OrderBookLevel(99.00, 20),
    new OrderBookLevel(98.50, 25),
    new OrderBookLevel(98.00, 30)
  ];

  const asks = [
    new OrderBookLevel(100.50, 10),  // Best ask
    new OrderBookLevel(101.00, 15),
    new OrderBookLevel(101.50, 20),
    new OrderBookLevel(102.00, 25),
    new OrderBookLevel(102.50, 30)
  ];

  return new OrderBookSnapshot(bids, asks);
}

test('OrderBookSnapshot - basic properties', () => {
  const orderBook = createSampleOrderBook();

  assert.strictEqual(orderBook.bestBid, 100.00);
  assert.strictEqual(orderBook.bestAsk, 100.50);
  assert.strictEqual(orderBook.midPrice, 100.25);
  assert.strictEqual(orderBook.spread, 0.50);
  assert.ok(Math.abs(orderBook.spreadBps - 49.88) < 0.1); // ~50 bps
});

test('OrderBookSnapshot - sorting', () => {
  // Create unsorted order book
  const bids = [
    new OrderBookLevel(99.00, 10),
    new OrderBookLevel(100.00, 10),  // Should be first after sorting
    new OrderBookLevel(98.00, 10)
  ];

  const asks = [
    new OrderBookLevel(101.00, 10),
    new OrderBookLevel(100.50, 10),  // Should be first after sorting
    new OrderBookLevel(102.00, 10)
  ];

  const orderBook = new OrderBookSnapshot(bids, asks);

  assert.strictEqual(orderBook.bestBid, 100.00);
  assert.strictEqual(orderBook.bestAsk, 100.50);
  assert.strictEqual(orderBook.bids[0].price, 100.00);
  assert.strictEqual(orderBook.asks[0].price, 100.50);
});

test('OrderBookAnalyzer.calculateVWAP - buy small volume', () => {
  const orderBook = createSampleOrderBook();
  const result = OrderBookAnalyzer.calculateVWAP(orderBook, true, 5);

  // Buying 5 units at best ask (100.50)
  assert.strictEqual(result.vwap, 100.50);
  assert.strictEqual(result.totalVolume, 5);
  assert.strictEqual(result.worstPrice, 100.50);
  assert.strictEqual(result.levels, 1);
});

test('OrderBookAnalyzer.calculateVWAP - buy large volume', () => {
  const orderBook = createSampleOrderBook();
  // Buy 35 units: 10@100.50 + 15@101.00 + 10@101.50
  const result = OrderBookAnalyzer.calculateVWAP(orderBook, true, 35);

  // Expected VWAP: (10*100.50 + 15*101.00 + 10*101.50) / 35
  const expectedVWAP = (10 * 100.50 + 15 * 101.00 + 10 * 101.50) / 35;

  assert.ok(Math.abs(result.vwap - expectedVWAP) < 0.01);
  assert.strictEqual(result.totalVolume, 35);
  assert.strictEqual(result.worstPrice, 101.50);
  assert.strictEqual(result.levels, 3);
  assert.ok(result.priceImpact > 0); // Should have price impact
});

test('OrderBookAnalyzer.calculateVWAP - sell small volume', () => {
  const orderBook = createSampleOrderBook();
  const result = OrderBookAnalyzer.calculateVWAP(orderBook, false, 5);

  // Selling 5 units at best bid (100.00)
  assert.strictEqual(result.vwap, 100.00);
  assert.strictEqual(result.totalVolume, 5);
  assert.strictEqual(result.worstPrice, 100.00);
  assert.strictEqual(result.levels, 1);
});

test('OrderBookAnalyzer.calculateVWAP - sell large volume', () => {
  const orderBook = createSampleOrderBook();
  // Sell 45 units: 10@100 + 15@99.50 + 20@99.00
  const result = OrderBookAnalyzer.calculateVWAP(orderBook, false, 45);

  const expectedVWAP = (10 * 100 + 15 * 99.50 + 20 * 99.00) / 45;

  assert.ok(Math.abs(result.vwap - expectedVWAP) < 0.01);
  assert.strictEqual(result.totalVolume, 45);
  assert.strictEqual(result.worstPrice, 99.00);
  assert.strictEqual(result.levels, 3);
});

test('OrderBookAnalyzer.getPriceForVolume', () => {
  const orderBook = createSampleOrderBook();

  // Buy 35 units - should reach 101.50
  const buyPrice = OrderBookAnalyzer.getPriceForVolume(orderBook, true, 35);
  assert.strictEqual(buyPrice, 101.50);

  // Sell 45 units - should reach 99.00
  const sellPrice = OrderBookAnalyzer.getPriceForVolume(orderBook, false, 45);
  assert.strictEqual(sellPrice, 99.00);
});

test('OrderBookAnalyzer.getVolumeForPrice - buy', () => {
  const orderBook = createSampleOrderBook();

  // Volume available at or below 101.00
  const volume = OrderBookAnalyzer.getVolumeForPrice(orderBook, true, 101.00);
  assert.strictEqual(volume, 25); // 10@100.50 + 15@101.00
});

test('OrderBookAnalyzer.getVolumeForPrice - sell', () => {
  const orderBook = createSampleOrderBook();

  // Volume available at or above 99.50
  const volume = OrderBookAnalyzer.getVolumeForPrice(orderBook, false, 99.50);
  assert.strictEqual(volume, 25); // 10@100.00 + 15@99.50
});

test('OrderBookAnalyzer.calculateDepth - 1% range', () => {
  const orderBook = createSampleOrderBook();

  // Mid price is 100.25, so 1% range is ±1.0025
  // Bid depth within 99.25: should include 100.00, 99.50 levels
  const bidDepth = OrderBookAnalyzer.calculateDepth(orderBook, true, 0.01);
  assert.strictEqual(bidDepth.volume, 25); // 10 + 15

  // Ask depth within 101.25: should include 100.50, 101.00 levels
  const askDepth = OrderBookAnalyzer.calculateDepth(orderBook, false, 0.01);
  assert.strictEqual(askDepth.volume, 25); // 10 + 15
});

test('OrderBookAnalyzer.calculateDepth - 5% range', () => {
  const orderBook = createSampleOrderBook();

  // 5% range is ±5.0125
  // Bid depth within 95.24: should include all bid levels
  const bidDepth = OrderBookAnalyzer.calculateDepth(orderBook, true, 0.05);
  assert.strictEqual(bidDepth.volume, 100); // All bids

  // Ask depth within 105.26: should include all ask levels
  const askDepth = OrderBookAnalyzer.calculateDepth(orderBook, false, 0.05);
  assert.strictEqual(askDepth.volume, 100); // All asks
});

test('OrderBookAnalyzer.estimateSlippage - small volume', () => {
  const orderBook = createSampleOrderBook();

  // Buy 5 units at best ask - minimal slippage
  const slippage = OrderBookAnalyzer.estimateSlippage(orderBook, true, 5);

  assert.strictEqual(slippage.slippageBps, 0); // No slippage at best price
  assert.strictEqual(slippage.slippagePercent, 0);
  assert.strictEqual(slippage.expectedPrice, 100.50);
  assert.strictEqual(slippage.referencePrice, 100.50);
  assert.strictEqual(slippage.executable, true);
});

test('OrderBookAnalyzer.estimateSlippage - large volume', () => {
  const orderBook = createSampleOrderBook();

  // Buy 35 units - crosses multiple levels
  const slippage = OrderBookAnalyzer.estimateSlippage(orderBook, true, 35);

  // VWAP should be higher than best ask
  assert.ok(slippage.expectedPrice > 100.50);
  assert.ok(slippage.slippageBps > 0);
  assert.ok(slippage.slippagePercent > 0);
  assert.strictEqual(slippage.executable, true);
});

test('OrderBookAnalyzer.estimateSlippage - insufficient liquidity', () => {
  const orderBook = createSampleOrderBook();

  // Try to buy more than available (>100 units)
  const slippage = OrderBookAnalyzer.estimateSlippage(orderBook, true, 150);

  assert.strictEqual(slippage.executable, false);
});

test('OrderBookAnalyzer.calculateMetrics', () => {
  const orderBook = createSampleOrderBook();
  const metrics = OrderBookAnalyzer.calculateMetrics(orderBook);

  assert.strictEqual(metrics.bestBid, 100.00);
  assert.strictEqual(metrics.bestAsk, 100.50);
  assert.strictEqual(metrics.midPrice, 100.25);
  assert.strictEqual(metrics.spread, 0.50);
  assert.ok(metrics.spreadBps > 0);
  assert.ok(metrics.bidDepth1pct > 0);
  assert.ok(metrics.askDepth1pct > 0);
  assert.strictEqual(metrics.totalBidLevels, 5);
  assert.strictEqual(metrics.totalAskLevels, 5);
  assert.ok(typeof metrics.imbalance === 'number');
});

test('OrderBookAnalyzer.calculateImbalance - balanced', () => {
  const orderBook = createSampleOrderBook();
  const imbalance = OrderBookAnalyzer.calculateImbalance(orderBook, 5);

  // Bid volume: 10+15+20+25+30 = 100
  // Ask volume: 10+15+20+25+30 = 100
  // Imbalance: (100-100)/200 = 0
  assert.strictEqual(imbalance, 0);
});

test('OrderBookAnalyzer.calculateImbalance - bullish', () => {
  const bids = [
    new OrderBookLevel(100.00, 50),  // More volume on bids
    new OrderBookLevel(99.50, 50)
  ];

  const asks = [
    new OrderBookLevel(100.50, 20),  // Less volume on asks
    new OrderBookLevel(101.00, 20)
  ];

  const orderBook = new OrderBookSnapshot(bids, asks);
  const imbalance = OrderBookAnalyzer.calculateImbalance(orderBook, 2);

  // Bid volume: 100, Ask volume: 40
  // Imbalance: (100-40)/140 = 0.43 (bullish)
  assert.ok(imbalance > 0.4 && imbalance < 0.5);
});

test('OrderBookAnalyzer.calculateImbalance - bearish', () => {
  const bids = [
    new OrderBookLevel(100.00, 20),  // Less volume on bids
    new OrderBookLevel(99.50, 20)
  ];

  const asks = [
    new OrderBookLevel(100.50, 50),  // More volume on asks
    new OrderBookLevel(101.00, 50)
  ];

  const orderBook = new OrderBookSnapshot(bids, asks);
  const imbalance = OrderBookAnalyzer.calculateImbalance(orderBook, 2);

  // Bid volume: 40, Ask volume: 100
  // Imbalance: (40-100)/140 = -0.43 (bearish)
  assert.ok(imbalance < -0.4 && imbalance > -0.5);
});

test('OrderBookAnalyzer.findOptimalSize - strict tolerance', () => {
  const orderBook = createSampleOrderBook();

  // Max 10 bps slippage - should only take best level
  const result = OrderBookAnalyzer.findOptimalSize(orderBook, true, 10);

  assert.ok(result.volume <= 10); // Only best ask level
  assert.ok(result.slippageBps <= 10);
});

test('OrderBookAnalyzer.findOptimalSize - loose tolerance', () => {
  const orderBook = createSampleOrderBook();

  // Max 500 bps slippage - should take multiple levels
  const result = OrderBookAnalyzer.findOptimalSize(orderBook, true, 500);

  assert.ok(result.volume > 10); // Multiple levels
  assert.ok(result.slippageBps <= 500);
});

test('OrderBookAnalyzer.createSnapshot - from raw data', () => {
  const bidsRaw = [
    [100.00, 10],
    [99.50, 15]
  ];

  const asksRaw = [
    [100.50, 10],
    [101.00, 15]
  ];

  const orderBook = OrderBookAnalyzer.createSnapshot(bidsRaw, asksRaw);

  assert.strictEqual(orderBook.bestBid, 100.00);
  assert.strictEqual(orderBook.bestAsk, 100.50);
  assert.strictEqual(orderBook.bids.length, 2);
  assert.strictEqual(orderBook.asks.length, 2);
});

test('OrderBookAnalyzer - empty order book', () => {
  const orderBook = new OrderBookSnapshot([], []);

  assert.strictEqual(orderBook.bestBid, null);
  assert.strictEqual(orderBook.bestAsk, null);
  assert.strictEqual(orderBook.midPrice, null);
  assert.strictEqual(orderBook.spread, null);
});

test('OrderBookAnalyzer.calculateVWAP - insufficient volume', () => {
  const orderBook = createSampleOrderBook();

  // Try to buy 1000 units (only 100 available)
  const result = OrderBookAnalyzer.calculateVWAP(orderBook, true, 1000);

  assert.ok(result.totalVolume < 1000); // Should return available volume
  assert.strictEqual(result.totalVolume, 100); // All asks
});

test('OrderBookAnalyzer.calculateVWAP - zero volume throws', () => {
  const orderBook = createSampleOrderBook();

  assert.throws(() => {
    OrderBookAnalyzer.calculateVWAP(orderBook, true, 0);
  }, /Target volume must be positive/);
});

test('OrderBookAnalyzer - price impact calculation', () => {
  const orderBook = createSampleOrderBook();

  // Small order - minimal impact
  const smallResult = OrderBookAnalyzer.calculateVWAP(orderBook, true, 1);
  assert.ok(smallResult.priceImpact < 0.001);

  // Large order - measurable impact
  const largeResult = OrderBookAnalyzer.calculateVWAP(orderBook, true, 50);
  assert.ok(largeResult.priceImpact > 0.005); // At least 0.5% impact
});

console.log('All OrderBookAnalyzer tests completed!');
