/**
 * @fileoverview
 * Pricing Metadata Generator utility for capturing comprehensive pricing calculation details
 * to be stored with orders in Redis for analysis and debugging purposes.
 */

/**
 * Generates comprehensive pricing metadata for an order
 * @param {Object} params - Parameters for generating pricing metadata
 * @param {Object} params.pricingEngine - PricingEngine instance
 * @param {Object} params.decision - Trading decision from TradingDecisionEngine
 * @param {Object} params.marketData - Current market data
 * @param {Object} params.pricingStrategyConfig - Pricing strategy configuration
 * @param {Object} params.orderDetails - Calculated order details
 * @param {Object} params.symbolConfig - Symbol configuration (precision, etc.)
 * @param {boolean} [params.isTakeProfit=false] - Whether this is a take-profit order
 * @param {boolean} [params.forcedTrade=false] - Whether this was a forced trade
 * @returns {Object} Comprehensive pricing metadata
 */
export function generatePricingMetadata({
  pricingEngine,
  decision,
  marketData,
  pricingStrategyConfig,
  orderDetails,
  symbolConfig,
  isTakeProfit = false,
  forcedTrade = false
}) {
  try {
    const side = decision.action?.toLowerCase() || orderDetails.side;
    const strategyConfig = side === 'buy' ? pricingStrategyConfig.buy : pricingStrategyConfig.sell;
    
    // Extract market conditions
    const marketConditions = extractMarketConditions(marketData, decision);
    
    // Calculate fee details
    let feeDetails = { feeAmount: 0, feeRate: 0, feeCurrency: 'USD', feeStrategyUsed: 'maker' };
    try {
      if (pricingEngine && typeof pricingEngine.getEstimatedFeeDetails === 'function') {
        feeDetails = pricingEngine.getEstimatedFeeDetails({
          side: side,
          grossOrderPrice: orderDetails.price,
          amount: orderDetails.amount,
          orderType: orderDetails.type || 'limit'
        });
      } else {
        console.warn('[PricingMetadataGenerator] Pricing engine does not have getEstimatedFeeDetails method');
      }
    } catch (feeError) {
      console.warn('[PricingMetadataGenerator] Could not get fee details:', feeError.message);
    }
    
    // Calculate markup details
    const markupDetails = calculateMarkupDetails(
      marketConditions.mid_price,
      orderDetails.price,
      side,
      strategyConfig
    );
    
    // Generate P&L projections for buy orders
    let projections = null;
    if (side === 'buy' && !isTakeProfit) {
      projections = generatePnLProjections({
        pricingEngine,
        entryPrice: orderDetails.price,
        amount: orderDetails.amount,
        marketData,
        pricingStrategyConfig
      });
    }
    
    return {
      strategy: {
        mode: strategyConfig?.mode || 'UNKNOWN',
        percentage: strategyConfig?.percentage,
        name: pricingStrategyConfig?.name || 'custom'
      },
      
      market_conditions: marketConditions,
      
      fees: {
        estimated_amount: feeDetails.feeAmount || 0,
        rate: feeDetails.feeRate || 0,
        type: feeDetails.feeStrategyUsed || 'maker',
        currency: feeDetails.feeCurrency || 'USD'
      },
      
      calculation: {
        base_price: marketConditions.mid_price,
        markup_amount: markupDetails.markup_amount,
        markup_percentage: markupDetails.markup_percentage,
        calculated_price: orderDetails.price,
        price_precision: symbolConfig?.pricePrecision || 2,
        size_precision: symbolConfig?.sizePrecision || 6
      },
      
      projections: projections,
      
      calculated_at: Date.now(),
      forced_trade: forcedTrade,
      is_take_profit: isTakeProfit
    };
    
  } catch (error) {
    console.error('[PricingMetadataGenerator] Error generating pricing metadata:', error);
    
    // Return minimal metadata on error
    return {
      strategy: {
        mode: 'ERROR',
        name: 'error'
      },
      market_conditions: {
        mid_price: orderDetails.price || 0,
        best_bid: 0,
        best_ask: 0,
        spread: 0,
        spread_percentage: 0
      },
      fees: {
        estimated_amount: 0,
        rate: 0,
        type: 'maker',
        currency: 'USD'
      },
      calculation: {
        base_price: orderDetails.price || 0,
        markup_amount: 0,
        markup_percentage: 0,
        calculated_price: orderDetails.price || 0,
        price_precision: 2,
        size_precision: 6
      },
      calculated_at: Date.now(),
      forced_trade: forcedTrade,
      is_take_profit: isTakeProfit,
      error: error.message
    };
  }
}

/**
 * Extracts market conditions from market data
 * @private
 */
function extractMarketConditions(marketData, decision) {
  let midPrice = 0;
  let bestBid = 0;
  let bestAsk = 0;
  let spread = 0;
  let entryPrice = null;
  
  // Try to extract from various market data sources
  if (marketData?.averagedMetrics) {
    midPrice = marketData.averagedMetrics.midPrice || 0;
    bestBid = marketData.averagedMetrics.bestBid || 0;
    bestAsk = marketData.averagedMetrics.bestAsk || 0;
    spread = marketData.averagedMetrics.spread || (bestAsk - bestBid);
  } else if (marketData?.orderBook) {
    bestBid = parseFloat(marketData.orderBook.bids?.[0]?.[0]) || 0;
    bestAsk = parseFloat(marketData.orderBook.asks?.[0]?.[0]) || 0;
    midPrice = (bestBid + bestAsk) / 2;
    spread = bestAsk - bestBid;
  } else if (marketData?.ticker) {
    midPrice = parseFloat(marketData.ticker.last) || 0;
    bestBid = parseFloat(marketData.ticker.bid) || 0;
    bestAsk = parseFloat(marketData.ticker.ask) || 0;
    spread = bestAsk - bestBid;
  }
  
  // Extract entry price for take-profit orders
  if (decision?.entryPrice) {
    entryPrice = decision.entryPrice;
  }
  
  const spreadPercentage = midPrice > 0 ? (spread / midPrice) * 100 : 0;
  
  return {
    mid_price: midPrice,
    best_bid: bestBid,
    best_ask: bestAsk,
    spread: spread,
    spread_percentage: spreadPercentage,
    volatility: decision?.volatility || marketData?.volatility,
    entry_price: entryPrice
  };
}

/**
 * Calculates markup details
 * @private
 */
function calculateMarkupDetails(midPrice, orderPrice, side, strategyConfig) {
  let markupAmount = 0;
  let markupPercentage = 0;
  
  if (midPrice > 0 && orderPrice > 0) {
    if (side === 'buy') {
      // For buy orders, markup is negative (discount from mid price)
      markupAmount = orderPrice - midPrice;
      markupPercentage = (markupAmount / midPrice) * 100;
    } else {
      // For sell orders, markup is positive (premium above mid price or entry price)
      markupAmount = orderPrice - midPrice;
      markupPercentage = (markupAmount / midPrice) * 100;
    }
  }
  
  return {
    markup_amount: markupAmount,
    markup_percentage: markupPercentage
  };
}

/**
 * Generates P&L projections for buy orders
 * @private
 */
function generatePnLProjections({
  pricingEngine,
  entryPrice,
  amount,
  marketData,
  pricingStrategyConfig
}) {
  try {
    const marketConditions = extractMarketConditions(marketData, {});
    
    // Calculate projected take-profit price
    let projectedTpPrice = 0;
    if (pricingEngine && typeof pricingEngine.calculateGrossOrderPrice === 'function') {
      projectedTpPrice = pricingEngine.calculateGrossOrderPrice({
        side: 'sell',
        midPrice: marketConditions.mid_price,
        spread: marketConditions.spread,
        entryPrice: entryPrice,
        isTakeProfit: true
      });
    }
    
    if (!projectedTpPrice || projectedTpPrice <= 0) {
      return null;
    }
    
    // Calculate buy fees
    let buyFees = { feeAmount: 0, feeRate: 0 };
    if (pricingEngine && typeof pricingEngine.getEstimatedFeeDetails === 'function') {
      buyFees = pricingEngine.getEstimatedFeeDetails({
        side: 'buy',
        grossOrderPrice: entryPrice,
        amount: amount,
        orderType: 'limit'
      });
    }
    
    // Calculate sell fees
    let sellFees = { feeAmount: 0, feeRate: 0 };
    if (pricingEngine && typeof pricingEngine.getEstimatedFeeDetails === 'function') {
      sellFees = pricingEngine.getEstimatedFeeDetails({
        side: 'sell',
        grossOrderPrice: projectedTpPrice,
        amount: amount,
        orderType: 'limit'
      });
    }
    
    // Calculate P&L
    const totalCost = (entryPrice * amount) + (buyFees.feeAmount || 0);
    const projectedRevenue = (projectedTpPrice * amount) - (sellFees.feeAmount || 0);
    const netPnl = projectedRevenue - totalCost;
    const netPnlPercentage = totalCost > 0 ? (netPnl / totalCost) * 100 : 0;
    
    return {
      take_profit_price: projectedTpPrice,
      net_pnl: netPnl,
      net_pnl_percentage: netPnlPercentage,
      total_cost: totalCost,
      projected_revenue: projectedRevenue
    };
    
  } catch (error) {
    console.error('[PricingMetadataGenerator] Error generating P&L projections:', error);
    return null;
  }
}

/**
 * Generates pricing metadata specifically for take-profit orders
 * @param {Object} params - Parameters for take-profit pricing metadata
 * @returns {Object} Take-profit specific pricing metadata
 */
export function generateTakeProfitPricingMetadata({
  pricingEngine,
  entryPrice,
  takeProfitPrice,
  amount,
  marketData,
  pricingStrategyConfig,
  symbolConfig,
  parentOrderId
}) {
  const marketConditions = extractMarketConditions(marketData, { entryPrice });
  
  // Calculate actual P&L for this take-profit order
  let buyFees = { feeAmount: 0, feeRate: 0, feeCurrency: 'USD', feeStrategyUsed: 'maker' };
  let sellFees = { feeAmount: 0, feeRate: 0, feeCurrency: 'USD', feeStrategyUsed: 'maker' };
  
  if (pricingEngine && typeof pricingEngine.getEstimatedFeeDetails === 'function') {
    buyFees = pricingEngine.getEstimatedFeeDetails({
      side: 'buy',
      grossOrderPrice: entryPrice,
      amount: amount,
      orderType: 'limit'
    });
    
    sellFees = pricingEngine.getEstimatedFeeDetails({
      side: 'sell',
      grossOrderPrice: takeProfitPrice,
      amount: amount,
      orderType: 'limit'
    });
  }
  
  const totalCost = (entryPrice * amount) + (buyFees.feeAmount || 0);
  const totalRevenue = (takeProfitPrice * amount) - (sellFees.feeAmount || 0);
  const netPnl = totalRevenue - totalCost;
  const netPnlPercentage = totalCost > 0 ? (netPnl / totalCost) * 100 : 0;
  
  return {
    strategy: {
      mode: pricingStrategyConfig?.sell?.mode || 'TAKE_PROFIT',
      percentage: pricingStrategyConfig?.sell?.percentage,
      name: 'take-profit'
    },
    
    market_conditions: marketConditions,
    
    fees: {
      estimated_amount: sellFees.feeAmount || 0,
      rate: sellFees.feeRate || 0,
      type: sellFees.feeStrategyUsed || 'maker',
      currency: sellFees.feeCurrency || 'USD'
    },
    
    calculation: {
      base_price: entryPrice,
      markup_amount: takeProfitPrice - entryPrice,
      markup_percentage: ((takeProfitPrice - entryPrice) / entryPrice) * 100,
      calculated_price: takeProfitPrice,
      price_precision: symbolConfig?.pricePrecision || 2,
      size_precision: symbolConfig?.sizePrecision || 6
    },
    
    projections: {
      take_profit_price: takeProfitPrice,
      net_pnl: netPnl,
      net_pnl_percentage: netPnlPercentage,
      total_cost: totalCost,
      projected_revenue: totalRevenue
    },
    
    calculated_at: Date.now(),
    forced_trade: false,
    is_take_profit: true,
    parent_order_id: parentOrderId
  };
} 