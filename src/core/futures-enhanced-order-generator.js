#!/usr/bin/env node
/**
 * Futures-Enhanced Order Generator
 * 
 * Combines proven risk/pricing parameters from simulation-to-session.js
 * with real-time futures leading indicators for optimal order placement
 */

import { FuturesEdgeExpectedValueModel } from './futures-edge-expected-value-model.js';
import { AdaptiveRiskProfileManager } from '../../lib/risk/adaptive-risk-profile-manager.js';
import { exchangeFeeService } from '../../trading-agent/utils/exchange-fee-service.js';
import { LoggerFactory } from '../../utils/logger-factory.js';
import fs from 'fs';

const logger = LoggerFactory.createLogger({ component: 'FuturesEnhancedOrderGenerator' });

class FuturesEnhancedOrderGenerator {
  constructor(config = {}) {
    this.config = {
      // Futures signal processing (from our model)
      futuresSignalThreshold: 0.0001,      // 0.01% minimum futures movement
      spotSignalThreshold: 0.00005,        // 0.005% minimum spot movement
      leadTimeWindow: 15000,               // 15 second window
      signalConfidenceMin: 0.6,            // 60% minimum confidence
      
      // Order optimization
      fillRateOptimization: true,          // Use leading indicators for fill rate
      dynamicSizing: true,                 // Adjust size based on signal strength
      adaptiveTiming: true,                // Adjust timing based on lead time
      
      // Risk management (inherited from simulation-to-session.js approach)
      useAdaptiveRiskProfile: true,
      
      ...config
    };
    
    this.futuresModel = null;
    this.riskManager = null;
    this.currentOpportunity = null;
    this.baseStrategy = null; // From direction-based analysis
  }
  
  async initialize(selectedPairs, baseStrategy) {
    logger.info('🚀 Initializing Futures-Enhanced Order Generator...');
    
    // Store base strategy from simulation-to-session.js analysis
    this.baseStrategy = baseStrategy;
    
    // Initialize futures model with optimized thresholds
    this.futuresModel = new FuturesEdgeExpectedValueModel({
      futuresSignalThreshold: this.config.futuresSignalThreshold,
      spotSignalThreshold: this.config.spotSignalThreshold,
      leadTimeWindow: this.config.leadTimeWindow,
      signalConfidenceMin: this.config.signalConfidenceMin,
      minExpectedValueThreshold: -0.001,  // Accept small negative for fill rate optimization
      maxConcurrentPairs: 1               // Focus on best opportunity
    });
    
    // Skip fee updates to avoid rate limits (use base strategy fees)
    this.futuresModel.updateFeeInformation = async function() {
      this.currentFeeInfo = {
        makerFee: baseStrategy.feeInfo?.makerFee || 0.0025,
        takerFee: baseStrategy.feeInfo?.takerFee || 0.004,
        timestamp: Date.now()
      };
    };
    
    await this.futuresModel.initialize(selectedPairs);
    
    // Initialize risk manager
    this.riskManager = AdaptiveRiskProfileManager.create({ logger });
    
    logger.info('✅ Futures-Enhanced Order Generator initialized');
  }
  
  /**
   * Generate optimized order parameters using futures leading indicators
   */
  async generateOptimizedOrder(currentPrice, orderType = 'buy') {
    logger.info(`🎯 Generating optimized ${orderType} order at price ${currentPrice}`);
    
    // Get current best opportunity from futures model
    const opportunity = this.futuresModel.getBestOpportunity();
    this.currentOpportunity = opportunity;
    
    if (!opportunity) {
      // No futures signal - use base strategy parameters
      return this.generateBaseOrder(currentPrice, orderType);
    }
    
    logger.info(`📈 Using futures opportunity: ${opportunity.pair} (EV: ${(opportunity.expectedValue * 100).toFixed(3)}%, Confidence: ${(opportunity.confidence * 100).toFixed(1)}%)`);
    
    // Generate enhanced order using futures signals
    return this.generateFuturesEnhancedOrder(currentPrice, orderType, opportunity);
  }
  
  /**
   * Generate base order using proven simulation-to-session.js parameters
   */
  generateBaseOrder(currentPrice, orderType) {
    logger.debug('📋 Generating base order using proven strategy parameters');
    
    const baseOffset = orderType === 'buy' ? 
      this.baseStrategy.buyOffset || this.baseStrategy.entryThreshold || 0.001 :
      this.baseStrategy.sellTarget || this.baseStrategy.profitTarget || 0.005;
    
    const baseTTL = orderType === 'buy' ?
      (this.baseStrategy.suggestedBuyTTL || 5) * 60 : // Convert minutes to seconds
      (this.baseStrategy.suggestedSellTTL || 10) * 60;
    
    const baseSize = this.calculateBasePositionSize(currentPrice);
    
    return {
      price: this.calculateOrderPrice(currentPrice, baseOffset, orderType),
      size: baseSize,
      ttl: baseTTL,
      confidence: this.baseStrategy.confidence || 0.7,
      source: 'base_strategy',
      reasoning: 'Using proven direction-based analysis parameters',
      parameters: {
        offset: baseOffset,
        ttlMinutes: baseTTL / 60,
        signalStrength: 'baseline'
      }
    };
  }
  
  /**
   * Generate futures-enhanced order with optimized fill rate and sizing
   */
  generateFuturesEnhancedOrder(currentPrice, orderType, opportunity) {
    logger.debug('⚡ Generating futures-enhanced order');
    
    // 1. PRICING OPTIMIZATION - Use leading indicator to optimize fill rate
    const enhancedPricing = this.optimizePricingForFillRate(
      currentPrice, 
      orderType, 
      opportunity
    );
    
    // 2. SIZING OPTIMIZATION - Adjust size based on signal strength
    const enhancedSizing = this.optimizeSizeForSignalStrength(
      currentPrice, 
      opportunity
    );
    
    // 3. TIMING OPTIMIZATION - Adjust TTL based on lead time
    const enhancedTiming = this.optimizeTimingForLeadTime(
      orderType, 
      opportunity
    );
    
    return {
      price: enhancedPricing.price,
      size: enhancedSizing.size,
      ttl: enhancedTiming.ttl,
      confidence: opportunity.confidence,
      source: 'futures_enhanced',
      reasoning: enhancedPricing.reasoning,
      parameters: {
        baseOffset: enhancedPricing.baseOffset,
        futuresAdjustment: enhancedPricing.adjustment,
        finalOffset: enhancedPricing.finalOffset,
        signalStrength: opportunity.futuresSignal.magnitude,
        leadTime: opportunity.leadTime,
        sizeMultiplier: enhancedSizing.multiplier,
        ttlAdjustment: enhancedTiming.adjustment
      }
    };
  }
  
  /**
   * Optimize pricing for better fill rate using futures leading indicators
   */
  optimizePricingForFillRate(currentPrice, orderType, opportunity) {
    const baseOffset = orderType === 'buy' ? 
      this.baseStrategy.buyOffset || 0.001 :
      this.baseStrategy.sellTarget || 0.005;
    
    const futuresSignal = opportunity.futuresSignal;
    const leadTime = opportunity.leadTime;
    
    // Calculate adjustment based on futures signal direction and strength
    let adjustment = 0;
    let reasoning = '';
    
    if (orderType === 'buy') {
      if (futuresSignal.direction === 'down') {
        // Futures showing downward pressure - we can be more aggressive (buy lower)
        adjustment = futuresSignal.magnitude * 0.5; // Use 50% of signal strength
        reasoning = `Futures signal shows ${futuresSignal.direction} pressure (${(futuresSignal.magnitude * 100).toFixed(4)}%), increasing buy offset for better fill rate`;
      } else {
        // Futures showing upward pressure - be less aggressive to ensure fill
        adjustment = -futuresSignal.magnitude * 0.3; // Reduce offset by 30% of signal
        reasoning = `Futures signal shows ${futuresSignal.direction} pressure, reducing buy offset to ensure fill before price rises`;
      }
    } else { // sell order
      if (futuresSignal.direction === 'up') {
        // Futures showing upward pressure - we can be more aggressive (sell higher)
        adjustment = futuresSignal.magnitude * 0.5;
        reasoning = `Futures signal shows ${futuresSignal.direction} pressure, increasing sell target for better profit`;
      } else {
        // Futures showing downward pressure - be less aggressive to ensure fill
        adjustment = -futuresSignal.magnitude * 0.3;
        reasoning = `Futures signal shows ${futuresSignal.direction} pressure, reducing sell target to ensure fill before price drops`;
      }
    }
    
    // Apply lead time bonus - shorter lead time = more reliable signal
    const leadTimeFactor = Math.max(0.5, 1 - (leadTime / this.config.leadTimeWindow));
    adjustment *= leadTimeFactor;
    
    const finalOffset = Math.max(0.0001, baseOffset + adjustment); // Ensure minimum offset
    const price = this.calculateOrderPrice(currentPrice, finalOffset, orderType);
    
    return {
      price,
      baseOffset,
      adjustment,
      finalOffset,
      reasoning: `${reasoning}. Lead time: ${leadTime}ms (factor: ${leadTimeFactor.toFixed(2)})`
    };
  }
  
  /**
   * Optimize position size based on signal strength
   */
  optimizeSizeForSignalStrength(currentPrice, opportunity) {
    const baseSize = this.calculateBasePositionSize(currentPrice);
    
    // Calculate size multiplier based on confidence and signal strength
    const confidenceMultiplier = 0.5 + (opportunity.confidence * 0.5); // 0.5 to 1.0
    const signalMultiplier = 1 + (opportunity.futuresSignal.magnitude * 2); // Up to 2x for strong signals
    
    const totalMultiplier = Math.min(1.5, confidenceMultiplier * signalMultiplier); // Cap at 1.5x
    const enhancedSize = baseSize * totalMultiplier;
    
    logger.debug(`📊 Size optimization: Base: ${baseSize}, Confidence: ${confidenceMultiplier.toFixed(2)}, Signal: ${signalMultiplier.toFixed(2)}, Final: ${enhancedSize.toFixed(6)}`);
    
    return {
      size: enhancedSize,
      multiplier: totalMultiplier,
      components: {
        confidenceMultiplier,
        signalMultiplier,
        baseSize
      }
    };
  }
  
  /**
   * Optimize TTL based on futures lead time
   */
  optimizeTimingForLeadTime(orderType, opportunity) {
    const baseTTL = orderType === 'buy' ?
      (this.baseStrategy.suggestedBuyTTL || 5) * 60 :
      (this.baseStrategy.suggestedSellTTL || 10) * 60;
    
    const leadTime = opportunity.leadTime;
    
    // Adjust TTL based on how quickly futures signal translates to spot
    // Shorter lead time = shorter TTL needed
    let adjustment = 0;
    
    if (leadTime < 5000) { // Very fast signal (< 5 seconds)
      adjustment = -0.3; // Reduce TTL by 30%
    } else if (leadTime < 10000) { // Fast signal (< 10 seconds)
      adjustment = -0.15; // Reduce TTL by 15%
    } else if (leadTime > 20000) { // Slow signal (> 20 seconds)
      adjustment = 0.2; // Increase TTL by 20%
    }
    
    const enhancedTTL = Math.max(30, Math.round(baseTTL * (1 + adjustment))); // Minimum 30 seconds
    
    logger.debug(`⏰ TTL optimization: Base: ${baseTTL}s, Lead time: ${leadTime}ms, Adjustment: ${(adjustment * 100).toFixed(0)}%, Final: ${enhancedTTL}s`);
    
    return {
      ttl: enhancedTTL,
      adjustment,
      leadTimeFactor: leadTime
    };
  }
  
  /**
   * Calculate order price with offset
   */
  calculateOrderPrice(currentPrice, offset, orderType) {
    if (orderType === 'buy') {
      return currentPrice * (1 - offset); // Buy below market
    } else {
      return currentPrice * (1 + offset); // Sell above market
    }
  }
  
  /**
   * Calculate base position size using proven risk management
   */
  calculateBasePositionSize(currentPrice) {
    if (!this.baseStrategy.riskManagement) {
      // Fallback to simple calculation
      const budget = this.baseStrategy.budget || 1000;
      const maxPositionPercent = 0.02; // 2% max position
      return (budget * maxPositionPercent) / currentPrice;
    }
    
    // Use the proven risk management approach
    const budget = this.baseStrategy.budget || 1000;
    const maxPositionSize = this.baseStrategy.riskManagement.maxPositionSize || 100;
    const perTradeRiskPercent = this.baseStrategy.riskManagement.perTradeRiskPercent || 0.02;
    
    // Calculate size based on risk parameters
    const riskBasedSize = (budget * perTradeRiskPercent) / currentPrice;
    
    // Return smaller of risk-based size or max position size
    return Math.min(riskBasedSize, maxPositionSize / currentPrice);
  }
  
  /**
   * Get current market sentiment from futures model
   */
  getCurrentMarketSentiment() {
    const opportunities = this.futuresModel.getAllOpportunities();
    
    if (opportunities.length === 0) {
      return {
        sentiment: 'neutral',
        confidence: 0.5,
        activeSignals: 0,
        recommendation: 'Use base strategy parameters'
      };
    }
    
    // Analyze overall sentiment from all opportunities
    const bullishSignals = opportunities.filter(op => op.futuresSignal.direction === 'up').length;
    const bearishSignals = opportunities.filter(op => op.futuresSignal.direction === 'down').length;
    const avgConfidence = opportunities.reduce((sum, op) => sum + op.confidence, 0) / opportunities.length;
    
    let sentiment = 'neutral';
    if (bullishSignals > bearishSignals * 1.5) {
      sentiment = 'bullish';
    } else if (bearishSignals > bullishSignals * 1.5) {
      sentiment = 'bearish';
    }
    
    return {
      sentiment,
      confidence: avgConfidence,
      activeSignals: opportunities.length,
      bullishSignals,
      bearishSignals,
      recommendation: opportunities.length > 0 ? 'Use futures-enhanced parameters' : 'Use base strategy parameters'
    };
  }
  
  /**
   * Generate comprehensive order report
   */
  generateOrderReport(order, currentPrice, orderType) {
    const sentiment = this.getCurrentMarketSentiment();
    
    return {
      timestamp: new Date().toISOString(),
      orderType,
      currentPrice,
      recommendedOrder: order,
      marketSentiment: sentiment,
      baseStrategy: {
        pair: this.baseStrategy.pair,
        expectedValue: this.baseStrategy.expectedReturn,
        winRate: this.baseStrategy.winRate,
        confidence: this.baseStrategy.confidence
      },
      futuresInsight: this.currentOpportunity ? {
        pair: this.currentOpportunity.pair,
        expectedValue: this.currentOpportunity.expectedValue,
        confidence: this.currentOpportunity.confidence,
        leadTime: this.currentOpportunity.leadTime,
        signalStrength: this.currentOpportunity.futuresSignal.magnitude
      } : null,
      recommendation: {
        useOrder: order.confidence > 0.6,
        reasoning: order.reasoning,
        riskLevel: order.confidence > 0.8 ? 'Low' : order.confidence > 0.6 ? 'Moderate' : 'High'
      }
    };
  }
  
  async cleanup() {
    if (this.futuresModel) {
      await this.futuresModel.cleanup();
    }
  }
}

export { FuturesEnhancedOrderGenerator };