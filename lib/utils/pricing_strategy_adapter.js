/**
 * @fileoverview
 * Adapter for legacy takeProfitPercentage to new PricingStrategyConfig structure
 * This utility helps with migration from the old system to the new pricing strategy configuration
 */

/**
 * Convert legacy takeProfitPercentage to PricingStrategyConfig structure
 * @param {number} takeProfitPercentage - Legacy take profit percentage
 * @returns {Object} - PricingStrategyConfig object
 */
export function convertTakeProfitToPricingStrategyConfig(takeProfitPercentage) {
  // Make sure we use the exact percentage passed in, not a hardcoded value
  const percentage = parseFloat(takeProfitPercentage);
  
  return {
    buy: {
      mode: "MARKET_EDGE",
      percentage: 0.001 // Small percentage for buys
    },
    sell: {
      mode: "TARGET_PROFIT",
      percentage: percentage // Use the actual takeProfitPercentage here
    },
    display: "TOTAL"
  };
}

/**
 * Validate pricing strategy configuration and normalize structure
 * @param {Object} pricingStrategyConfig - REQUIRED: Pricing strategy configuration object to validate
 * @returns {Object} - Validated and normalized pricing strategy configuration
 * @throws {Error} - If no configuration is provided or configuration is invalid
 */
export function validateAndNormalizePricingStrategyConfig(pricingStrategyConfig) {
  if (!pricingStrategyConfig) {
    throw new Error('Pricing strategy configuration is required. No default pricing strategy is provided to ensure conscious configuration decisions. Please provide explicit buy and sell pricing strategies.');
  }
  
  // Validate that buy and sell configurations exist
  if (!pricingStrategyConfig.buy || !pricingStrategyConfig.sell) {
    throw new Error('Pricing strategy configuration must include both buy and sell configurations. Please provide explicit buy.mode and sell.mode values.');
  }
  
  // Valid modes - updated with actual implemented modes
  const validBuyModes = [
    "MARKET_EDGE", "EDGE_OFFSET", "INSIDE_MARKET", 
    "MIDPOINT_OFFSET", "FEE_ADJUSTED", "TAKER_PRICE"
  ];
  
  const validSellModes = [
    "BREAK_EVEN", "TARGET_PROFIT", "ENTRY_MARKUP", 
    "MARKET_EDGE", "INSIDE_MARKET", "SPREAD_CAPTURE", "TAKER_PRICE", "FEE_ADJUSTED"
  ];
  
  const validDisplayModes = ["TOTAL", "SEPARATE", "percentage"]; 
  
  // Validate buy mode
  const buy = pricingStrategyConfig.buy || {};
  if (!buy.mode || !validBuyModes.includes(buy.mode)) {
    throw new Error(`Invalid buy pricing mode: "${buy.mode}". Valid modes are: ${validBuyModes.join(', ')}`);
  }
  
  // Validate sell mode
  const sell = pricingStrategyConfig.sell || {};
  if (!sell.mode || !validSellModes.includes(sell.mode)) {
    throw new Error(`Invalid sell pricing mode: "${sell.mode}". Valid modes are: ${validSellModes.join(', ')}`);
  }
  
  // Normalize buy config - validate percentage where required
  const normalizedBuy = {
    mode: buy.mode,
    percentage: typeof buy.percentage === 'number' && buy.percentage >= 0 ? buy.percentage : 0
  };
  
  // For modes that require percentage, validate it's provided
  const buyModesRequiringPercentage = ["EDGE_OFFSET", "MIDPOINT_OFFSET"];
  if (buyModesRequiringPercentage.includes(buy.mode) && (typeof buy.percentage !== 'number' || buy.percentage < 0)) {
    throw new Error(`Buy pricing mode "${buy.mode}" requires a valid percentage value (>= 0)`);
  }
  
  // Normalize sell config - validate percentage where required
  const normalizedSell = {
    mode: sell.mode,
    percentage: typeof sell.percentage === 'number' && sell.percentage >= 0 ? sell.percentage : 0
  };
  
  // For modes that require percentage, validate it's provided
  const sellModesRequiringPercentage = ["TARGET_PROFIT", "ENTRY_MARKUP"];
  if (sellModesRequiringPercentage.includes(sell.mode) && (typeof sell.percentage !== 'number' || sell.percentage < 0)) {
    throw new Error(`Sell pricing mode "${sell.mode}" requires a valid percentage value (>= 0)`);
  }
  
  // Normalize display mode
  const display = validDisplayModes.includes(pricingStrategyConfig.display) ? pricingStrategyConfig.display : "TOTAL";
  
  return {
    buy: normalizedBuy,
    sell: normalizedSell,
    display
  };
}

/**
 * Get pricing strategy description for display
 * @param {Object} pricingStrategyConfig - Pricing strategy configuration
 * @returns {string} - Human-readable description of the pricing strategy
 */
export function getPricingStrategyDescription(pricingStrategyConfig) {
  const config = validateAndNormalizePricingStrategyConfig(pricingStrategyConfig);
  
  // Format buy side description
  let buyDesc = '';
  switch(config.buy.mode) {
    case "MARKET_EDGE":
      buyDesc = 'Market Edge';
      break;
    case "EDGE_OFFSET":
      buyDesc = `Edge+${config.buy.percentage}%`;
      break;
    case "INSIDE_MARKET":
      buyDesc = 'Inside Market';
      break;
    case "MIDPOINT_OFFSET":
      buyDesc = `Midpoint±${config.buy.percentage}%`;
      break;
    case "FEE_ADJUSTED":
      buyDesc = 'Fee Adjusted';
      break;
    case "TAKER_PRICE":
      buyDesc = 'Taker Price';
      break;
    default:
      buyDesc = 'Custom';
  }
  
  // Format sell side description
  let sellDesc = '';
  switch(config.sell.mode) {
    case "BREAK_EVEN":
      sellDesc = 'Break Even';
      break;
    case "TARGET_PROFIT":
      sellDesc = `Target Profit ${config.sell.percentage}%`;
      break;
    case "ENTRY_MARKUP":
      sellDesc = `Entry+${config.sell.percentage}%`;
      break;
    case "MARKET_EDGE":
      sellDesc = 'Market Edge';
      break;
    case "INSIDE_MARKET":
      sellDesc = 'Inside Market';
      break;
    case "SPREAD_CAPTURE":
      sellDesc = 'Spread Capture';
      break;
    case "TAKER_PRICE":
      sellDesc = 'Taker Price';
      break;
    case "FEE_ADJUSTED":
      sellDesc = 'Fee Adjusted';
      break;
    default:
      sellDesc = 'Custom';
  }
  
  // Format combined description
  if (config.display === "TOTAL") {
    return `Pricing Strategy: Buy(${buyDesc}), Sell(${sellDesc})`;
  } else {
    return `Pricing Strategy Details: Buy: ${buyDesc}, Sell: ${sellDesc}`;
  }
} 