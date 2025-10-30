/**
 * Unit Tests for TakeProfitCore
 *
 * Tests the core take-profit pricing calculation logic including:
 * - Standard percentage-based pricing
 * - Aging-based pricing strategies
 * - Break-even calculations with fees
 * - Order ID generation
 * - Price/size formatting
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { TakeProfitCore } from './take-profit-core.js';

describe('TakeProfitCore', () => {
  let core;

  before(() => {
    core = new TakeProfitCore({
      defaultTakeProfitPercentage: 0.01, // 1%
      estimatedMakerFeeRate: 0.002, // 0.2%
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
      }
    });
  });

  describe('calculateStandardParameters', () => {
    it('should calculate standard take-profit parameters', async () => {
      const buyOrder = {
        id: 'test-order-1',
        symbol: 'ETH/USD',
        price: 2000,
        avgPrice: 2000,
        amount: 1.0,
        filled: 1.0,
        size: 1.0
      };

      const sessionData = {
        takeProfitPercentage: 0.01, // 1%
        pricePrecision: 2,
        sizePrecision: 8,
        actualExchangeFeeRates: {
          maker: 0.002,
          taker: 0.003
        },
        pricingStrategyConfig: {
          sell: {
            mode: 'TARGET_PROFIT',
            percentage: 0.01
          }
        }
      };

      const result = await core.calculateStandardParameters(buyOrder, sessionData);

      assert.ok(result.takeProfitPrice > buyOrder.price, 'Take-profit price should be higher than entry');
      assert.strictEqual(result.amount, 1.0, 'Amount should match buy order');
      assert.strictEqual(result.symbol, 'ETH/USD', 'Symbol should match');
      assert.ok(result.expectedProfit > 0, 'Expected profit should be positive');
    });

    it('should handle break-even mode', async () => {
      const buyOrder = {
        id: 'test-order-2',
        symbol: 'BTC/USD',
        price: 50000,
        avgPrice: 50000,
        amount: 0.1,
        filled: 0.1,
        size: 0.1
      };

      const sessionData = {
        pricePrecision: 1,
        sizePrecision: 8,
        actualExchangeFeeRates: {
          maker: 0.002,
          taker: 0.003
        },
        pricingStrategyConfig: {
          sell: {
            mode: 'BREAK_EVEN',
            percentage: 0
          }
        }
      };

      const result = await core.calculateStandardParameters(buyOrder, sessionData);

      assert.ok(result.takeProfitPrice > buyOrder.price, 'Break-even price should cover fees');
      assert.strictEqual(result.pricingStrategy, 'break-even');
    });

    it('should throw error when fee rates are missing', async () => {
      const buyOrder = {
        id: 'test-order-3',
        symbol: 'ETH/USD',
        price: 2000,
        avgPrice: 2000,
        amount: 1.0,
        filled: 1.0
      };

      const sessionData = {
        takeProfitPercentage: 0.01
        // Missing actualExchangeFeeRates
      };

      await assert.rejects(
        async () => await core.calculateStandardParameters(buyOrder, sessionData),
        /Missing fee data/,
        'Should throw error when fee data is missing'
      );
    });
  });

  describe('calculateTrueBreakEvenPrice', () => {
    it('should calculate break-even price covering both fees', () => {
      const buyPrice = 100;
      const buyFeeRate = 0.002; // 0.2%
      const sellFeeRate = 0.002; // 0.2%

      const breakEven = core.calculateTrueBreakEvenPrice(buyPrice, buyFeeRate, sellFeeRate);

      // Break-even should be: (100 * 1.002) / (1 - 0.002) = 100.401...
      assert.ok(breakEven > 100, 'Break-even should be higher than buy price');
      assert.ok(breakEven < 101, 'Break-even should be reasonable');
    });

    it('should throw error for invalid inputs', () => {
      assert.throws(
        () => core.calculateTrueBreakEvenPrice(0, 0.002, 0.002),
        /Buy price must be positive/
      );

      assert.throws(
        () => core.calculateTrueBreakEvenPrice(100, 0.002, 1),
        /Sell fee rate must be less than 100%/
      );
    });
  });

  describe('getAgeBasedAdjustment', () => {
    it('should return 1.0 for fresh positions', () => {
      assert.strictEqual(core.getAgeBasedAdjustment(3), 1.0);
      assert.strictEqual(core.getAgeBasedAdjustment(5.9), 1.0);
    });

    it('should return 0.7 for medium age positions', () => {
      assert.strictEqual(core.getAgeBasedAdjustment(12), 0.7);
      assert.strictEqual(core.getAgeBasedAdjustment(20), 0.7);
    });

    it('should return negative adjustment for critical positions', () => {
      assert.ok(core.getAgeBasedAdjustment(45) < 0);
      assert.ok(core.getAgeBasedAdjustment(50) < 0);
    });
  });

  describe('getPositionAgeCategory', () => {
    it('should categorize positions correctly', () => {
      assert.strictEqual(core.getPositionAgeCategory(3), 'fresh');
      assert.strictEqual(core.getPositionAgeCategory(12), 'medium');
      assert.strictEqual(core.getPositionAgeCategory(30), 'aging');
      assert.strictEqual(core.getPositionAgeCategory(40), 'old');
      assert.strictEqual(core.getPositionAgeCategory(45), 'critical');
      assert.strictEqual(core.getPositionAgeCategory(50), 'overdue');
    });
  });

  describe('roundPrice', () => {
    it('should round price to specified precision', () => {
      assert.strictEqual(core.roundPrice(100.12345, 2), 100.12);
      assert.strictEqual(core.roundPrice(100.12645, 2), 100.13);
      assert.strictEqual(core.roundPrice(100.1, 0), 100);
    });
  });

  describe('roundSize', () => {
    it('should floor size to specified precision', () => {
      assert.strictEqual(core.roundSize(1.123456789, 8), 1.12345678);
      assert.strictEqual(core.roundSize(1.99999, 4), 1.9999);
      assert.strictEqual(core.roundSize(1.999, 0), 1);
    });
  });

  describe('validateAndAdjustForPartialFill', () => {
    it('should detect partial fills', () => {
      const buyOrder = {
        id: 'test-order-4',
        amount: 10,
        filled: 5
      };

      const result = core.validateAndAdjustForPartialFill(buyOrder, {});

      assert.strictEqual(result.isPartialFill, true);
      assert.strictEqual(result.fillRatio, 0.5);
      assert.strictEqual(result.actualFilled, 5);
      assert.strictEqual(result.remainingAmount, 5);
    });

    it('should handle complete fills', () => {
      const buyOrder = {
        id: 'test-order-5',
        amount: 10,
        filled: 10
      };

      const result = core.validateAndAdjustForPartialFill(buyOrder, {});

      assert.strictEqual(result.isPartialFill, false);
      assert.strictEqual(result.fillRatio, 1);
    });

    it('should throw error for zero fills', () => {
      const buyOrder = {
        id: 'test-order-6',
        amount: 10,
        filled: 0
      };

      assert.throws(
        () => core.validateAndAdjustForPartialFill(buyOrder, {}),
        /has no fills/
      );
    });
  });

  describe('getMinimumOrderSize', () => {
    it('should return known minimums for major pairs', async () => {
      assert.strictEqual(await core.getMinimumOrderSize('ETH/USD'), 0.002);
      assert.strictEqual(await core.getMinimumOrderSize('BTC/USD'), 0.00005);
      assert.strictEqual(await core.getMinimumOrderSize('SOL/USD'), 0.02);
    });

    it('should return default for unknown pairs', async () => {
      assert.strictEqual(await core.getMinimumOrderSize('UNKNOWN/USD'), 0.002);
    });
  });
});
