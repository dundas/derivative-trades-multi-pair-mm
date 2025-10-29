/**
 * Performance Tracker for Trading Operations
 * 
 * Tracks and measures execution time for critical trading operations
 * to help identify bottlenecks and optimize performance.
 * 
 * Key features:
 * - High-precision timing using process.hrtime.bigint()
 * - Memory-efficient storage of timing checkpoints
 * - Statistical analysis of execution times
 * - Integration with MemoryManager for persistence
 */

export class PerformanceTracker {
  /**
   * Create a new PerformanceTracker
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.memoryManager - Memory manager for persistence (optional)
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.memoryManager = options.memoryManager;
    
    // Performance metrics storage
    this.executionTimes = new Map();  // Map of all operation timings by operation ID
    this.metrics = {
      orderPlacement: {
        total: 0,
        success: 0,
        failed: 0,
        avgTimeMs: 0,
        minTimeMs: Number.MAX_SAFE_INTEGER,
        maxTimeMs: 0,
        p50TimeMs: 0, // Median
        p90TimeMs: 0, // 90th percentile
        p99TimeMs: 0  // 99th percentile
      },
      orderCancellation: {
        total: 0,
        success: 0,
        failed: 0,
        avgTimeMs: 0,
        minTimeMs: Number.MAX_SAFE_INTEGER,
        maxTimeMs: 0,
        p50TimeMs: 0,
        p90TimeMs: 0,
        p99TimeMs: 0
      },
      decisionMaking: {
        total: 0,
        avgTimeMs: 0,
        minTimeMs: Number.MAX_SAFE_INTEGER,
        maxTimeMs: 0
      },
      dataProcessing: {
        total: 0,
        avgTimeMs: 0,
        minTimeMs: Number.MAX_SAFE_INTEGER,
        maxTimeMs: 0
      }
    };
    
    // Keep recent execution times for percentile calculations
    this.recentOrderPlacementTimes = [];
    this.recentOrderCancellationTimes = [];
    this.MAX_RECENT_TIMES = 1000; // Keep last 1000 operations for statistics
    
    this.logger.info('PerformanceTracker initialized');
  }
  
  /**
   * Start timing an operation
   * @param {string} operationId - Unique identifier for the operation
   * @param {string} operationType - Type of operation ('orderPlacement', 'orderCancellation', etc.)
   * @param {Object} metadata - Additional metadata about the operation
   * @returns {string} - The operation ID
   */
  startTiming(operationId, operationType, metadata = {}) {
    const startTime = process.hrtime.bigint();
    const timestamp = Date.now();
    
    this.executionTimes.set(operationId, {
      type: operationType,
      startTime,
      startTimestamp: timestamp,
      checkpoints: [],
      metadata,
      completed: false
    });
    
    return operationId;
  }
  
  /**
   * Record a checkpoint in the timing process
   * @param {string} operationId - The operation ID
   * @param {string} checkpointName - Name of the checkpoint
   */
  recordCheckpoint(operationId, checkpointName) {
    const operation = this.executionTimes.get(operationId);
    if (!operation) return;
    
    const checkpointTime = process.hrtime.bigint();
    const elapsedNs = Number(checkpointTime - operation.startTime);
    const elapsedMs = elapsedNs / 1000000; // Convert to milliseconds
    
    operation.checkpoints.push({
      name: checkpointName,
      time: checkpointTime,
      elapsedMs
    });
  }
  
  /**
   * Complete timing for an operation and update metrics
   * @param {string} operationId - The operation ID
   * @param {boolean} success - Whether the operation was successful
   * @param {Object} finalMetadata - Additional metadata to add to the result
   * @returns {Object} - Timing results
   */
  completeTiming(operationId, success = true, finalMetadata = {}) {
    const operation = this.executionTimes.get(operationId);
    if (!operation) return null;
    
    const endTime = process.hrtime.bigint();
    const endTimestamp = Date.now();
    const elapsedNs = Number(endTime - operation.startTime);
    const elapsedMs = elapsedNs / 1000000; // Convert to milliseconds
    
    operation.endTime = endTime;
    operation.endTimestamp = endTimestamp;
    operation.elapsedMs = elapsedMs;
    operation.success = success;
    operation.completed = true;
    operation.metadata = { ...operation.metadata, ...finalMetadata };
    
    // Update metrics based on operation type
    if (operation.type === 'orderPlacement') {
      this._updateOrderPlacementMetrics(elapsedMs, success);
    } else if (operation.type === 'orderCancellation') {
      this._updateOrderCancellationMetrics(elapsedMs, success);
    } else if (operation.type === 'decisionMaking') {
      this._updateDecisionMakingMetrics(elapsedMs);
    } else if (operation.type === 'dataProcessing') {
      this._updateDataProcessingMetrics(elapsedMs);
    }
    
    // Store in memory manager if available
    if (this.memoryManager && typeof this.memoryManager.set === 'function') {
      const perfKey = `perf:${operation.type}:${operationId}`;
      this.memoryManager.set(perfKey, {
        type: operation.type,
        elapsedMs,
        success,
        startTimestamp: operation.startTimestamp,
        endTimestamp,
        checkpoints: operation.checkpoints,
        metadata: operation.metadata
      }, 3600); // Store for 1 hour
    }
    
    // Log significant performance issues
    if (this._isSignificantPerformanceIssue(operation.type, elapsedMs)) {
      this.logger.warn(`Performance issue detected in ${operation.type}`, {
        operationId,
        elapsedMs,
        metadata: operation.metadata,
        checkpoints: operation.checkpoints.map(cp => ({ name: cp.name, elapsedMs: cp.elapsedMs }))
      });
    }
    
    // Cleanup after completed operations to prevent memory leaks
    // but keep the entry in the map for a short while for potential follow-up queries
    setTimeout(() => {
      this.executionTimes.delete(operationId);
    }, 60000); // Clean up after 1 minute
    
    return {
      operationId,
      type: operation.type,
      elapsedMs,
      success,
      checkpoints: operation.checkpoints,
      metadata: operation.metadata,
      latencyFromEvent: operation.metadata.eventTimestamp ? 
        (operation.startTimestamp - operation.metadata.eventTimestamp) : null
    };
  }
  
  /**
   * Determine if a performance measurement indicates a significant issue
   * @private
   * @param {string} operationType - Type of operation
   * @param {number} elapsedMs - Elapsed time in milliseconds
   * @returns {boolean} - True if performance issue detected
   */
  _isSignificantPerformanceIssue(operationType, elapsedMs) {
    const thresholds = {
      orderPlacement: 500,    // 500ms for order placement is concerning
      orderCancellation: 500, // 500ms for cancellation is concerning
      decisionMaking: 100,    // 100ms for decision making is concerning
      dataProcessing: 200     // 200ms for data processing is concerning
    };
    
    return elapsedMs > (thresholds[operationType] || 1000);
  }
  
  /**
   * Update order placement metrics
   * @private
   * @param {number} elapsedMs - Elapsed time in milliseconds
   * @param {boolean} success - Whether the placement was successful
   */
  _updateOrderPlacementMetrics(elapsedMs, success) {
    const metrics = this.metrics.orderPlacement;
    
    metrics.total++;
    if (success) {
      metrics.success++;
    } else {
      metrics.failed++;
    }
    
    // Update min/max times
    if (elapsedMs < metrics.minTimeMs) {
      metrics.minTimeMs = elapsedMs;
    }
    if (elapsedMs > metrics.maxTimeMs) {
      metrics.maxTimeMs = elapsedMs;
    }
    
    // Update average (running average formula)
    metrics.avgTimeMs = ((metrics.avgTimeMs * (metrics.total - 1)) + elapsedMs) / metrics.total;
    
    // Add to recent times for percentile calculations
    this.recentOrderPlacementTimes.push(elapsedMs);
    if (this.recentOrderPlacementTimes.length > this.MAX_RECENT_TIMES) {
      this.recentOrderPlacementTimes.shift(); // Remove oldest
    }
    
    // Recalculate percentiles if we have enough data
    if (this.recentOrderPlacementTimes.length >= 10) {
      const sorted = [...this.recentOrderPlacementTimes].sort((a, b) => a - b);
      const p50Index = Math.floor(sorted.length * 0.5);
      const p90Index = Math.floor(sorted.length * 0.9);
      const p99Index = Math.floor(sorted.length * 0.99);
      
      metrics.p50TimeMs = sorted[p50Index];
      metrics.p90TimeMs = sorted[p90Index];
      metrics.p99TimeMs = sorted[p99Index];
    }
  }
  
  /**
   * Update order cancellation metrics
   * @private
   * @param {number} elapsedMs - Elapsed time in milliseconds
   * @param {boolean} success - Whether the cancellation was successful
   */
  _updateOrderCancellationMetrics(elapsedMs, success) {
    const metrics = this.metrics.orderCancellation;
    
    metrics.total++;
    if (success) {
      metrics.success++;
    } else {
      metrics.failed++;
    }
    
    // Update min/max times
    if (elapsedMs < metrics.minTimeMs) {
      metrics.minTimeMs = elapsedMs;
    }
    if (elapsedMs > metrics.maxTimeMs) {
      metrics.maxTimeMs = elapsedMs;
    }
    
    // Update average (running average formula)
    metrics.avgTimeMs = ((metrics.avgTimeMs * (metrics.total - 1)) + elapsedMs) / metrics.total;
    
    // Add to recent times for percentile calculations
    this.recentOrderCancellationTimes.push(elapsedMs);
    if (this.recentOrderCancellationTimes.length > this.MAX_RECENT_TIMES) {
      this.recentOrderCancellationTimes.shift(); // Remove oldest
    }
    
    // Recalculate percentiles if we have enough data
    if (this.recentOrderCancellationTimes.length >= 10) {
      const sorted = [...this.recentOrderCancellationTimes].sort((a, b) => a - b);
      const p50Index = Math.floor(sorted.length * 0.5);
      const p90Index = Math.floor(sorted.length * 0.9);
      const p99Index = Math.floor(sorted.length * 0.99);
      
      metrics.p50TimeMs = sorted[p50Index];
      metrics.p90TimeMs = sorted[p90Index];
      metrics.p99TimeMs = sorted[p99Index];
    }
  }
  
  /**
   * Update decision making metrics
   * @private
   * @param {number} elapsedMs - Elapsed time in milliseconds
   */
  _updateDecisionMakingMetrics(elapsedMs) {
    const metrics = this.metrics.decisionMaking;
    
    metrics.total++;
    
    // Update min/max times
    if (elapsedMs < metrics.minTimeMs) {
      metrics.minTimeMs = elapsedMs;
    }
    if (elapsedMs > metrics.maxTimeMs) {
      metrics.maxTimeMs = elapsedMs;
    }
    
    // Update average (running average formula)
    metrics.avgTimeMs = ((metrics.avgTimeMs * (metrics.total - 1)) + elapsedMs) / metrics.total;
  }
  
  /**
   * Update data processing metrics
   * @private
   * @param {number} elapsedMs - Elapsed time in milliseconds
   */
  _updateDataProcessingMetrics(elapsedMs) {
    const metrics = this.metrics.dataProcessing;
    
    metrics.total++;
    
    // Update min/max times
    if (elapsedMs < metrics.minTimeMs) {
      metrics.minTimeMs = elapsedMs;
    }
    if (elapsedMs > metrics.maxTimeMs) {
      metrics.maxTimeMs = elapsedMs;
    }
    
    // Update average (running average formula)
    metrics.avgTimeMs = ((metrics.avgTimeMs * (metrics.total - 1)) + elapsedMs) / metrics.total;
  }
  
  /**
   * Get timing data for a specific operation
   * @param {string} operationId - The operation ID
   * @returns {Object|null} - Timing data if available
   */
  getTimingData(operationId) {
    return this.executionTimes.get(operationId) || null;
  }
  
  /**
   * Get overall performance metrics
   * @returns {Object} - Performance metrics
   */
  getMetrics() {
    return JSON.parse(JSON.stringify(this.metrics)); // Return a copy to prevent modification
  }
  
  /**
   * Reset all metrics (for testing)
   */
  resetMetrics() {
    this.executionTimes.clear();
    this.recentOrderPlacementTimes = [];
    this.recentOrderCancellationTimes = [];
    
    // Reset metrics
    for (const category in this.metrics) {
      this.metrics[category].total = 0;
      this.metrics[category].avgTimeMs = 0;
      this.metrics[category].minTimeMs = Number.MAX_SAFE_INTEGER;
      this.metrics[category].maxTimeMs = 0;
      
      if (category === 'orderPlacement' || category === 'orderCancellation') {
        this.metrics[category].success = 0;
        this.metrics[category].failed = 0;
        this.metrics[category].p50TimeMs = 0;
        this.metrics[category].p90TimeMs = 0;
        this.metrics[category].p99TimeMs = 0;
      }
    }
    
    this.logger.info('Performance metrics reset');
  }
}

export default PerformanceTracker;
