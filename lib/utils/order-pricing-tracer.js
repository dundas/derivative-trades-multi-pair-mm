/**
 * Order Pricing Tracer
 * 
 * A specialized logger for tracing the buy-sell order flow and pricing calculations.
 * This logger writes detailed information to a file for analysis of the pricing strategy.
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from './logger-factory.js';

class OrderPricingTracer {
  constructor(options = {}) {
    // Create a standard logger for console output
    this.logger = createLogger('order-pricing-tracer');
    
    // Set up file logging
    this.logDir = options.logDir || path.join(process.cwd(), 'session-logs');
    this.sessionId = options.sessionId || 'unknown-session';
    this.logFilePath = path.join(this.logDir, `pricing-trace-${this.sessionId}.log`);
    
    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    // Initialize log file with header
    this._writeToFile(`ORDER PRICING TRACE - SESSION ${this.sessionId}\n${'='.repeat(80)}\n`);
    this.logger.info(`Order pricing tracer initialized for session ${this.sessionId}`);
    this.logger.info(`Trace log file: ${this.logFilePath}`);
  }
  
  /**
   * Write a message to the trace log file
   * @param {string} message - The message to write
   * @private
   */
  _writeToFile(message) {
    try {
      fs.appendFileSync(this.logFilePath, `${message}\n`);
    } catch (error) {
      this.logger.error(`Failed to write to trace log file: ${error.message}`);
    }
  }
  
  /**
   * Trace the start of a buy order
   * @param {Object} order - The buy order
   * @param {Object} marketConditions - Current market conditions
   */
  traceBuyOrderStart(order, marketConditions) {
    const timestamp = new Date().toISOString();
    const message = `\n[BUY ORDER START] ${timestamp}\n` +
      `Order ID: ${order.id}\n` +
      `Symbol: ${order.symbol}\n` +
      `Size: ${order.size}\n` +
      `Price: ${order.price}\n` +
      `Market Price: ${marketConditions?.midPrice || 'N/A'}\n`;
    
    this._writeToFile(message);
    this.logger.debug('Traced buy order start', { orderId: order.id });
  }
  
  /**
   * Trace a buy order fill
   * @param {Object} order - The buy order
   * @param {number} fillPrice - The price at which the order was filled
   */
  traceBuyOrderFill(order, fillPrice) {
    const timestamp = new Date().toISOString();
    const message = `\n[BUY ORDER FILL] ${timestamp}\n` +
      `Order ID: ${order.id}\n` +
      `Symbol: ${order.symbol}\n` +
      `Size: ${order.size}\n` +
      `Original Price: ${order.price}\n` +
      `Fill Price: ${fillPrice}\n`;
    
    this._writeToFile(message);
    this.logger.debug('Traced buy order fill', { orderId: order.id, fillPrice });
  }
  
  /**
   * Trace spread calculation for sell order pricing
   * @param {string|Object} buyOrderOrId - The filled buy order or order ID
   * @param {number} spread - The calculated spread
   * @param {string} spreadType - The type/source of the spread
   * @param {number} bestBid - Current market best bid
   * @param {number} bestAsk - Current market best ask
   * @param {number} midPrice - Current market mid price
   */
  traceSpreadCalculation(buyOrderOrId, spread, spreadType, bestBid, bestAsk, midPrice) {
    const timestamp = new Date().toISOString();
    
    // Handle both string ID and order object
    const orderId = typeof buyOrderOrId === 'string' ? buyOrderOrId : 
                   (buyOrderOrId && buyOrderOrId.id ? buyOrderOrId.id : 'undefined');
    
    const message = `\n[SPREAD CALCULATION] ${timestamp}\n` +
      `Buy Order ID: ${orderId}\n` +
      `Spread Value: ${(spread * 100).toFixed(6)}%\n` +
      `Spread Type: ${spreadType}\n` +
      `Market Bid: ${bestBid || 'N/A'}\n` +
      `Market Ask: ${bestAsk || 'N/A'}\n` +
      `Market Mid: ${midPrice || 'N/A'}\n`;
    
    this._writeToFile(message);
    this.logger.debug('Traced spread calculation', { 
      orderId, 
      spread: (spread * 100).toFixed(6) + '%',
      spreadType 
    });
  }
  
  /**
   * Trace sell price calculation
   * @param {Object} buyOrder - The filled buy order
   * @param {number} sellPrice - The calculated sell price
   * @param {number} spread - The calculated spread
   * @param {string} spreadType - The type of spread calculation used
   */
  traceSellPriceCalculation(buyOrder, sellPrice, spread, spreadType) {
    if (!buyOrder) {
      this.logger.warn('Cannot trace sell price calculation: Buy order is null or undefined');
      return;
    }
    
    const timestamp = new Date().toISOString();
    
    // CRITICAL FIX: Ensure we're using the actual fill price, not the original price
    // This ensures our profit calculations are accurate
    const buyFillPrice = buyOrder.fillPrice || buyOrder.price || 0;
    
    // Log the actual values for debugging
    this.logger.debug(`Buy order details - ID: ${buyOrder.id}, Fill Price: ${buyFillPrice}, Original Price: ${buyOrder.price}`);
    
    const halfSpread = spread / 2;
    
    // Handle potential NaN or undefined values safely
    const formattedSpread = !isNaN(spread) ? (spread * 100).toFixed(6) : 'NaN';
    const formattedHalfSpread = !isNaN(halfSpread) ? (halfSpread * 100).toFixed(6) : 'NaN';
    const formattedSellPrice = sellPrice ? sellPrice.toString() : 'undefined';
    const priceDifference = !isNaN(sellPrice) && !isNaN(buyFillPrice) ? sellPrice - buyFillPrice : 'NaN';
    
    // Calculate expected profit safely
    let expectedProfit = 'NaN';
    if (!isNaN(sellPrice) && !isNaN(buyFillPrice) && buyOrder.size) {
      expectedProfit = ((sellPrice - buyFillPrice) * buyOrder.size).toFixed(8);
    }
    
    // Determine if sell price is greater than buy price
    let isProfitable = 'NO';
    if (!isNaN(sellPrice) && !isNaN(buyFillPrice) && sellPrice > buyFillPrice) {
      isProfitable = 'YES';
    }
    
    const message = `\n[SELL PRICE CALCULATION] ${timestamp}\n` +
      `Buy Order ID: ${buyOrder.id}\n` +
      `Buy Fill Price: ${buyFillPrice}\n` +
      `Full Spread: ${formattedSpread}%\n` +
      `Half Spread: ${formattedHalfSpread}%\n` +
      `Calculated Sell Price: ${formattedSellPrice}\n` +
      `Price Difference: ${priceDifference}\n` +
      `Expected Profit: ${expectedProfit}\n` +
      `Is Sell Price > Buy Price: ${isProfitable}\n`;
    
    this._writeToFile(message);
    this.logger.debug('Traced sell price calculation', { 
      orderId: buyOrder.id, 
      buyPrice: buyFillPrice,
      sellPrice,
      priceDifference: !isNaN(priceDifference) ? priceDifference : 'NaN',
      expectedProfit
    });
  }
  
  /**
   * Trace sell order creation
   * @param {Object} buyOrder - The filled buy order
   * @param {Object} sellOrder - The created sell order
   */
  traceSellOrderCreation(buyOrder, sellOrder) {
    const timestamp = new Date().toISOString();
    const message = `\n[SELL ORDER CREATION] ${timestamp}\n` +
      `Buy Order ID: ${buyOrder.id}\n` +
      `Sell Order ID: ${sellOrder.id}\n` +
      `Symbol: ${sellOrder.symbol}\n` +
      `Size: ${sellOrder.size}\n` +
      `Price: ${sellOrder.price}\n` +
      `Parent Order ID: ${sellOrder.parentOrderId}\n`;
    
    this._writeToFile(message);
    this.logger.debug('Traced sell order creation', { 
      buyOrderId: buyOrder.id, 
      sellOrderId: sellOrder.id,
      sellPrice: sellOrder.price 
    });
  }
  
  /**
   * Trace an error in the order pricing process
   * @param {Object} buyOrder - The buy order
   * @param {string} stage - The stage where the error occurred
   * @param {Error} error - The error object
   */
  traceError(buyOrder, stage, error) {
    const timestamp = new Date().toISOString();
    const message = `\n[ERROR] ${timestamp}\n` +
      `Buy Order ID: ${buyOrder?.id || 'N/A'}\n` +
      `Stage: ${stage}\n` +
      `Error: ${error.message}\n` +
      `Stack: ${error.stack}\n`;
    
    this._writeToFile(message);
    this.logger.error(`Error in order pricing process at stage ${stage}`, { 
      orderId: buyOrder?.id, 
      error: error.message 
    });
  }
}

// Singleton instance
let instance = null;

/**
 * Get or create the OrderPricingTracer instance
 * @param {Object} options - Configuration options
 * @returns {OrderPricingTracer} The tracer instance
 */
export function getOrderPricingTracer(options = {}) {
  if (!instance) {
    instance = new OrderPricingTracer(options);
  }
  return instance;
}
