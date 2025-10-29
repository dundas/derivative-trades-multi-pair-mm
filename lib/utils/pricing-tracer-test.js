/**
 * Pricing Tracer Test Utility
 * 
 * This utility script tests the OrderPricingTracer functionality
 * and generates sample trace logs for analysis.
 */

import { getOrderPricingTracer } from './order-pricing-tracer.js';

// Create a test session ID
const sessionId = `test-${Date.now()}`;
console.log(`Creating test trace log with session ID: ${sessionId}`);

// Initialize the tracer
const tracer = getOrderPricingTracer({ sessionId });

// Create a mock buy order
const mockBuyOrder = {
  id: `buy-${Date.now()}`,
  symbol: 'BTC/USD',
  side: 'buy',
  price: 65000,
  size: 0.001,
  timestamp: Date.now(),
  status: 'open'
};

// Create mock market conditions
const mockMarketConditions = {
  bestBid: 64950,
  bestAsk: 65050,
  midPrice: 65000,
  spread: 0.0015,
  orderBookBuffer: [
    { bid: 64950, ask: 65050 },
    { bid: 64940, ask: 65060 }
  ]
};

// Test the tracer functions
console.log('Testing OrderPricingTracer...');

// Trace buy order start
tracer.traceBuyOrderStart(mockBuyOrder, mockMarketConditions);
console.log('Traced buy order start');

// Trace buy order fill
const fillPrice = 64980;
tracer.traceBuyOrderFill(mockBuyOrder, fillPrice);
console.log('Traced buy order fill');

// Trace spread calculation
const spread = 0.002; // 0.2%
const spreadType = 'dynamic_market_based';
tracer.traceSpreadCalculation(mockBuyOrder, spread, spreadType, mockMarketConditions);
console.log('Traced spread calculation');

// Trace sell price calculation
const halfSpread = spread / 2;
const sellPrice = fillPrice * (1 + halfSpread);
tracer.traceSellPriceCalculation(mockBuyOrder, fillPrice, spread, halfSpread, sellPrice);
console.log('Traced sell price calculation');

// Create a mock sell order
const mockSellOrder = {
  id: `sell-${Date.now()}`,
  symbol: 'BTC/USD',
  side: 'sell',
  price: sellPrice,
  size: mockBuyOrder.size,
  timestamp: Date.now(),
  status: 'open',
  parentOrderId: mockBuyOrder.id
};

// Trace sell order creation
tracer.traceSellOrderCreation(mockBuyOrder, mockSellOrder);
console.log('Traced sell order creation');

// Trace an error
try {
  throw new Error('Test error in sell order creation');
} catch (error) {
  tracer.traceError(mockBuyOrder, 'sell_order_creation', error);
  console.log('Traced error');
}

console.log(`\nTest completed. Check the trace log file: pricing-trace-${sessionId}.log`);
