/**
 * Session Metrics Manager
 * 
 * Handles performance metrics collection, analysis, and reporting for trading sessions.
 * Saves metrics to session-logs directory in JSON and markdown formats.
 * Generates performance analysis reports.
 */

import fs from 'fs';
import path from 'path';

class SessionMetricsManager {
  /**
   * Create a new SessionMetricsManager
   * @param {Object} options - Configuration options
   * @param {string} options.sessionId - Session identifier
   * @param {string} options.symbol - Trading pair symbol
   * @param {Object} options.performanceTracker - PerformanceTracker instance
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.metrics - Session metrics
   * @param {string} options.baseLogDir - Base directory for logs (default: 'session-logs')
   */
  constructor(options = {}) {
    this.sessionId = options.sessionId;
    this.symbol = options.symbol;
    this.performanceTracker = options.performanceTracker;
    this.logger = options.logger || console;
    this.metrics = options.metrics || { startTime: Date.now() };
    this.baseLogDir = options.baseLogDir || path.join(process.cwd(), 'session-logs');
    
    // Initialize tracking arrays for fills and order updates
    this.fills = [];
    this.orderUpdates = [];
  }

  /**
   * Record a fill event for metrics tracking
   * @param {Object} fillData - Fill data from the exchange
   */
  recordFill(fillData) {
    try {
      const fillRecord = {
        timestamp: Date.now(),
        orderId: fillData.orderId,
        exchangeOrderId: fillData.exchangeOrderId,
        symbol: fillData.symbol,
        side: fillData.side,
        amount: fillData.amount || fillData.quantity,
        price: fillData.price,
        fee: fillData.fee,
        sessionId: this.sessionId
      };
      
      this.fills.push(fillRecord);
      
      this.logger.debug('[SessionMetricsManager] Fill recorded', {
        fillId: fillData.id,
        orderId: fillData.orderId,
        side: fillData.side,
        amount: fillData.amount || fillData.quantity,
        price: fillData.price
      });
    } catch (error) {
      this.logger.error('[SessionMetricsManager] Error recording fill', {
        error: error.message,
        fillData
      });
    }
  }

  /**
   * Update order status for metrics tracking
   * @param {Object} orderData - Order data with updated status
   */
  updateOrderStatus(orderData) {
    try {
      const updateRecord = {
        timestamp: Date.now(),
        orderId: orderData.id,
        exchangeOrderId: orderData.exchangeOrderId,
        symbol: orderData.symbol,
        side: orderData.side,
        status: orderData.status,
        amount: orderData.amount,
        price: orderData.price,
        filled: orderData.filled,
        sessionId: this.sessionId
      };
      
      this.orderUpdates.push(updateRecord);
      
      this.logger.debug('[SessionMetricsManager] Order status updated', {
        orderId: orderData.id,
        status: orderData.status,
        side: orderData.side
      });
    } catch (error) {
      this.logger.error('[SessionMetricsManager] Error updating order status', {
        error: error.message,
        orderData
      });
    }
  }

  /**
   * Save session metrics to disk
   * @returns {Promise<Object>} Saved file paths
   */
  async saveSessionMetrics() {
    try {
      const performanceData = this.performanceTracker.getMetrics();
      const sessionFolder = path.join(this.baseLogDir, this.sessionId);
      
      // Create session directory if it doesn't exist
      await fs.promises.mkdir(sessionFolder, { recursive: true });
      
      // Create performance metrics file
      const metricsFile = path.join(sessionFolder, 'performance-metrics.json');
      await fs.promises.writeFile(metricsFile, JSON.stringify(performanceData, null, 2));
      
      // Create performance summary markdown file
      const summaryFile = path.join(sessionFolder, 'performance-summary.md');
      const summary = this._generatePerformanceSummary(performanceData);
      await fs.promises.writeFile(summaryFile, summary);
      
      this.logger.info('Performance metrics saved to session logs', { 
        sessionId: this.sessionId,
        metricsFile,
        summaryFile
      });
      
      return { metricsFile, summaryFile };
    } catch (error) {
      this.logger.error('Error saving performance metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate a markdown summary of performance metrics
   * @private
   * @param {Object} metrics Performance metrics
   * @returns {string} Markdown summary
   */
  _generatePerformanceSummary(metrics) {
    const { orderPlacement, orderCancellation, decisionMaking, dataProcessing } = metrics;
    
    // Helper function to safely format numbers with toFixed
    const safeToFixed = (value, decimals = 2) => {
      if (value === undefined || value === null || isNaN(value)) {
        return 'N/A';
      }
      return value.toFixed(decimals);
    };
    
    // Helper function to safely calculate success rate
    const safeSuccessRate = (success, failure) => {
      success = success || 0;
      failure = failure || 0;
      if (success === 0 && failure === 0) {
        return 'N/A';
      }
      return ((success / (success + failure)) * 100).toFixed(1) + '%';
    };
    
    return `# AdaptiveMarketMaker Performance Summary

## Session Information
- **Session ID**: ${this.sessionId}
- **Trading Pair**: ${this.symbol}
- **Duration**: ${Math.floor((Date.now() - (this.metrics.startTime || Date.now())) / 1000)} seconds

## Performance Metrics

### Order Operations
- **Order Placement**:
  - Average: ${safeToFixed(orderPlacement?.average)}ms
  - Min: ${safeToFixed(orderPlacement?.min)}ms
  - Max: ${safeToFixed(orderPlacement?.max)}ms
  - Success Rate: ${safeSuccessRate(orderPlacement?.success, orderPlacement?.failure)}

- **Order Cancellation**:
  - Average: ${safeToFixed(orderCancellation?.average)}ms
  - Min: ${safeToFixed(orderCancellation?.min)}ms
  - Max: ${safeToFixed(orderCancellation?.max)}ms
  - Success Rate: ${safeSuccessRate(orderCancellation?.success, orderCancellation?.failure)}

### Processing Operations
- **Decision Making**:
  - Average: ${safeToFixed(decisionMaking?.average)}ms
  - Min: ${safeToFixed(decisionMaking?.min)}ms
  - Max: ${safeToFixed(decisionMaking?.max)}ms

- **Data Processing**:
  - Average: ${dataProcessing.average.toFixed(2)}ms
  - Min: ${dataProcessing.min.toFixed(2)}ms
  - Max: ${dataProcessing.max.toFixed(2)}ms

## Performance Analysis
${this._generatePerformanceAnalysis(metrics)}
`;
  }
  
  /**
   * Generate performance analysis based on metrics
   * @private
   * @param {Object} metrics Performance metrics
   * @returns {string} Analysis text
   */
  _generatePerformanceAnalysis(metrics) {
    const analysis = [];
    
    // Analyze order placement
    if (metrics.orderPlacement.average > 500) {
      analysis.push('⚠️ **Order placement times are high** - Consider optimizing order submission logic or checking network conditions.');
    }
    
    // Analyze order cancellation
    if (metrics.orderCancellation.average > 500) {
      analysis.push('⚠️ **Order cancellation times are high** - This may impact strategy effectiveness in fast-moving markets.');
    }
    
    // Analyze decision making
    if (metrics.decisionMaking.average > 100) {
      analysis.push('⚠️ **Decision making times are high** - Consider optimizing the TradingDecisionEngine for faster market response.');
    }
    
    // Analyze data processing
    if (metrics.dataProcessing.average > 50) {
      analysis.push('⚠️ **Data processing times are high** - Consider optimizing orderbook and market data processing.');
    }
    
    // Add success rate analysis
    const placementSuccessRate = (metrics.orderPlacement.success / (metrics.orderPlacement.success + metrics.orderPlacement.failure || 1)) * 100;
    if (placementSuccessRate < 95) {
      analysis.push(`⚠️ **Order placement success rate is low (${placementSuccessRate.toFixed(1)}%)** - Investigate reasons for order placement failures.`);
    }
    
    // Return analysis or a positive message if no issues
    return analysis.length > 0 
      ? analysis.join('\n\n')
      : '✅ **All performance metrics are within acceptable ranges** - The market maker is operating efficiently.';
  }
}

export default SessionMetricsManager;
