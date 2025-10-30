/**
 * Take-Profit Core - Shared Logic for Take-Profit Order Management
 * 
 * This module contains the critical business logic shared between:
 * - Settlement Service (batch processing, aging strategies)
 * - Market Maker Service (real-time processing, individual orders)
 * 
 * Key responsibilities:
 * - Pricing calculations (standard, aging-based, break-even)
 * - Order ID generation (consistent across services)
 * - Order parameter validation
 * - Price/size formatting and precision handling
 * - Order matching and correlation logic
 * 
 * This ensures consistent behavior and reduces maintenance burden.
 */

import { orderIdGenerator } from '../market-maker/utils/order-id-generator.js';

export class TakeProfitCore {
  constructor(config = {}) {
    this.config = {
      // Default pricing configuration
      defaultTakeProfitPercentage: config.defaultTakeProfitPercentage || 0.01, // 1%
      estimatedMakerFeeRate: config.estimatedMakerFeeRate || 0.002, // 0.2% (current Kraken maker fee)
      roundTripFeeMultiplier: config.roundTripFeeMultiplier || 2.1, // Buy fee + sell fee + buffer
      
      // Aging strategy configuration
      acceptLossAfterHours: config.acceptLossAfterHours || 42, // 42 hours
      
      // Order configuration
      minOrderSize: config.minOrderSize || 0.002,
      priceRoundingPrecision: config.priceRoundingPrecision || 2,
      sizeRoundingPrecision: config.sizeRoundingPrecision || 8,
      
      // Fee calculation
      includeFeeInProfitCalculation: config.includeFeeInProfitCalculation || true,
      
      ...config
    };
    
    this.logger = config.logger || console;
  }

  /**
   * Calculate take-profit parameters with context awareness
   */
  async calculateTakeProfitParameters(buyOrder, sessionData, context = 'standard') {
    if (context === 'settlement' && sessionData.enableAgingStrategy) {
      return this.calculateAgingBasedParameters(buyOrder, sessionData);
    }
    
    return this.calculateStandardParameters(buyOrder, sessionData);
  }

  /**
   * Calculate standard percentage-based take-profit parameters
   */
  async calculateStandardParameters(buyOrder, sessionData) {
    // NEW: Validate and adjust for partial fills
    const adjustedBuyOrder = this.validateAndAdjustForPartialFill(buyOrder, sessionData);
    
    // Get configuration
    const config = {
      takeProfitPercentage: sessionData.takeProfitPercentage || 
                           sessionData.pricingStrategyConfig?.sell?.percentage ||
                           this.config.defaultTakeProfitPercentage,
      sellMode: sessionData.pricingStrategyConfig?.sell?.mode || 'TARGET_PROFIT',
      includeFeeInProfitCalculation: this.config.includeFeeInProfitCalculation,
      pricePrecision: sessionData.pricePrecision || this.config.priceRoundingPrecision,
      sizePrecision: sessionData.sizePrecision || this.config.sizeRoundingPrecision
    };

    // Calculate entry price (use average fill price if available)
    const entryPrice = adjustedBuyOrder.avgPrice || adjustedBuyOrder.avgFillPrice || adjustedBuyOrder.price;
    
    // Calculate fee adjustment if needed
    let feeAdjustment = 0;
    if (config.includeFeeInProfitCalculation && buyOrder.fees) {
      const totalFees = Array.isArray(buyOrder.fees) 
        ? buyOrder.fees.reduce((sum, f) => sum + (f.amount || 0), 0)
        : buyOrder.feeAmount || 0;
      
      const filledAmount = buyOrder.size || buyOrder.filled || buyOrder.amount;
      feeAdjustment = filledAmount > 0 ? totalFees / filledAmount : 0;
    }
    
    // ✅ FIXED: Get actual fee rates from session data - NO HARDCODED FALLBACKS
    const actualMakerFee = sessionData.actualExchangeFeeRates?.maker || 
                          sessionData.currentFees?.makerFee;
    const actualTakerFee = sessionData.actualExchangeFeeRates?.taker || 
                          sessionData.currentFees?.takerFee;
    
    if (!actualMakerFee || !actualTakerFee) {
      throw new Error(`Missing fee data for take-profit calculation. Session must include actualExchangeFeeRates or currentFees. Found: maker=${actualMakerFee}, taker=${actualTakerFee}`);
    }
    
    let makerFeeRate = actualMakerFee;
    let takerFeeRate = actualTakerFee;

    // Calculate effective entry price with fees
    let effectiveEntryPrice = entryPrice;
    
    // ✅ FIXED: Proper round-trip calculations for TARGET_PROFIT and BREAK_EVEN modes
    let takeProfitPrice;
    let pricingStrategy = 'standard';
    
    if (config.sellMode === 'BREAK_EVEN') {
      // ✅ FIXED: Pure break-even using round-trip calculation
      const breakEvenPrice = this.calculateTrueBreakEvenPrice(effectiveEntryPrice, makerFeeRate, makerFeeRate);
      
      // For BREAK_EVEN mode, add any configured percentage on top of break-even
      const strategicPercentage = config.takeProfitPercentage || 0;
      takeProfitPrice = strategicPercentage > 0 ? breakEvenPrice * (1 + strategicPercentage) : breakEvenPrice;
      pricingStrategy = 'break-even';
      
      this.logger.debug('[TakeProfitCore] BREAK_EVEN pricing calculated:', {
        entryPrice: effectiveEntryPrice,
        makerFeeRate,
        breakEvenPrice,
        strategicPercentage,
        finalPrice: takeProfitPrice,
        explanation: 'Round-trip break-even + strategic percentage'
      });
      
    } else if (config.sellMode === 'TARGET_PROFIT') {
      // ✅ FIXED: TARGET_PROFIT = break-even + profit percentage (proper round-trip)
      const breakEvenPrice = this.calculateTrueBreakEvenPrice(effectiveEntryPrice, makerFeeRate, makerFeeRate);
      takeProfitPrice = breakEvenPrice * (1 + config.takeProfitPercentage);
      pricingStrategy = 'target-profit';
      
      this.logger.debug('[TakeProfitCore] TARGET_PROFIT pricing calculated:', {
        entryPrice: effectiveEntryPrice,
        makerFeeRate,
        breakEvenPrice,
        profitPercentage: config.takeProfitPercentage,
        finalPrice: takeProfitPrice,
        explanation: 'Round-trip break-even + profit percentage'
      });
      
    } else {
      // ✅ FIXED: For other modes, still consider fees in simple markup
      // Use round-trip fee adjustment for entry markup modes
      const roundTripFeeAdjustment = (makerFeeRate + makerFeeRate); // Buy + sell fees
      takeProfitPrice = effectiveEntryPrice * (1 + config.takeProfitPercentage + roundTripFeeAdjustment);
      pricingStrategy = 'entry-markup-fee-aware';
      
      this.logger.debug('[TakeProfitCore] Fee-aware entry markup calculated:', {
        entryPrice: effectiveEntryPrice,
        roundTripFeeAdjustment,
        profitPercentage: config.takeProfitPercentage,
        finalPrice: takeProfitPrice,
        explanation: 'Entry price + profit + round-trip fees'
      });
    }
    
    // Format price using Kraken rules
    try {
      takeProfitPrice = await this.formatPriceUsingKrakenRules(takeProfitPrice, buyOrder.symbol);
    } catch (error) {
      this.logger.warn(`Failed to use Kraken price formatting, falling back to generic rounding: ${error.message}`);
      takeProfitPrice = this.roundPrice(takeProfitPrice, config.pricePrecision);
    }
    
    // Calculate amount - use actual filled amount from adjusted order
    const filledAmount = adjustedBuyOrder.actualFilled;
    const amount = this.roundSize(filledAmount, config.sizePrecision);
    
    // ✅ IMPROVED: Calculate expected profit using actual fee rates
    const grossProfit = (takeProfitPrice - effectiveEntryPrice) * amount;
    const estimatedTPFee = takeProfitPrice * amount * makerFeeRate; // Use actual maker fee rate
    const expectedProfit = grossProfit - estimatedTPFee;
    
    return {
      entryPrice,
      effectiveEntryPrice,
      takeProfitPrice,
      amount,
      symbol: buyOrder.symbol,
      takeProfitPercentage: config.takeProfitPercentage,
      expectedProfit,
      grossProfit,
      estimatedFee: estimatedTPFee,
      feeAdjustment,
      pricePrecision: config.pricePrecision,
      sizePrecision: config.sizePrecision,
      pricingStrategy,
      context: 'market-maker',
      // ✅ NEW: Include actual fee rates used in calculation
      actualFeeRates: {
        maker: makerFeeRate,
        taker: takerFeeRate,
        source: sessionData.actualExchangeFeeRates ? 'exchange_api' : 
               sessionData.currentFees ? 'session_data' : 'estimated'
      },
      sellMode: config.sellMode,
      includedFees: config.includeFeeInProfitCalculation,
      // Add partial fill metadata to result
      partialFillData: {
        isPartialFill: adjustedBuyOrder.isPartialFill,
        fillRatio: adjustedBuyOrder.fillRatio,
        actualFilled: adjustedBuyOrder.actualFilled,
        originalAmount: adjustedBuyOrder.originalAmount
      }
    };
  }

  /**
   * Validate and adjust order data for partial fills
   * @param {Object} buyOrder - Original buy order
   * @param {Object} sessionData - Session configuration
   * @returns {Object} Enhanced order with partial fill data
   */
  validateAndAdjustForPartialFill(buyOrder, sessionData) {
    const amount = parseFloat(buyOrder.amount || buyOrder.size || 0);
    const filled = parseFloat(buyOrder.filled || 0);
    
    if (filled === 0) {
      throw new Error(`Buy order ${buyOrder.id} has no fills - cannot create take-profit`);
    }
    
    const fillRatio = amount > 0 ? filled / amount : 0;
    const isPartialFill = fillRatio > 0 && fillRatio < 1;
    
    if (isPartialFill) {
      this.logger.warn(`Partial fill detected: ${filled}/${amount} (${(fillRatio * 100).toFixed(1)}%) for order ${buyOrder.id}`);
    }
    
    return {
      ...buyOrder,
      actualFilled: filled,
      originalAmount: amount,
      fillRatio,
      isPartialFill,
      fillPercentage: fillRatio * 100,
      remainingAmount: amount - filled
    };
  }

  /**
   * Calculate minimum fill threshold for a symbol
   * @param {string} symbol - Trading pair symbol
   * @returns {number} Minimum meaningful fill amount
   */
  getMinimumFillThreshold(symbol) {
    const minimums = {
      'ETH/USD': 0.002,
      'BTC/USD': 0.00005,
      'SOL/USD': 0.02,
      'ADA/USD': 4.4,
      'DOT/USD': 0.6,
      'UNI/USD': 0.3,
      'LINK/USD': 0.2,
      'AVAX/USD': 0.1,
      'ATOM/USD': 0.5,
      'DOGE/USD': 13
    };
    return minimums[symbol] || 0.002;
  }

  /**
   * Enhanced order status detection
   * @param {Object} order - Order to check
   * @returns {string} Accurate order status
   */
  calculateFillStatus(order) {
    const amount = parseFloat(order.amount || order.size || 0);
    const filled = parseFloat(order.filled || 0);
    
    if (filled === 0) return 'OPEN';
    if (filled >= amount) return 'FILLED';
    if (filled > 0 && filled < amount) return 'PARTIALLY_FILLED';
    return order.status || 'UNKNOWN';
  }

  /**
   * Calculate aging-based take-profit parameters (settlement mode)
   */
  async calculateAgingBasedParameters(buyOrder, sessionData, exchangeAdapter = null) {
    try {
      // Calculate position age
      const buyTimestamp = buyOrder.timestamp || buyOrder.filledAt || buyOrder.createdAt;
      const now = Date.now();
      const positionAgeMs = now - buyTimestamp;
      const positionAgeHours = positionAgeMs / (1000 * 60 * 60);
      
      // Get age category and adjustment
      const ageCategory = this.getPositionAgeCategory(positionAgeHours);
      const ageAdjustment = this.getAgeBasedAdjustment(positionAgeHours);
      
      // Get base markup from various sources
      let baseMarkup = this.config.defaultTakeProfitPercentage;
      let markupSource = 'default';
      
      if (buyOrder.existingSellPrice && buyOrder.price) {
        baseMarkup = (buyOrder.existingSellPrice / buyOrder.price) - 1;
        markupSource = 'existing sell order';
      } else if (sessionData.takeProfitPercentage) {
        baseMarkup = sessionData.takeProfitPercentage;
        markupSource = 'session takeProfitPercentage';
      } else if (sessionData.pricingStrategyConfig && sessionData.pricingStrategyConfig.sell && sessionData.pricingStrategyConfig.sell.percentage !== undefined) {
        baseMarkup = sessionData.pricingStrategyConfig.sell.percentage;
        markupSource = `pricingStrategyConfig (${sessionData.pricingStrategyConfig.sell.mode})`;
      }
      
      // Apply age-based adjustment
      let adjustedMarkup = baseMarkup * ageAdjustment;
      let pricingStrategy = 'aging';
      
      // ✅ FIXED: Calculate base parameters FIRST before critical position checks
      const entryPrice = buyOrder.avgPrice || buyOrder.avgFillPrice || buyOrder.price;
      
      // ✅ MAKER-OPTIMIZED: Use market-aware pricing for cost optimization
      let takeProfitPrice;
      let makerOptimized = false;
      let orderBookPrice = null;
      
      // Try to get market-aware pricing first
      if (exchangeAdapter && typeof exchangeAdapter.getOrderBook === 'function') {
        try {
          const symbol = sessionData.tradingPair || sessionData.symbol;
          this.logger.info(`🎯 Fetching order book for market-aware take-profit pricing: ${symbol}`);
          
          const orderBook = await exchangeAdapter.getOrderBook(symbol);
          const bestBid = parseFloat(orderBook.bids[0][0]);
          const bestAsk = parseFloat(orderBook.asks[0][0]);
          const spread = bestAsk - bestBid;
          const spreadPercent = (spread / bestAsk) * 100;
          
          this.logger.info(`📊 Order book data:`, {
            bestBid: bestBid.toFixed(2),
            bestAsk: bestAsk.toFixed(2),
            spread: spread.toFixed(4),
            spreadPercent: spreadPercent.toFixed(3) + '%'
          });
          
          // Get tick size for precise maker pricing
          let tickSize = 0.01; // Default fallback
          try {
            if (typeof exchangeAdapter.getAssetPairs === 'function') {
              const assetPairs = await exchangeAdapter.getAssetPairs(symbol);
              // Extract tick size from Kraken asset pairs response
              tickSize = Math.pow(10, -(assetPairs.pair_decimals || 2));
            }
          } catch (tickError) {
            this.logger.warn(`Could not fetch tick size, using default ${tickSize}:`, tickError.message);
          }
          
          // Calculate entry-based target price first
          const entryBasedTarget = entryPrice * (1 + adjustedMarkup);
          
          // For SELL orders: Price just above best bid for maker execution
          const makerPrice = bestBid + tickSize;
          
          // Validate spread isn't too wide (safety check)
          if (spreadPercent > 2) {
            this.logger.warn(`⚠️ Spread too wide (${spreadPercent.toFixed(2)}%), falling back to entry-based pricing`);
            takeProfitPrice = entryBasedTarget;
            pricingStrategy = 'aging-fallback-wide-spread';
          } else {
            // Choose the pricing strategy based on market conditions
            
            // Check if market has moved above our target take-profit price
            if (bestBid > entryBasedTarget) {
              // Market has moved favorably - place order above current market
              // Use ask + tick to ensure it sits on the book as a maker order
              takeProfitPrice = bestAsk + tickSize;
              orderBookPrice = takeProfitPrice;
              makerOptimized = true;
              pricingStrategy = 'maker-optimized-above-target';
              
              this.logger.info(`🚀 Market above target - using maker pricing above ask:`, {
                entryPrice: entryPrice.toFixed(2),
                entryBasedTarget: entryBasedTarget.toFixed(2),
                currentBid: bestBid.toFixed(2),
                currentAsk: bestAsk.toFixed(2),
                takeProfitPrice: takeProfitPrice.toFixed(2),
                profitVsEntry: ((takeProfitPrice / entryPrice - 1) * 100).toFixed(2) + '%',
                strategy: 'maker-optimized-above-target'
              });
            } else if (makerPrice >= entryPrice * 1.001) { // At least 0.1% profit
              takeProfitPrice = makerPrice;
              orderBookPrice = makerPrice;
              makerOptimized = true;
              pricingStrategy = 'maker-optimized';
              
              this.logger.info(`✅ Using maker-optimized pricing:`, {
                entryPrice: entryPrice.toFixed(2),
                entryBasedTarget: entryBasedTarget.toFixed(2),
                makerPrice: makerPrice.toFixed(2),
                profitVsEntry: ((makerPrice / entryPrice - 1) * 100).toFixed(2) + '%',
                strategy: 'maker-optimized'
              });
            } else {
              // Market price too low for profitable maker execution
              takeProfitPrice = Math.max(entryBasedTarget, bestBid + (tickSize * 2));
              pricingStrategy = 'aging-with-market-buffer';
              
              this.logger.info(`📈 Market price too low, using buffered pricing:`, {
                entryPrice: entryPrice.toFixed(2),
                makerPrice: makerPrice.toFixed(2),
                bufferedPrice: takeProfitPrice.toFixed(2),
                reason: 'insufficient-profit-margin'
              });
            }
          }
          
        } catch (orderBookError) {
          this.logger.warn(`⚠️ Could not fetch order book data, falling back to entry-based pricing:`, orderBookError.message);
          takeProfitPrice = entryPrice * (1 + adjustedMarkup);
          pricingStrategy = 'aging-fallback-no-orderbook';
        }
      } else {
        this.logger.info(`📈 No exchange adapter available, using entry-based pricing`);
        
        // Fallback to original pricing logic
        if (sessionData.pricingStrategyConfig && sessionData.pricingStrategyConfig.sell && sessionData.actualExchangeFeeRates) {
          // Use PricingEngine for proper TARGET_PROFIT calculation
          const { default: PricingEngine } = await import('../../lib/trading/pricing-engine.js');
          
          const pricingEngine = new PricingEngine({
            pricingStrategyConfig: {
              buy: sessionData.pricingStrategyConfig.buy || { mode: 'EDGE_OFFSET', percentage: 0.003 },
              sell: {
                mode: 'TARGET_PROFIT',  // Always use TARGET_PROFIT for proper fee-aware calculation
                percentage: adjustedMarkup  // Use the age-adjusted markup as the target profit
              }
            },
            actualExchangeFeeRates: sessionData.actualExchangeFeeRates,
            logger: this.logger
          });
          
          takeProfitPrice = pricingEngine.calculateGrossOrderPrice({
            side: 'sell',
            midPrice: entryPrice, // Use entry price as reference for take-profit
            spread: 0, // Not needed for entry-price based calculation
            entryPrice: entryPrice, // CRITICAL: Pass entry price for TARGET_PROFIT mode
            orderType: 'limit',
            isTakeProfit: true // CRITICAL: Mark as take-profit to enforce entry-based pricing
          });
          
          pricingStrategy = 'aging-pricing-engine';
          this.logger.info(`Using PricingEngine for TARGET_PROFIT calculation`, {
            entryPrice,
            adjustedMarkup: (adjustedMarkup * 100).toFixed(2) + '%',
            takeProfitPrice,
            feeAware: true,
            method: 'PricingEngine.calculateGrossOrderPrice'
          });
        } else {
          // Simple fallback calculation
          takeProfitPrice = entryPrice * (1 + adjustedMarkup);
          pricingStrategy = 'aging-simple-fallback';
          this.logger.warn(`Using fallback simple calculation - missing PricingEngine requirements`, {
            hasPricingStrategyConfig: !!sessionData.pricingStrategyConfig,
            hasActualExchangeFeeRates: !!sessionData.actualExchangeFeeRates,
            entryPrice,
            adjustedMarkup: (adjustedMarkup * 100).toFixed(2) + '%',
            takeProfitPrice
          });
        }
      }
      
      // For critical positions, ensure we at least try to cover fees
      if (positionAgeHours >= this.config.acceptLossAfterHours) {
        // ✅ FIXED: Use proper round-trip fee calculation for critical positions - NO HARDCODED FALLBACKS
        const actualMakerFee = sessionData.actualExchangeFeeRates?.maker || 
                              sessionData.currentFees?.makerFee;
        const actualTakerFee = sessionData.actualExchangeFeeRates?.taker || 
                              sessionData.currentFees?.takerFee;
        
        if (!actualMakerFee || !actualTakerFee) {
          throw new Error(`Missing fee data for critical position handling. Session must include actualExchangeFeeRates or currentFees for position aged ${positionAgeHours} hours`);
        }
        
        // ✅ FIXED: Use proper round-trip calculation with correct variable names
        const breakEvenPrice = this.calculateTrueBreakEvenPrice(entryPrice, actualMakerFee, actualMakerFee);
        takeProfitPrice = Math.max(takeProfitPrice, breakEvenPrice);
        
        if (takeProfitPrice === breakEvenPrice) {
          pricingStrategy = 'aging-break-even';
        }
      }
      
      // Format price using Kraken rules
      try {
        takeProfitPrice = await this.formatPriceUsingKrakenRules(takeProfitPrice, buyOrder.symbol);
      } catch (error) {
        this.logger.warn(`Failed to use Kraken price formatting, falling back to generic rounding: ${error.message}`);
        takeProfitPrice = this.roundPrice(takeProfitPrice, sessionData.pricePrecision || 2);
      }
      
      // Calculate amount
      const rawAmount = buyOrder.size || buyOrder.filled || buyOrder.amount;
      const sizePrecision = sessionData.sizePrecision || 8;
      let finalAmount = this.roundSize(rawAmount, sizePrecision);
      
      // Handle allocated amount from batch processing
      if (buyOrder.allocatedAmount && buyOrder.batchAllocated) {
        finalAmount = this.roundSize(buyOrder.allocatedAmount, sizePrecision);
      }
      
      // Calculate profits
      const grossProfit = (takeProfitPrice - entryPrice) * finalAmount;
      
      // Use actual fees if available, otherwise fall back to estimated rate
      let sellFeeRate = this.config.estimatedMakerFeeRate;
      if (sessionData.actualExchangeFeeRates?.maker) {
        sellFeeRate = sessionData.actualExchangeFeeRates.maker;
      } else if (sessionData.currentFees?.makerFee) {
        sellFeeRate = sessionData.currentFees.makerFee;
      }
      
      const estimatedTPFee = takeProfitPrice * finalAmount * sellFeeRate;
      const expectedProfit = grossProfit - estimatedTPFee;
      
      this.logger.info(`Aging-based pricing calculated`, {
        positionAge: positionAgeHours.toFixed(1) + 'h',
        ageCategory,
        baseMarkup: (baseMarkup * 100).toFixed(2) + '%',
        markupSource,
        ageAdjustment: (ageAdjustment * 100).toFixed(0) + '%',
        finalMarkup: (adjustedMarkup * 100).toFixed(2) + '%',
        price: takeProfitPrice,
        amount: finalAmount,
        expectedProfit: expectedProfit > 0 ? `+$${expectedProfit.toFixed(2)}` : `-$${Math.abs(expectedProfit).toFixed(2)}`
      });
      
      return {
        entryPrice,
        effectiveEntryPrice: entryPrice,
        takeProfitPrice,
        amount: finalAmount,
        symbol: buyOrder.symbol,
        takeProfitPercentage: adjustedMarkup,
        expectedProfit,
        grossProfit,
        estimatedFee: estimatedTPFee,
        feeAdjustment: 0,
        pricePrecision: sessionData.pricePrecision || 2,
        sizePrecision: sessionData.sizePrecision || 8,
        pricingStrategy,
        context: 'settlement',
        // Additional aging metadata
        positionAgeHours,
        ageCategory,
        ageAdjustment,
        baseMarkup,
        markupSource,
        adjustedMarkup,
        // Batch processing metadata
        batchAllocated: buyOrder.batchAllocated || false,
        allocationType: buyOrder.allocationType,
        originalAmount: buyOrder.originalSize,
        // Maker optimization metadata
        makerOptimized,
        orderBookPrice,
        usePostOnly: makerOptimized // Use post-only for maker-optimized orders
      };
      
    } catch (error) {
      this.logger.error('Error in aging-based calculation, falling back to standard:', error);
      return this.calculateStandardParameters(buyOrder, sessionData);
    }
  }

  /**
   * Generate take-profit order ID using consistent logic
   */
  generateTakeProfitOrderId(sessionId, buyOrderId, context = 'standard') {
    if (context === 'settlement') {
      return orderIdGenerator.generateSettlementOrderId(sessionId, buyOrderId);
    }
    
    return orderIdGenerator.generateTakeProfitOrderId(buyOrderId);
  }

  /**
   * Format take-profit order with context-specific metadata
   */
  formatTakeProfitOrder(tpParams, sessionData, buyOrder, context = 'standard') {
    const timestamp = Date.now();
    const sessionId = sessionData.sessionId || sessionData.id;
    
    // Generate consistent order ID
    const clientOrderId = this.generateTakeProfitOrderId(sessionId, buyOrder.id, context);
    
    const order = {
      symbol: buyOrder.symbol,
      side: 'sell',
      type: 'limit',
      price: tpParams.takeProfitPrice,
      amount: tpParams.amount,
      size: tpParams.amount,
      sessionId: sessionId,
      parentOrderId: buyOrder.id,
      purpose: 'take-profit',
      clientOrderId,
      metadata: {
        entryPrice: tpParams.entryPrice,
        takeProfitPercentage: tpParams.takeProfitPercentage,
        expectedProfit: tpParams.expectedProfit,
        createdBy: `take-profit-${context}`,
        context: context,
        pricingStrategy: tpParams.pricingStrategy,
        buyOrderId: buyOrder.id,
        buyOrderInternalId: buyOrder.internalId,
        timestamp,
        // Context-specific metadata
        ...(tpParams.positionAgeHours && {
          positionAgeHours: tpParams.positionAgeHours,
          ageCategory: tpParams.ageCategory,
          ageAdjustment: tpParams.ageAdjustment,
          baseMarkup: tpParams.baseMarkup,
          adjustedMarkup: tpParams.adjustedMarkup,
          markupSource: tpParams.markupSource
        })
      }
    };

    // Context-specific expiration
    if (context === 'settlement') {
      const settlementExpiration = 21600000; // 6 hours
      order.expiresAt = timestamp + settlementExpiration;
      order.ttlMs = settlementExpiration;
    } else {
      const standardExpiration = 900000; // 15 minutes
      order.expiresAt = timestamp + standardExpiration;
      order.ttlMs = standardExpiration;
    }

    return order;
  }

  /**
   * Validate take-profit order parameters
   */
  async validateTakeProfitOrder(tpParams, sessionId = null) {
    if (!tpParams.takeProfitPrice || tpParams.takeProfitPrice <= 0) {
      throw new Error('Invalid take-profit price');
    }

    if (!tpParams.amount || tpParams.amount <= 0) {
      throw new Error('Invalid take-profit amount');
    }

    // Get dynamic minimum order size
    let dynamicMinimum;
    try {
      dynamicMinimum = await this.getMinimumOrderSize(tpParams.symbol || 'ETH/USD', sessionId);
    } catch (error) {
      this.logger.warn(`Failed to get dynamic minimum for ${tpParams.symbol}, using fallback: ${error.message}`);
      dynamicMinimum = this.config.minOrderSize;
    }

    if (tpParams.amount < dynamicMinimum) {
      throw new Error(`Amount ${tpParams.amount} is below minimum order size ${dynamicMinimum} for ${tpParams.symbol || 'trading pair'}`);
    }

    // For settlement context with aging, allow prices below entry (accepting losses)
    if (tpParams.context === 'settlement' && tpParams.positionAgeHours >= this.config.acceptLossAfterHours) {
      if (tpParams.takeProfitPrice <= 0) {
        throw new Error('Take-profit price must be positive');
      }
    } else if (tpParams.takeProfitPrice <= tpParams.entryPrice) {
      throw new Error('Take-profit price must be higher than entry price');
    }
  }

  /**
   * Get minimum order size for a symbol
   */
  async getMinimumOrderSize(symbol, sessionId = null) {
    // Fallback to hardcoded minimums (LIVE API VERIFIED)
    const fallbackMinimums = {
      'ETH/USD': 0.002,
      'BTC/USD': 0.00005,
      'SOL/USD': 0.02,
      'ADA/USD': 4.4,
      'DOT/USD': 0.6,
      'UNI/USD': 0.3,
      'LINK/USD': 0.2,
      'AVAX/USD': 0.1,
      'ATOM/USD': 0.5,
      'DOGE/USD': 13
    };
    
    return fallbackMinimums[symbol] || 0.002;
  }

  /**
   * Calculate true break-even price that covers both buy and sell fees
   */
  calculateTrueBreakEvenPrice(buyPrice, buyFeeRate, sellFeeRate) {
    if (buyPrice <= 0) {
      throw new Error('Buy price must be positive');
    }
    
    if (sellFeeRate >= 1) {
      throw new Error('Sell fee rate must be less than 100%');
    }
    
    return (buyPrice * (1 + buyFeeRate)) / (1 - sellFeeRate);
  }

  /**
   * Format price using Kraken's official precision rules
   */
  async formatPriceUsingKrakenRules(price, symbol) {
    try {
      const { KrakenRESTClient } = await import('../../lib/exchanges/KrakenRESTClient.js');
      const formattedStr = KrakenRESTClient.formatPrice(price, symbol);
      return parseFloat(formattedStr);
    } catch (error) {
      throw new Error(`Failed to format price using Kraken rules: ${error.message}`);
    }
  }

  /**
   * Get age-based adjustment factor
   */
  getAgeBasedAdjustment(positionAgeHours) {
    if (positionAgeHours < 6) {
      return 1.0; // Fresh: Keep original markup
    } else if (positionAgeHours < 24) {
      return 0.7; // Medium: 70% of original markup
    } else if (positionAgeHours < 36) {
      return 0.3; // Aging: 30% of original markup
    } else if (positionAgeHours < 42) {
      return 0.1; // Old: 10% of original markup
    } else if (positionAgeHours < 48) {
      return -0.5; // Critical: Negative adjustment (accept loss)
    } else {
      return -1.0; // Overdue: Accept larger loss
    }
  }

  /**
   * Get position age category
   */
  getPositionAgeCategory(positionAgeHours) {
    if (positionAgeHours < 6) {
      return 'fresh';
    } else if (positionAgeHours < 24) {
      return 'medium';
    } else if (positionAgeHours < 36) {
      return 'aging';
    } else if (positionAgeHours < 42) {
      return 'old';
    } else if (positionAgeHours < 48) {
      return 'critical';
    } else {
      return 'overdue';
    }
  }

  /**
   * Round price to specified precision
   */
  roundPrice(price, precision) {
    const factor = Math.pow(10, precision);
    return Math.round(price * factor) / factor;
  }

  /**
   * Round size to specified precision
   */
  roundSize(size, precision) {
    const factor = Math.pow(10, precision);
    return Math.floor(size * factor) / factor;
  }
}

export default TakeProfitCore; 