/**
 * Position Manager for Adaptive Market Maker
 * 
 * Tracks and manages positions and balances, providing risk management
 * controls and position metrics for the adaptive market maker.
 */

import { TradingLogger } from '../../../../utils/trading-logger.js';

export class PositionManager {
  /**
   * Create a new PositionManager
   * @param {Object} options Configuration options
   * @param {Object} options.exchange Exchange client instance
   * @param {string} options.symbol Trading symbol (e.g., 'BTC/USD')
   * @param {Object} [options.logger] Logger instance
   * @param {Object} [options.riskParams] Risk management parameters
   * @param {number} [options.riskParams.maxPositionSize] Maximum position size in base currency
   * @param {number} [options.riskParams.maxLeverage] Maximum leverage to use
   * @param {number} [options.riskParams.maxDrawdown] Maximum acceptable drawdown percentage
   * @param {number} [options.riskParams.stopLossPercent] Stop loss percentage
   * @param {number} [options.riskParams.takeProfitPercent] Take profit percentage
   * @param {number} [options.riskParams.maxAllocationPercent] Maximum percentage of balance to allocate
   * @param {boolean} [options.simulationMode] Whether in simulation mode
   */
  constructor(options = {}) {
    this.exchange = options.exchange;
    this.symbol = options.symbol || 'BTC/USD';
    
    // Set up logger
    this.logger = options.logger || new TradingLogger({
      component: 'PositionManager',
      symbol: this.symbol
    });
    
    // Parse symbol into base and quote currencies
    const [baseCurrency, quoteCurrency] = this.symbol.split('/');
    this.baseCurrency = baseCurrency;
    this.quoteCurrency = quoteCurrency;
    
    // Risk management parameters
    this.riskParams = {
      maxPositionSize: options.riskParams?.maxPositionSize || 1.0, // Default 1 BTC
      maxLeverage: options.riskParams?.maxLeverage || 1.0, // Default no leverage
      maxDrawdown: options.riskParams?.maxDrawdown || 0.05, // Default 5% max drawdown
      stopLossPercent: options.riskParams?.stopLossPercent || 0.02, // Default 2% stop loss
      takeProfitPercent: options.riskParams?.takeProfitPercent || 0.03, // Default 3% take profit
      maxAllocationPercent: options.riskParams?.maxAllocationPercent || 0.7, // Default 70% max allocation
    };
    
    this.simulationMode = options.simulationMode || false;
    
    // Position data
    this.positions = {
      [this.symbol]: {
        netPosition: 0,
        averageEntryPrice: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        totalFees: 0,
        entryTimestamp: null,
        lastUpdateTimestamp: null,
        trades: [],
        riskMetrics: {
          currentDrawdown: 0,
          maxDrawdown: 0,
          exposurePercent: 0,
          leverageUsed: 1.0
        }
      }
    };
    
    // Balance data
    this.balances = {
      [this.baseCurrency]: {
        total: 0,
        available: 0,
        reserved: 0
      },
      [this.quoteCurrency]: {
        total: 0,
        available: 0,
        reserved: 0
      }
    };
    
    // Circuit breakers
    this.circuitBreakers = {
      maxDrawdownBreached: false,
      maxPositionSizeBreached: false,
      maxLeverageBreached: false,
      lastBreachTimestamp: null,
      breachCount: 0,
      cooldownPeriod: 3600000, // 1 hour cooldown after a breach
      active: false
    };
    
    this.logger.info('Position Manager initialized', {
      symbol: this.symbol,
      riskParams: this.riskParams,
      simulationMode: this.simulationMode
    });
  }
  
  /**
   * Update position and balance data from the exchange
   * @returns {Promise<Object>} Updated position and balance data
   */
  async update() {
    try {
      // Get positions from exchange - first check if balanceManager is available
      let positions;
      let netPosition = 0;
      
      try {
        // First try using the balanceManager if available on the exchange
        if (this.exchange.balanceManager) {
          this.logger.debug('Using exchange.balanceManager to get positions');
          const balance = await this.exchange.balanceManager.getBalance();
          
          if (balance && balance.baseAmount !== undefined) {
            // Create position object in the format expected by PositionManager
            const [baseCurrency] = this.symbol.split('/');
            positions = [{
              symbol: baseCurrency,
              size: balance.baseAmount || 0,
              entryPrice: balance.entryPrice || 0,
              unrealizedPnl: balance.unrealizedPnl || 0
            }];
          } else {
            positions = [];
          }
        } else {
          // Fall back to direct exchange call if balanceManager not available
          this.logger.debug('Falling back to exchange.getPositions()');
          positions = await this.exchange.getPositions();
        }
      } catch (error) {
        this.logger.error('Error getting positions, using default empty array', {
          error: error.message,
          stack: error.stack
        });
        // Use empty array if there's an error
        positions = [];
      }
      
      if (positions && positions.length > 0) {
        // Find position for current symbol
        const [baseCurrency] = this.symbol.split('/');
        const symbolPosition = positions.find(pos => pos.symbol === baseCurrency || pos.symbol === this.symbol);
        
        if (symbolPosition) {
          netPosition = symbolPosition.size || 0;
          
          // Update position data
          this.positions[this.symbol] = {
            ...this.positions[this.symbol],
            netPosition,
            averageEntryPrice: symbolPosition.entryPrice || this.positions[this.symbol].averageEntryPrice,
            unrealizedPnl: symbolPosition.unrealizedPnl || 0,
            lastUpdateTimestamp: Date.now()
          };
        }
      }
      
      // Get balances from exchange - first check if balanceManager is available
      let balances;
      try {
        // First try using the balanceManager if available on the exchange
        if (this.exchange.balanceManager) {
          this.logger.debug('Using exchange.balanceManager to get balances');
          const balance = await this.exchange.balanceManager.getBalance();
          
          // Convert BalanceManager format to the format expected by PositionManager
          balances = {
            [this.baseCurrency]: {
              total: balance.baseAmount || 0,
              available: balance.baseAmount || 0,
              reserved: 0
            },
            [this.quoteCurrency]: {
              total: balance.total || 0,
              available: balance.free || 0,
              reserved: balance.allocated || 0
            }
          };
        } else {
          // Fall back to direct exchange call if balanceManager not available
          this.logger.debug('Falling back to exchange.getBalances()');
          balances = await this.exchange.getBalances();
        }
      } catch (error) {
        this.logger.error('Error getting balances, using last known values', {
          error: error.message,
          stack: error.stack
        });
        // Use existing balance values if there's an error
        balances = this.balances;
      }
      
      if (balances) {
        // Update base currency balance
        if (balances[this.baseCurrency]) {
          this.balances[this.baseCurrency] = {
            total: balances[this.baseCurrency].total || 0,
            available: balances[this.baseCurrency].available || 0,
            reserved: balances[this.baseCurrency].reserved || 0
          };
        }
        
        // Update quote currency balance
        if (balances[this.quoteCurrency]) {
          this.balances[this.quoteCurrency] = {
            total: balances[this.quoteCurrency].total || 0,
            available: balances[this.quoteCurrency].available || 0,
            reserved: balances[this.quoteCurrency].reserved || 0
          };
        }
      }
      
      // Update risk metrics
      await this.updateRiskMetrics();
      
      // Check circuit breakers
      this.checkCircuitBreakers();
      
      this.logger.debug('Updated position and balance data', {
        position: this.positions[this.symbol],
        balances: this.balances,
        circuitBreakers: this.circuitBreakers
      });
      
      return {
        position: this.positions[this.symbol],
        balances: this.balances,
        circuitBreakers: this.circuitBreakers
      };
    } catch (error) {
      this.logger.error('Error updating position and balance data', {
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }
  
  /**
   * Update risk metrics based on current position and market data
   * @param {Object} [marketData] Current market data (optional)
   * @returns {Promise<Object>} Updated risk metrics
   */
  async updateRiskMetrics(marketData) {
    try {
      const position = this.positions[this.symbol];
      const quoteBalance = this.balances[this.quoteCurrency].total;
      
      // Get current market price if not provided
      let currentPrice = 0;
      
      // First try to use provided market data
      if (marketData && marketData.price) {
        currentPrice = marketData.price;
        this.logger.debug('Using provided market data price', { price: currentPrice });
      } 
      // Then try to get price from exchange with retry logic
      else if (this.exchange) {
        // Try up to 3 times with increasing delays
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const ticker = await this.exchange.getTicker(this.symbol);
            
            // Properly handle null ticker case
            if (!ticker) {
              this.logger.warn(`Ticker data is null (attempt ${attempt}/3)`);
              if (attempt < 3) {
                // Wait before retrying (exponential backoff)
                const delay = Math.pow(2, attempt) * 100;
                this.logger.debug(`Waiting ${delay}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
              }
              break;
            }
            
            // Handle case where ticker exists but last price is missing
            if (ticker.last) {
              currentPrice = ticker.last;
            } else if (ticker.bid && ticker.ask) {
              currentPrice = (ticker.bid + ticker.ask) / 2;
            } else if (ticker.bid) {
              currentPrice = ticker.bid;
            } else if (ticker.ask) {
              currentPrice = ticker.ask;
            }
            
            if (currentPrice > 0) {
              this.logger.debug('Successfully retrieved price from exchange', { price: currentPrice });
              break; // Exit retry loop if we got a valid price
            }
          } catch (e) {
            this.logger.warn(`Could not get current price from exchange (attempt ${attempt}/3)`, { error: e.message });
            if (attempt < 3) {
              // Wait before retrying (exponential backoff)
              const delay = Math.pow(2, attempt) * 100;
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
      }
      
      // If still no valid price, try to use the last known entry price as fallback
      if (currentPrice <= 0 && position.averageEntryPrice > 0) {
        currentPrice = position.averageEntryPrice;
        this.logger.warn('Using average entry price as fallback', { price: currentPrice });
      }
      
      // If we still don't have a valid price, skip the update
      if (currentPrice <= 0) {
        this.logger.warn('Invalid current price, skipping risk metrics update');
        return position.riskMetrics;
      }
      
      // Calculate position value in quote currency
      const positionValue = Math.abs(position.netPosition * currentPrice);
      
      // Calculate exposure percentage
      const exposurePercent = quoteBalance > 0 ? positionValue / quoteBalance : 0;
      
      // Calculate current drawdown if we have a position
      let currentDrawdown = 0;
      if (position.netPosition !== 0 && position.averageEntryPrice > 0) {
        if (position.netPosition > 0) {
          // Long position
          currentDrawdown = (position.averageEntryPrice - currentPrice) / position.averageEntryPrice;
        } else {
          // Short position
          currentDrawdown = (currentPrice - position.averageEntryPrice) / position.averageEntryPrice;
        }
        
        // Cap at 0 for profitable positions
        currentDrawdown = Math.max(0, currentDrawdown);
      }
      
      // Update max drawdown if current is higher
      const maxDrawdown = Math.max(position.riskMetrics.maxDrawdown, currentDrawdown);
      
      // Update risk metrics
      position.riskMetrics = {
        currentDrawdown,
        maxDrawdown,
        exposurePercent,
        leverageUsed: 1.0, // Default to 1.0 for spot trading
        positionValue,
        currentPrice
      };
      
      return position.riskMetrics;
    } catch (error) {
      this.logger.error('Error updating risk metrics', {
        error: error.message,
        stack: error.stack
      });
      
      return this.positions[this.symbol].riskMetrics;
    }
  }
  
  /**
   * Check circuit breakers based on current risk metrics
   * @returns {boolean} Whether any circuit breaker is active
   */
  checkCircuitBreakers() {
    const position = this.positions[this.symbol];
    const riskMetrics = position.riskMetrics;
    const now = Date.now();
    
    // Check if we're in cooldown period
    if (this.circuitBreakers.lastBreachTimestamp && 
        now - this.circuitBreakers.lastBreachTimestamp < this.circuitBreakers.cooldownPeriod) {
      return this.circuitBreakers.active;
    }
    
    // Reset circuit breakers
    this.circuitBreakers.maxDrawdownBreached = false;
    this.circuitBreakers.maxPositionSizeBreached = false;
    this.circuitBreakers.maxLeverageBreached = false;
    
    // Check drawdown breach
    if (riskMetrics.currentDrawdown > this.riskParams.maxDrawdown) {
      this.circuitBreakers.maxDrawdownBreached = true;
      this.logger.warn('Max drawdown circuit breaker triggered', {
        currentDrawdown: riskMetrics.currentDrawdown,
        maxDrawdown: this.riskParams.maxDrawdown
      });
    }
    
    // Check position size breach
    if (Math.abs(position.netPosition) > this.riskParams.maxPositionSize) {
      this.circuitBreakers.maxPositionSizeBreached = true;
      this.logger.warn('Max position size circuit breaker triggered', {
        currentSize: Math.abs(position.netPosition),
        maxSize: this.riskParams.maxPositionSize
      });
    }
    
    // Check leverage breach
    if (riskMetrics.leverageUsed > this.riskParams.maxLeverage) {
      this.circuitBreakers.maxLeverageBreached = true;
      this.logger.warn('Max leverage circuit breaker triggered', {
        currentLeverage: riskMetrics.leverageUsed,
        maxLeverage: this.riskParams.maxLeverage
      });
    }
    
    // Check if any circuit breaker is active
    const anyBreached = this.circuitBreakers.maxDrawdownBreached || 
                        this.circuitBreakers.maxPositionSizeBreached || 
                        this.circuitBreakers.maxLeverageBreached;
    
    if (anyBreached) {
      this.circuitBreakers.active = true;
      this.circuitBreakers.lastBreachTimestamp = now;
      this.circuitBreakers.breachCount++;
      
      this.logger.warn('Circuit breaker activated', {
        breachCount: this.circuitBreakers.breachCount,
        cooldownPeriod: this.circuitBreakers.cooldownPeriod
      });
    } else {
      this.circuitBreakers.active = false;
    }
    
    return this.circuitBreakers.active;
  }
  
  /**
   * Calculate the maximum order size based on risk parameters
   * @param {string} side Order side ('buy' or 'sell')
   * @param {number} price Order price
   * @returns {number} Maximum order size in base currency
   */
  calculateMaxOrderSize(side, price) {
    try {
      const position = this.positions[this.symbol];
      const quoteBalance = this.balances[this.quoteCurrency].available;
      
      // If circuit breakers are active, return 0
      if (this.circuitBreakers.active) {
        this.logger.warn('Circuit breakers active, max order size is 0');
        return 0;
      }
      
      // Calculate max allocation
      const maxAllocation = quoteBalance * this.riskParams.maxAllocationPercent;
      
      // Calculate max size based on allocation and price
      let maxSize = price > 0 ? maxAllocation / price : 0;
      
      // Adjust for existing position
      if (side === 'buy' && position.netPosition < 0) {
        // Buying to reduce short position, allow full size
        maxSize = Math.min(maxSize, Math.abs(position.netPosition));
      } else if (side === 'sell' && position.netPosition > 0) {
        // Selling to reduce long position, allow full size
        maxSize = Math.min(maxSize, position.netPosition);
      } else if (side === 'buy') {
        // Buying to increase long position, check max position size
        const remainingSize = this.riskParams.maxPositionSize - position.netPosition;
        maxSize = Math.min(maxSize, Math.max(0, remainingSize));
      } else if (side === 'sell') {
        // Selling to increase short position, check max position size
        const remainingSize = this.riskParams.maxPositionSize + position.netPosition;
        maxSize = Math.min(maxSize, Math.max(0, remainingSize));
      }
      
      // Ensure max size is positive
      maxSize = Math.max(0, maxSize);
      
      this.logger.debug('Calculated max order size', {
        side,
        price,
        maxSize,
        quoteBalance,
        maxAllocation,
        netPosition: position.netPosition
      });
      
      return maxSize;
    } catch (error) {
      this.logger.error('Error calculating max order size', {
        error: error.message,
        stack: error.stack
      });
      
      return 0;
    }
  }
  
  /**
   * Record a trade in the position history
   * @param {Object} trade Trade data
   * @param {string} trade.id Trade ID
   * @param {string} trade.side Trade side ('buy' or 'sell')
   * @param {number} trade.price Trade price
   * @param {number} trade.amount Trade amount
   * @param {number} trade.fee Trade fee
   * @param {number} trade.timestamp Trade timestamp
   * @returns {Object} Updated position data
   */
  recordTrade(trade) {
    try {
      const position = this.positions[this.symbol];
      const now = Date.now();
      
      // Validate trade data
      if (!trade || !trade.side || !trade.price || !trade.amount) {
        this.logger.warn('Invalid trade data, skipping record', { trade });
        return position;
      }
      
      // Calculate position change
      const positionChange = trade.side === 'buy' ? trade.amount : -trade.amount;
      
      // Calculate new net position
      const newNetPosition = position.netPosition + positionChange;
      
      // Calculate new average entry price
      let newAverageEntryPrice = position.averageEntryPrice;
      
      if (Math.sign(position.netPosition) !== Math.sign(newNetPosition)) {
        // Position direction changed, reset average price
        newAverageEntryPrice = Math.abs(newNetPosition) > 0 ? trade.price : 0;
      } else if (Math.abs(newNetPosition) > Math.abs(position.netPosition)) {
        // Position increased, update average price
        const existingValue = position.netPosition * position.averageEntryPrice;
        const newValue = positionChange * trade.price;
        newAverageEntryPrice = Math.abs(newNetPosition) > 0 ? 
          Math.abs((existingValue + newValue) / newNetPosition) : 0;
      }
      
      // Calculate realized PnL if reducing position
      let realizedPnl = position.realizedPnl;
      
      if (Math.abs(newNetPosition) < Math.abs(position.netPosition)) {
        const closedSize = Math.abs(position.netPosition) - Math.abs(newNetPosition);
        const priceDiff = trade.price - position.averageEntryPrice;
        const pnlDirection = position.netPosition > 0 ? 1 : -1;
        
        realizedPnl += closedSize * priceDiff * pnlDirection;
      }
      
      // Update position data
      this.positions[this.symbol] = {
        ...position,
        netPosition: newNetPosition,
        averageEntryPrice: newAverageEntryPrice,
        realizedPnl,
        totalFees: position.totalFees + (trade.fee || 0),
        entryTimestamp: position.entryTimestamp || now,
        lastUpdateTimestamp: now,
        trades: [...position.trades, {
          ...trade,
          timestamp: trade.timestamp || now
        }]
      };
      
      // Update balances based on trade
      if (trade.side === 'buy') {
        // Buying base currency, spending quote currency
        this.balances[this.baseCurrency].total += trade.amount;
        this.balances[this.quoteCurrency].total -= trade.amount * trade.price;
      } else {
        // Selling base currency, receiving quote currency
        this.balances[this.baseCurrency].total -= trade.amount;
        this.balances[this.quoteCurrency].total += trade.amount * trade.price;
      }
      
      // Subtract fee from quote currency balance
      if (trade.fee) {
        this.balances[this.quoteCurrency].total -= trade.fee;
      }
      
      this.logger.info('Recorded trade', {
        trade,
        newPosition: this.positions[this.symbol].netPosition,
        newAvgPrice: this.positions[this.symbol].averageEntryPrice,
        realizedPnl: this.positions[this.symbol].realizedPnl
      });
      
      return this.positions[this.symbol];
    } catch (error) {
      this.logger.error('Error recording trade', {
        error: error.message,
        stack: error.stack,
        trade
      });
      
      return this.positions[this.symbol];
    }
  }
  
  /**
   * Check if a position needs risk management action
   * @param {number} currentPrice Current market price
   * @returns {Object|null} Action to take, or null if no action needed
   */
  checkPositionForRiskAction(currentPrice) {
    try {
      const position = this.positions[this.symbol];
      
      // If no position, no action needed
      if (position.netPosition === 0 || position.averageEntryPrice === 0) {
        return null;
      }
      
      // Calculate current PnL percentage
      let pnlPercent = 0;
      
      if (position.netPosition > 0) {
        // Long position
        pnlPercent = (currentPrice - position.averageEntryPrice) / position.averageEntryPrice;
      } else {
        // Short position
        pnlPercent = (position.averageEntryPrice - currentPrice) / position.averageEntryPrice;
      }
      
      // Check stop loss
      if (pnlPercent <= -this.riskParams.stopLossPercent) {
        return {
          action: 'CLOSE',
          reason: 'STOP_LOSS',
          details: {
            currentPrice,
            entryPrice: position.averageEntryPrice,
            pnlPercent,
            stopLossPercent: this.riskParams.stopLossPercent
          }
        };
      }
      
      // Check take profit
      if (pnlPercent >= this.riskParams.takeProfitPercent) {
        return {
          action: 'CLOSE',
          reason: 'TAKE_PROFIT',
          details: {
            currentPrice,
            entryPrice: position.averageEntryPrice,
            pnlPercent,
            takeProfitPercent: this.riskParams.takeProfitPercent
          }
        };
      }
      
      // Check circuit breakers
      if (this.circuitBreakers.active) {
        return {
          action: 'REDUCE',
          reason: 'CIRCUIT_BREAKER',
          details: {
            circuitBreakers: this.circuitBreakers,
            currentPrice,
            entryPrice: position.averageEntryPrice,
            pnlPercent
          }
        };
      }
      
      return null;
    } catch (error) {
      this.logger.error('Error checking position for risk action', {
        error: error.message,
        stack: error.stack,
        currentPrice
      });
      
      return null;
    }
  }
  
  /**
   * Get position summary
   * @returns {Object} Position summary
   */
  getPositionSummary() {
    const position = this.positions[this.symbol];
    
    return {
      symbol: this.symbol,
      netPosition: position.netPosition,
      averageEntryPrice: position.averageEntryPrice,
      unrealizedPnl: position.unrealizedPnl,
      realizedPnl: position.realizedPnl,
      totalFees: position.totalFees,
      riskMetrics: position.riskMetrics,
      circuitBreakers: this.circuitBreakers,
      balances: {
        [this.baseCurrency]: this.balances[this.baseCurrency].available,
        [this.quoteCurrency]: this.balances[this.quoteCurrency].available
      }
    };
  }
  
  /**
   * Reset position and balance data (for testing)
   * @param {Object} [initialData] Initial position and balance data
   */
  reset(initialData = {}) {
    // Only allow in simulation mode
    if (!this.simulationMode) {
      this.logger.warn('Reset called outside of simulation mode, ignoring');
      return;
    }
    
    // Reset position data
    this.positions[this.symbol] = {
      netPosition: initialData.netPosition || 0,
      averageEntryPrice: initialData.averageEntryPrice || 0,
      unrealizedPnl: initialData.unrealizedPnl || 0,
      realizedPnl: initialData.realizedPnl || 0,
      totalFees: initialData.totalFees || 0,
      entryTimestamp: initialData.entryTimestamp || null,
      lastUpdateTimestamp: initialData.lastUpdateTimestamp || null,
      trades: initialData.trades || [],
      riskMetrics: {
        currentDrawdown: 0,
        maxDrawdown: 0,
        exposurePercent: 0,
        leverageUsed: 1.0
      }
    };
    
    // Reset balance data
    this.balances = {
      [this.baseCurrency]: {
        total: initialData.baseBalance?.total || 0,
        available: initialData.baseBalance?.available || 0,
        reserved: initialData.baseBalance?.reserved || 0
      },
      [this.quoteCurrency]: {
        total: initialData.quoteBalance?.total || 0,
        available: initialData.quoteBalance?.available || 0,
        reserved: initialData.quoteBalance?.reserved || 0
      }
    };
    
    // Reset circuit breakers
    this.circuitBreakers = {
      maxDrawdownBreached: false,
      maxPositionSizeBreached: false,
      maxLeverageBreached: false,
      lastBreachTimestamp: null,
      breachCount: 0,
      cooldownPeriod: 3600000, // 1 hour cooldown after a breach
      active: false
    };
    
    this.logger.info('Position and balance data reset', {
      symbol: this.symbol,
      position: this.positions[this.symbol],
      balances: this.balances
    });
  }
}

export default PositionManager;
