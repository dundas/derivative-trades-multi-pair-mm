/**
 * Fill class representing an order fill (partial or complete)
 * 
 * This standardized model is used to represent fills across all exchanges
 * and can be serialized to/from JSON for storage in Redis.
 */

import { v4 as uuidv4 } from 'uuid';

export class Fill {
  /**
   * Create a new Fill
   * 
   * @param {Object} data - Fill data
   * @param {string} [data.id] - Unique fill ID (auto-generated if not provided)
   * @param {string} data.orderId - ID of the order that was filled
   * @param {string} data.exchangeOrderId - Exchange-specific order ID
   * @param {string} [data.exchangeFillId] - Exchange-specific fill ID
   * @param {string} data.symbol - Trading symbol (e.g., 'BTC/USD')
   * @param {string} data.exchange - Exchange name
   * @param {string} data.side - 'buy' or 'sell'
   * @param {number} data.price - Fill price
   * @param {number} data.quantity - Fill quantity
   * @param {number} [data.fee] - Fee amount
   * @param {string} [data.feeCurrency] - Currency of fee
   * @param {number} [data.timestamp] - Fill timestamp (auto-set to now if not provided)
   * @param {boolean} [data.isPartial=false] - Whether this is a partial fill
   * @param {number} [data.fillRatio] - Ratio of this fill to total order size (0-1)
   * @param {Object} [data.rawData] - Raw exchange data for reference
   */
  constructor(data = {}) {
    // Required fields
    this.id = data.id || uuidv4();
    this.orderId = data.orderId;
    this.exchangeOrderId = data.exchangeOrderId;
    this.symbol = data.symbol;
    this.exchange = data.exchange;
    this.side = data.side;
    this.price = data.price;
    this.quantity = data.quantity;
    
    // Optional fields with defaults
    this.exchangeFillId = data.exchangeFillId || null;
    this.fee = data.fee || 0;
    this.feeCurrency = data.feeCurrency || this.getFeeCurrency();
    this.timestamp = data.timestamp || Date.now();
    this.isPartial = data.isPartial !== undefined ? data.isPartial : false;
    this.fillRatio = data.fillRatio || null;
    
    // Raw exchange data for reference/debugging
    this.rawData = data.rawData || null;
    
    // Validate required fields
    this.validate();
  }
  
  /**
   * Validate that the Fill has all required fields
   * @private
   */
  validate() {
    const requiredFields = ['orderId', 'exchangeOrderId', 'symbol', 'exchange', 'side', 'price', 'quantity'];
    
    for (const field of requiredFields) {
      if (this[field] === undefined || this[field] === null) {
        throw new Error(`Fill is missing required field: ${field}`);
      }
    }
    
    if (typeof this.price !== 'number' || this.price <= 0) {
      throw new Error('Fill price must be a positive number');
    }
    
    if (typeof this.quantity !== 'number' || this.quantity <= 0) {
      throw new Error('Fill quantity must be a positive number');
    }
    
    if (!['buy', 'sell'].includes(this.side.toLowerCase())) {
      throw new Error('Fill side must be "buy" or "sell"');
    }
  }
  
  /**
   * Get default fee currency based on symbol
   * @returns {string} Fee currency
   * @private
   */
  getFeeCurrency() {
    if (!this.symbol) return 'USD';
    
    const parts = this.symbol.split('/');
    return parts.length > 1 ? parts[1] : 'USD';
  }
  
  /**
   * Calculate the value of this fill in the quote currency
   * @returns {number} Fill value
   */
  getValue() {
    return this.price * this.quantity;
  }
  
  /**
   * Get fill data for persistent storage
   * @returns {Object} Serializable fill data
   */
  toJSON() {
    return {
      id: this.id,
      orderId: this.orderId,
      exchangeOrderId: this.exchangeOrderId,
      exchangeFillId: this.exchangeFillId,
      symbol: this.symbol,
      exchange: this.exchange,
      side: this.side,
      price: this.price,
      quantity: this.quantity,
      fee: this.fee,
      feeCurrency: this.feeCurrency,
      timestamp: this.timestamp,
      isPartial: this.isPartial,
      fillRatio: this.fillRatio
    };
  }
  
  /**
   * Create a Fill instance from exchange-specific data
   * @param {Object} exchangeData - Exchange-specific fill data
   * @param {Object} metadata - Additional metadata needed for standardization
   * @param {string} metadata.exchange - Exchange name
   * @param {string} metadata.orderId - Our internal order ID
   * @param {string} metadata.exchangeOrderId - Exchange order ID
   * @param {string} metadata.symbol - Trading symbol
   * @param {boolean} metadata.isPartial - Whether this is a partial fill
   * @returns {Fill} Standardized Fill instance
   */
  static fromExchangeData(exchangeData, metadata) {
    // This method would be implemented for each exchange
    // but we'll provide a basic implementation here
    const commonData = {
      orderId: metadata.orderId,
      exchangeOrderId: metadata.exchangeOrderId,
      symbol: metadata.symbol,
      exchange: metadata.exchange,
      isPartial: metadata.isPartial,
      rawData: exchangeData
    };
    
    // Each exchange adapter would implement specific mapping logic
    // For now, we'll assume we have a mapper function
    if (metadata.exchange === 'kraken') {
      return Fill.fromKrakenData(exchangeData, commonData);
    } else if (metadata.exchange === 'gemini') {
      return Fill.fromGeminiData(exchangeData, commonData);
    } else if (metadata.exchange === 'bitstamp') {
      return Fill.fromBitstampData(exchangeData, commonData);
    } else {
      // Generic fallback that assumes exchangeData has similar field names
      return new Fill({
        ...commonData,
        exchangeFillId: exchangeData.id || exchangeData.fillId,
        side: exchangeData.side,
        price: parseFloat(exchangeData.price),
        quantity: parseFloat(exchangeData.quantity || exchangeData.amount || exchangeData.size),
        fee: parseFloat(exchangeData.fee || 0),
        feeCurrency: exchangeData.feeCurrency,
        timestamp: exchangeData.timestamp || Date.now(),
        fillRatio: exchangeData.fillRatio
      });
    }
  }
  
  /**
   * Create a Fill instance from Kraken fill data
   * @param {Object} krakenData - Kraken-specific fill data
   * @param {Object} commonData - Common fill data
   * @returns {Fill} Standardized Fill instance
   */
  static fromKrakenData(krakenData, commonData) {
    return new Fill({
      ...commonData,
      exchangeFillId: krakenData.trade_id,
      side: krakenData.side,
      price: parseFloat(krakenData.price),
      quantity: parseFloat(krakenData.vol),
      fee: parseFloat(krakenData.fee),
      feeCurrency: krakenData.fee_currency || commonData.symbol.split('/')[1],
      timestamp: parseInt(krakenData.time * 1000)
    });
  }
  
  /**
   * Create a Fill instance from Gemini fill data
   * @param {Object} geminiData - Gemini-specific fill data
   * @param {Object} commonData - Common fill data
   * @returns {Fill} Standardized Fill instance
   */
  static fromGeminiData(geminiData, commonData) {
    return new Fill({
      ...commonData,
      exchangeFillId: geminiData.tid || geminiData.fill_id,
      side: geminiData.side,
      price: parseFloat(geminiData.price),
      quantity: parseFloat(geminiData.amount || geminiData.executed_amount),
      fee: parseFloat(geminiData.fee_amount || 0),
      feeCurrency: geminiData.fee_currency,
      timestamp: geminiData.timestampms || Date.now()
    });
  }
  
  /**
   * Create a Fill instance from Bitstamp fill data
   * @param {Object} bitstampData - Bitstamp-specific fill data
   * @param {Object} commonData - Common fill data
   * @returns {Fill} Standardized Fill instance
   */
  static fromBitstampData(bitstampData, commonData) {
    return new Fill({
      ...commonData,
      exchangeFillId: bitstampData.id,
      side: bitstampData.type === 0 ? 'buy' : 'sell', // Bitstamp uses 0 for buy, 1 for sell
      price: parseFloat(bitstampData.price),
      quantity: parseFloat(bitstampData.amount),
      fee: parseFloat(bitstampData.fee),
      feeCurrency: commonData.symbol.split('/')[1], // Bitstamp typically doesn't specify fee currency
      timestamp: parseInt(bitstampData.datetime) * 1000 // Bitstamp uses seconds, convert to ms
    });
  }
  
  /**
   * Create a Fill instance from JSON data (e.g., from Redis)
   * @param {Object|string} json - JSON data or string
   * @returns {Fill} Fill instance
   */
  static fromJSON(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    return new Fill(data);
  }
}

export default Fill;
