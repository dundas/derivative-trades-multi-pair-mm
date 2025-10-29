/**
 * Position Monitor for Adaptive Market Maker
 * 
 * Provides continuous monitoring of positions and automatically takes
 * corrective actions when risk thresholds are exceeded. Integrates with
 * the PositionManager and provides a configurable approach to risk mitigation.
 */

import { TradingLogger } from '../../../../utils/trading-logger.js';

export class PositionMonitor {
  /**
   * Create a new PositionMonitor
   * @param {Object} options Configuration options
   * @param {Object} options.positionManager Position manager instance
   * @param {Object} options.exchange Exchange adapter instance
   * @param {string} options.symbol Trading symbol
   * @param {Object} [options.logger] Logger instance
   * @param {Object} [options.riskThresholds] Risk threshold configuration
   * @param {number} [options.riskThresholds.criticalDrawdown] Drawdown percentage that triggers immediate position reduction
   * @param {number} [options.riskThresholds.warningDrawdown] Drawdown percentage that triggers alerts and reduces order sizes
   * @param {number} [options.riskThresholds.maxPositionUtilization] Maximum percentage of allowed position size to utilize
   * @param {number} [options.riskThresholds.maxExposurePercent] Maximum percentage of capital to expose to a single position
   * @param {Object} [options.adjustmentConfig] Configuration for position adjustments
   * @param {number} [options.adjustmentConfig.criticalAdjustmentPercent] Percent of position to reduce when critical threshold reached
   * @param {number} [options.adjustmentConfig.warningAdjustmentPercent] Percent of position to reduce when warning threshold reached
   * @param {number} [options.adjustmentConfig.minAdjustmentSize] Minimum adjustment size in base currency units
   * @param {number} [options.monitoringInterval] Milliseconds between position checks (default: 60000)
   */
  constructor(options = {}) {
    // Required parameters
    if (!options.positionManager) {
      throw new Error('Position manager is required for PositionMonitor');
    }
    
    if (!options.exchange) {
      throw new Error('Exchange adapter is required for PositionMonitor');
    }
    
    this.positionManager = options.positionManager;
    this.exchange = options.exchange;
    this.symbol = options.symbol || 'BTC/USD';
    
    // Set up logger
    this.logger = options.logger || new TradingLogger({
      component: 'PositionMonitor',
      symbol: this.symbol
    });
    
    // Risk thresholds
    this.riskThresholds = {
      criticalDrawdown: options.riskThresholds?.criticalDrawdown || 0.08, // 8% critical drawdown
      warningDrawdown: options.riskThresholds?.warningDrawdown || 0.05, // 5% warning drawdown
      maxPositionUtilization: options.riskThresholds?.maxPositionUtilization || 0.9, // 90% of max position
      maxExposurePercent: options.riskThresholds?.maxExposurePercent || 0.3, // 30% of capital
      ...options.riskThresholds
    };
    
    // Adjustment configuration
    this.adjustmentConfig = {
      criticalAdjustmentPercent: options.adjustmentConfig?.criticalAdjustmentPercent || 0.5, // 50% reduction
      warningAdjustmentPercent: options.adjustmentConfig?.warningAdjustmentPercent || 0.25, // 25% reduction
      minAdjustmentSize: options.adjustmentConfig?.minAdjustmentSize || 0.001, // Minimum 0.001 BTC adjustment
      ...options.adjustmentConfig
    };
    
    // Monitoring state
    this.monitoringInterval = options.monitoringInterval || 60000; // Default: check every minute
    this.monitoringActive = false;
    this.monitoringIntervalId = null;
    this.lastCheckTimestamp = null;
    
    // Action history
    this.adjustmentHistory = [];
    
    this.logger.info('Position Monitor initialized', {
      symbol: this.symbol,
      riskThresholds: this.riskThresholds,
      adjustmentConfig: this.adjustmentConfig,
      monitoringInterval: this.monitoringInterval
    });
  }
  
  /**
   * Start position monitoring
   * @returns {boolean} Success status
   */
  startMonitoring() {
    if (this.monitoringActive) {
      this.logger.warn('Position monitoring already active');
      return false;
    }
    
    this.logger.info('Starting position monitoring', {
      interval: this.monitoringInterval
    });
    
    this.monitoringActive = true;
    
    // Perform an initial check
    this.checkPosition();
    
    // Set up interval
    this.monitoringIntervalId = setInterval(() => {
      this.checkPosition();
    }, this.monitoringInterval);
    
    return true;
  }
  
  /**
   * Stop position monitoring
   * @returns {boolean} Success status
   */
  stopMonitoring() {
    if (!this.monitoringActive) {
      this.logger.warn('Position monitoring not active');
      return false;
    }
    
    this.logger.info('Stopping position monitoring');
    
    if (this.monitoringIntervalId) {
      clearInterval(this.monitoringIntervalId);
      this.monitoringIntervalId = null;
    }
    
    this.monitoringActive = false;
    return true;
  }
  
  /**
   * Check position against risk thresholds and take corrective action if needed
   * @returns {Object|null} Action taken or null if no action needed
   */
  async checkPosition() {
    this.lastCheckTimestamp = Date.now();
    
    try {
      // Update position data from exchange
      await this.positionManager.update();
      
      // Get latest market price
      const ticker = await this.exchange.getTicker(this.symbol);
      const lastPrice = ticker?.last || ((ticker?.bid + ticker?.ask) / 2);
      
      if (!lastPrice) {
        this.logger.warn('Unable to get current market price for risk assessment');
        return null;
      }
      
      // Get current position
      const position = this.positionManager.getPositionSummary();
      
      // Calculate position value and exposure
      const positionValue = Math.abs(position.netPosition * lastPrice);
      const totalEquity = this.positionManager.getTotalEquityValue();
      const exposurePercent = totalEquity > 0 ? positionValue / totalEquity : 0;
      
      // Check drawdown
      const { currentDrawdown } = position.riskMetrics;
      
      // Log position status
      this.logger.debug('Position check', {
        netPosition: position.netPosition,
        currentDrawdown,
        exposurePercent,
        positionValue,
        totalEquity,
        lastPrice
      });
      
      // Check for critical threshold breaches
      if (currentDrawdown >= this.riskThresholds.criticalDrawdown) {
        return this._handleCriticalDrawdown(position, lastPrice);
      }
      
      // Check for warning threshold breaches
      if (currentDrawdown >= this.riskThresholds.warningDrawdown) {
        return this._handleWarningDrawdown(position, lastPrice);
      }
      
      // Check for excessive exposure
      if (exposurePercent > this.riskThresholds.maxExposurePercent) {
        return this._handleExcessiveExposure(position, lastPrice, exposurePercent);
      }
      
      // Check if too close to max position size
      const maxPositionSize = this.positionManager.riskParams.maxPositionSize;
      const positionUtilization = Math.abs(position.netPosition) / maxPositionSize;
      
      if (positionUtilization > this.riskThresholds.maxPositionUtilization) {
        return this._handleExcessivePositionSize(position, lastPrice, positionUtilization);
      }
      
      // No risk threshold breached
      return null;
    } catch (error) {
      this.logger.error('Error in position monitoring check', {
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }
  
  /**
   * Handle critical drawdown condition
   * @param {Object} position Current position
   * @param {number} lastPrice Current market price
   * @returns {Object} Action taken
   * @private
   */
  async _handleCriticalDrawdown(position, lastPrice) {
    const action = {
      type: 'CRITICAL_DRAWDOWN',
      timestamp: Date.now(),
      drawdown: position.riskMetrics.currentDrawdown,
      positionBefore: position.netPosition
    };
    
    this.logger.warn('Critical drawdown threshold exceeded', {
      currentDrawdown: position.riskMetrics.currentDrawdown,
      threshold: this.riskThresholds.criticalDrawdown,
      netPosition: position.netPosition
    });
    
    // Calculate adjustment size (percentage of current position)
    const adjustmentPercent = this.adjustmentConfig.criticalAdjustmentPercent;
    const adjustmentSize = Math.abs(position.netPosition * adjustmentPercent);
    
    // Check if adjustment size meets minimum
    if (adjustmentSize >= this.adjustmentConfig.minAdjustmentSize) {
      try {
        // Determine side based on current position
        const side = position.netPosition > 0 ? 'sell' : 'buy';
        
        // Create a market order to reduce position
        const orderParams = {
          symbol: this.symbol,
          type: 'market',
          side: side,
          amount: adjustmentSize,
          price: null // Market order
        };
        
        this.logger.info('Placing position adjustment order', orderParams);
        
        // Place the order
        const result = await this.exchange.createOrder(
          orderParams.symbol,
          orderParams.type,
          orderParams.side,
          orderParams.amount,
          orderParams.price
        );
        
        action.order = result;
        action.status = 'completed';
        action.adjustmentSize = adjustmentSize;
        
        this.logger.info('Position adjustment executed for critical drawdown', {
          orderId: result?.id,
          adjustmentSize,
          side
        });
      } catch (error) {
        action.status = 'failed';
        action.error = error.message;
        
        this.logger.error('Failed to adjust position for critical drawdown', {
          error: error.message,
          stack: error.stack
        });
      }
    } else {
      action.status = 'skipped';
      action.reason = 'adjustment size below minimum';
      
      this.logger.info('Position adjustment skipped, below minimum size', {
        calculatedSize: adjustmentSize,
        minSize: this.adjustmentConfig.minAdjustmentSize
      });
    }
    
    // Record the action
    this.adjustmentHistory.push(action);
    
    return action;
  }
  
  /**
   * Handle warning drawdown condition
   * @param {Object} position Current position
   * @param {number} lastPrice Current market price
   * @returns {Object} Action taken
   * @private
   */
  async _handleWarningDrawdown(position, lastPrice) {
    const action = {
      type: 'WARNING_DRAWDOWN',
      timestamp: Date.now(),
      drawdown: position.riskMetrics.currentDrawdown,
      positionBefore: position.netPosition
    };
    
    this.logger.warn('Warning drawdown threshold exceeded', {
      currentDrawdown: position.riskMetrics.currentDrawdown,
      threshold: this.riskThresholds.warningDrawdown,
      netPosition: position.netPosition
    });
    
    // For warning level, just record the condition - the RiskConstrainedSizingDecorator
    // will automatically reduce sizes based on drawdown
    action.status = 'monitored';
    action.notes = 'Size reduction handled by RiskConstrainedSizingDecorator';
    
    // Record the action
    this.adjustmentHistory.push(action);
    
    return action;
  }
  
  /**
   * Handle excessive exposure condition
   * @param {Object} position Current position
   * @param {number} lastPrice Current market price
   * @param {number} exposurePercent Current exposure percentage
   * @returns {Object} Action taken
   * @private
   */
  async _handleExcessiveExposure(position, lastPrice, exposurePercent) {
    const action = {
      type: 'EXCESSIVE_EXPOSURE',
      timestamp: Date.now(),
      exposurePercent,
      positionBefore: position.netPosition
    };
    
    this.logger.warn('Excessive position exposure threshold exceeded', {
      exposurePercent,
      threshold: this.riskThresholds.maxExposurePercent,
      netPosition: position.netPosition
    });
    
    // Calculate how much to reduce to get below threshold
    const targetExposure = this.riskThresholds.maxExposurePercent * 0.8; // Target 80% of max
    const totalEquity = this.positionManager.getTotalEquityValue();
    const currentValue = Math.abs(position.netPosition * lastPrice);
    const targetValue = totalEquity * targetExposure;
    const reductionRatio = Math.max(0, (currentValue - targetValue) / currentValue);
    const adjustmentSize = Math.abs(position.netPosition * reductionRatio);
    
    // Check if adjustment size meets minimum
    if (adjustmentSize >= this.adjustmentConfig.minAdjustmentSize) {
      try {
        // Determine side based on current position
        const side = position.netPosition > 0 ? 'sell' : 'buy';
        
        // Create a market order to reduce position
        const orderParams = {
          symbol: this.symbol,
          type: 'market',
          side: side,
          amount: adjustmentSize,
          price: null // Market order
        };
        
        this.logger.info('Placing position adjustment order', orderParams);
        
        // Place the order
        const result = await this.exchange.createOrder(
          orderParams.symbol,
          orderParams.type,
          orderParams.side,
          orderParams.amount,
          orderParams.price
        );
        
        action.order = result;
        action.status = 'completed';
        action.adjustmentSize = adjustmentSize;
        
        this.logger.info('Position adjustment executed for excessive exposure', {
          orderId: result?.id,
          adjustmentSize,
          side,
          targetExposure,
          currentExposure: exposurePercent
        });
      } catch (error) {
        action.status = 'failed';
        action.error = error.message;
        
        this.logger.error('Failed to adjust position for excessive exposure', {
          error: error.message,
          stack: error.stack
        });
      }
    } else {
      action.status = 'skipped';
      action.reason = 'adjustment size below minimum';
      
      this.logger.info('Position adjustment skipped, below minimum size', {
        calculatedSize: adjustmentSize,
        minSize: this.adjustmentConfig.minAdjustmentSize
      });
    }
    
    // Record the action
    this.adjustmentHistory.push(action);
    
    return action;
  }
  
  /**
   * Handle excessive position size condition
   * @param {Object} position Current position
   * @param {number} lastPrice Current market price
   * @param {number} positionUtilization Current position utilization ratio
   * @returns {Object} Action taken
   * @private
   */
  async _handleExcessivePositionSize(position, lastPrice, positionUtilization) {
    const action = {
      type: 'EXCESSIVE_SIZE',
      timestamp: Date.now(),
      positionUtilization,
      positionBefore: position.netPosition
    };
    
    this.logger.warn('Position size utilization threshold exceeded', {
      positionUtilization,
      threshold: this.riskThresholds.maxPositionUtilization,
      netPosition: position.netPosition,
      maxPosition: this.positionManager.riskParams.maxPositionSize
    });
    
    // For position size warnings, just record the condition - the RiskConstrainedSizingDecorator
    // will automatically reduce sizes based on position utilization
    action.status = 'monitored';
    action.notes = 'Size reduction handled by RiskConstrainedSizingDecorator';
    
    // Record the action
    this.adjustmentHistory.push(action);
    
    return action;
  }
  
  /**
   * Get the position adjustment history
   * @param {number} [limit] Maximum number of entries to return
   * @returns {Array} Position adjustment history
   */
  getAdjustmentHistory(limit = 10) {
    return this.adjustmentHistory
      .slice(Math.max(0, this.adjustmentHistory.length - limit))
      .reverse();
  }
  
  /**
   * Get risk status summary
   * @returns {Object} Risk status summary
   */
  getRiskStatus() {
    const position = this.positionManager.getPositionSummary();
    const totalEquity = this.positionManager.getTotalEquityValue();
    
    return {
      drawdown: {
        current: position.riskMetrics.currentDrawdown,
        max: position.riskMetrics.maxDrawdown,
        warningThreshold: this.riskThresholds.warningDrawdown,
        criticalThreshold: this.riskThresholds.criticalDrawdown,
        status: this._getRiskLevelStatus(
          position.riskMetrics.currentDrawdown,
          this.riskThresholds.warningDrawdown,
          this.riskThresholds.criticalDrawdown
        )
      },
      exposure: {
        netPosition: position.netPosition,
        positionValue: Math.abs(position.netPosition * position.averageEntryPrice),
        totalEquity,
        exposurePercent: totalEquity > 0 
          ? (Math.abs(position.netPosition * position.averageEntryPrice) / totalEquity)
          : 0,
        threshold: this.riskThresholds.maxExposurePercent,
        status: this._getRiskLevelStatus(
          totalEquity > 0 
            ? (Math.abs(position.netPosition * position.averageEntryPrice) / totalEquity)
            : 0,
          this.riskThresholds.maxExposurePercent * 0.7,
          this.riskThresholds.maxExposurePercent
        )
      },
      positionSize: {
        current: Math.abs(position.netPosition),
        max: this.positionManager.riskParams.maxPositionSize,
        utilization: this.positionManager.riskParams.maxPositionSize > 0
          ? Math.abs(position.netPosition) / this.positionManager.riskParams.maxPositionSize
          : 0,
        threshold: this.riskThresholds.maxPositionUtilization,
        status: this._getRiskLevelStatus(
          this.positionManager.riskParams.maxPositionSize > 0
            ? Math.abs(position.netPosition) / this.positionManager.riskParams.maxPositionSize
            : 0,
          this.riskThresholds.maxPositionUtilization * 0.7,
          this.riskThresholds.maxPositionUtilization
        )
      },
      overallStatus: this._getOverallRiskStatus(position),
      lastUpdated: this.lastCheckTimestamp,
      monitoringActive: this.monitoringActive
    };
  }
  
  /**
   * Get risk level status based on value and thresholds
   * @param {number} value Current value
   * @param {number} warningThreshold Warning threshold
   * @param {number} criticalThreshold Critical threshold
   * @returns {string} Risk status ('OK', 'WARNING', 'CRITICAL')
   * @private
   */
  _getRiskLevelStatus(value, warningThreshold, criticalThreshold) {
    if (value >= criticalThreshold) {
      return 'CRITICAL';
    }
    
    if (value >= warningThreshold) {
      return 'WARNING';
    }
    
    return 'OK';
  }
  
  /**
   * Get overall risk status based on all risk factors
   * @param {Object} position Current position
   * @returns {string} Overall risk status ('OK', 'WARNING', 'CRITICAL')
   * @private
   */
  _getOverallRiskStatus(position) {
    const drawdownStatus = this._getRiskLevelStatus(
      position.riskMetrics.currentDrawdown,
      this.riskThresholds.warningDrawdown,
      this.riskThresholds.criticalDrawdown
    );
    
    const totalEquity = this.positionManager.getTotalEquityValue();
    const exposureStatus = this._getRiskLevelStatus(
      totalEquity > 0 
        ? (Math.abs(position.netPosition * position.averageEntryPrice) / totalEquity)
        : 0,
      this.riskThresholds.maxExposurePercent * 0.7,
      this.riskThresholds.maxExposurePercent
    );
    
    const positionSizeStatus = this._getRiskLevelStatus(
      this.positionManager.riskParams.maxPositionSize > 0
        ? Math.abs(position.netPosition) / this.positionManager.riskParams.maxPositionSize
        : 0,
      this.riskThresholds.maxPositionUtilization * 0.7,
      this.riskThresholds.maxPositionUtilization
    );
    
    // If any status is CRITICAL, overall is CRITICAL
    if (drawdownStatus === 'CRITICAL' || exposureStatus === 'CRITICAL' || positionSizeStatus === 'CRITICAL') {
      return 'CRITICAL';
    }
    
    // If any status is WARNING, overall is WARNING
    if (drawdownStatus === 'WARNING' || exposureStatus === 'WARNING' || positionSizeStatus === 'WARNING') {
      return 'WARNING';
    }
    
    // Otherwise, overall is OK
    return 'OK';
  }
}

export default PositionMonitor;
