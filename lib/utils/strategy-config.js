/**
 * Strategy Configuration Module
 * 
 * This module provides default strategies for the AdaptiveMarketMaker.
 * Currently we just set fixed defaults, but in the future this could be extended
 * to support multiple strategy options and automatic selection.
 */

import VolumeWeightedPricingStrategy from '../strategies/pricing/volume-weighted-pricing-strategy.js';
import TraditionalPricingStrategy from '../strategies/pricing/traditional-pricing-strategy.js';
import AverageSizingStrategy from '../strategies/sizing/average-sizing-strategy.js';

/**
 * Create the default pricing strategy
 * @param {Object} options Configuration options
 * @returns {Object} The default pricing strategy
 */
export function createDefaultPricingStrategy(options = {}) {
  const logger = options.logger;
  const symbol = options.symbol;
  
  // Create Volume Weighted Pricing Strategy as our default
  return new VolumeWeightedPricingStrategy({
    logger,
    symbol,
    volumeWeight: 0.7,     // Weight volume more heavily (70%)
    depthWeight: 0.3,      // Give some weight to depth (30%)
    spreadBps: 20,         // 20 basis points spread
    adaptiveSpread: true,  // Enable adaptive spread based on market conditions
    volatilityFactor: 1.5  // Respond to market volatility
  });
}

/**
 * Create the fallback pricing strategy
 * @param {Object} options Configuration options
 * @returns {Object} The fallback pricing strategy
 */
export function createFallbackPricingStrategy(options = {}) {
  const logger = options.logger;
  const symbol = options.symbol;
  
  // Create Traditional Pricing Strategy as our fallback
  return new TraditionalPricingStrategy({
    logger,
    symbol,
    spread: 0.002 // 20 bps default spread
  });
}

/**
 * Create the default sizing strategy
 * @param {Object} options Configuration options
 * @returns {Object} The default sizing strategy
 */
export function createDefaultSizingStrategy(options = {}) {
  const logger = options.logger;
  const symbol = options.symbol;
  
  // Create Average Sizing Strategy
  return new AverageSizingStrategy({
    logger,
    symbol,
    baseSize: options.baseOrderSize || 0.001,
    maxSize: options.maxOrderSize || 0.1
  });
}

/**
 * Get default strategies config
 * @param {Object} options Configuration options
 * @returns {Object} Default strategies configuration
 */
export function getDefaultStrategies(options = {}) {
  return {
    pricing: createDefaultPricingStrategy(options),
    fallbackPricing: createFallbackPricingStrategy(options),
    sizing: createDefaultSizingStrategy(options)
  };
}

export default {
  createDefaultPricingStrategy,
  createFallbackPricingStrategy,
  createDefaultSizingStrategy,
  getDefaultStrategies
};
