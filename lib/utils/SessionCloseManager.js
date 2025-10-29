/**
 * SessionCloseManager - Handles delayed session closing with fill reconciliation
 * 
 * Addresses the critical issue where orders can be filled 2-3 minutes after session ends
 * but the WebSocket connection is already closed, causing fills to be missed.
 */

import { restClientManager } from './RESTClientManager.js';
import { TradeLedgerManager } from '../../../lib/redis-backend-api/trade-ledger-manager.js';

export class SessionCloseManager {
  constructor(options = {}) {
    this.logger = options.logger;
    this.exchangeAdapter = options.exchangeAdapter;
    this.redisSessionManager = options.redisSessionManager;
    this.redisOrderManager = options.redisOrderManager;
    this.sessionId = options.sessionId;
    this.tradingPair = options.tradingPair;
    
    // Configuration
    this.settlementDelayMs = options.settlementDelayMs || 180000; // 3 minutes default
    this.reconciliationEnabled = options.reconciliationEnabled !== false; // default true
    
    // For pre-cancel reconciliation
    this.tradeLedgerManager = null;
    this.tradingMode = options.tradingMode || 'paper';
    
    // RATE LIMIT FIX: Use shared REST client manager
    restClientManager.setLogger(this.logger);
    
    this.logger.info('[SessionCloseManager] Initialized', {
      sessionId: this.sessionId,
      settlementDelayMs: this.settlementDelayMs,
      reconciliationEnabled: this.reconciliationEnabled
    });
  }
  
  /**
   * Get REST client using shared manager to avoid rate limits
   * @private
   */
  async _getRestClient() {
    // First, try to use the existing REST client from the exchange adapter
    if (this.exchangeAdapter && this.exchangeAdapter._restClient) {
      this.logger.debug('[SessionCloseManager] Using existing REST client from exchange adapter');
      return this.exchangeAdapter._restClient;
    }
    
    // Use shared REST client manager to get/reuse client
    try {
      return await restClientManager.getKrakenClient({
        logger: this.logger
      });
    } catch (error) {
      this.logger.error('[SessionCloseManager] ❌ Failed to get REST client from manager:', error);
      throw new Error(`Failed to get REST client: ${error.message}`);
    }
  }
  
  /**
   * Gets or initializes the TradeLedgerManager instance
   * @private
   */
  async _getTradeLedgerManager() {
    if (this.tradeLedgerManager) {
      return this.tradeLedgerManager;
    }

    if (!this.redisSessionManager || !this.redisSessionManager.redis) {
      this.logger.error('[SessionCloseManager] Redis client is not available for TradeLedgerManager');
      throw new Error('Redis client not available for TradeLedgerManager');
    }

    // Assumes API keys are in environment variables, a standard and secure pattern
    const apiKey = process.env.KRAKEN_API_KEY;
    const apiSecret = process.env.KRAKEN_PRIVATE_KEY;

    if (!this.paperMode && (!apiKey || !apiSecret)) {
      this.logger.error('[SessionCloseManager] ⚠️ Live mode: Missing KRAKEN_API_KEY or KRAKEN_PRIVATE_KEY for pre-cancel reconciliation. Cannot proceed with verification.');
      return null; // Fail gracefully if keys are missing in live mode
    }

    try {
      this.logger.info('[SessionCloseManager] Initializing TradeLedgerManager for pre-cancel reconciliation...');
      const tradeLedgerManager = new TradeLedgerManager({
        redis: this.redisSessionManager.redis,
        logger: this.logger.createChild ? this.logger.createChild({ component: 'TradeLedgerManager' }) : this.logger,
        apiKey: apiKey,
        apiSecret: apiSecret,
        paperMode: this.tradingMode === 'paper'
      });

      await tradeLedgerManager.initialize();
      this.tradeLedgerManager = tradeLedgerManager;
      this.logger.info('[SessionCloseManager] TradeLedgerManager initialized successfully.');
      return this.tradeLedgerManager;
    } catch (error) {
      this.logger.error('[SessionCloseManager] ❌ Failed to initialize TradeLedgerManager:', error);
      return null;
    }
  }
  
  /**
   * Handles session end with delayed closing and fill reconciliation
   * @param {Object} sessionData - Current session data
   * @returns {Promise<Object>} - Results of the close process
   */
  async handleSessionEnd(sessionData) {
    this.logger.info('[SessionCloseManager] Starting enhanced session close process', {
      sessionId: this.sessionId,
      sessionAge: Date.now() - sessionData.startedAt,
      sessionLength: sessionData.sessionLength
    });
    
    const results = {
      phase1_stopNewOrders: false,
      phase2_delayedMonitoring: false,
      phase3_restReconciliation: false,
      phase4_settlement: false,
      fillsDetectedDuringDelay: [],
      reconciliationResults: null,
      settlementResults: null
    };
    
    try {
      // Phase 1: Stop placing new orders but keep connections alive
      await this._reconcileAndCancelOpenBuys();
      results.phase1_stopNewOrders = true;
      this.logger.info('[SessionCloseManager] ✅ Phase 1: Reconciled and cancelled any truly open buy orders');
      
      // Phase 2: Monitor for delayed fills while keeping WebSocket connected
      const monitoringResults = await this._monitorForDelayedFills();
      results.phase2_delayedMonitoring = true;
      results.fillsDetectedDuringDelay = monitoringResults.fillsDetected || [];
      this.logger.info('[SessionCloseManager] ✅ Phase 2: Delayed fill monitoring completed', {
        fillsDetected: results.fillsDetectedDuringDelay.length,
        monitoringDuration: this.settlementDelayMs
      });
      
      // Phase 3: REST API reconciliation to catch any missed fills
      if (this.reconciliationEnabled) {
        const reconciliationResults = await this._performRestApiReconciliation();
        results.phase3_restReconciliation = true;
        results.reconciliationResults = reconciliationResults;
        this.logger.info('[SessionCloseManager] ✅ Phase 3: REST API reconciliation completed', {
          ordersReconciled: reconciliationResults?.ordersReconciled || 0,
          fillsRecovered: reconciliationResults?.fillsRecovered || 0
        });
      } else {
        this.logger.info('[SessionCloseManager] ⏭️ Phase 3: REST API reconciliation skipped (disabled)');
        results.phase3_restReconciliation = true;
      }
      
      // Phase 4: Call settlement service for final reconciliation
      const settlementResults = await this._callSettlementService();
      results.phase4_settlement = true;
      // Only store settlement summary, not the full output which can be massive
      results.settlementSummary = {
        success: settlementResults?.success || false,
        code: settlementResults?.code,
        error: settlementResults?.error?.substring(0, 500) + (settlementResults?.error?.length > 500 ? '...[truncated]' : ''),
        timestamp: Date.now()
      };
      this.logger.info('[SessionCloseManager] ✅ Phase 4: Settlement service completed', {
        settlementSuccess: settlementResults?.success || false
      });
      
      // Update session with enhanced close results
      await this._updateSessionWithCloseResults(results);
      
      this.logger.info('[SessionCloseManager] 🎉 Enhanced session close completed successfully', {
        sessionId: this.sessionId,
        totalFillsRecovered: (results.fillsDetectedDuringDelay.length + 
                             (results.reconciliationResults?.fillsRecovered || 0)),
        allPhasesCompleted: Object.values(results).slice(0, 4).every(Boolean)
      });
      
      return { success: true, results };
      
    } catch (error) {
      this.logger.error('[SessionCloseManager] ❌ Enhanced session close failed', {
        error: error.message,
        stack: error.stack,
        sessionId: this.sessionId,
        completedPhases: results
      });
      
      // Still update session with partial results
      try {
        await this._updateSessionWithCloseResults({ ...results, error: error.message });
      } catch (updateError) {
        this.logger.error('[SessionCloseManager] Failed to update session with error results', updateError);
      }
      
      return { success: false, error: error.message, results };
    }
  }
  
  /**
   * Phase 1: Reconcile open buy orders against trade history before cancelling them.
   * This prevents cancelling an order that was filled but for which we missed the WebSocket message.
   * @private
   */
  async _reconcileAndCancelOpenBuys() {
    this.logger.info('[SessionCloseManager] Starting pre-cancel reconciliation for open buy orders...');

    // Get current session to check status
    const currentSession = await this.redisSessionManager.get();
    const currentStatus = currentSession?.status;
    
    // Only change status to 'closing' if not already 'complete'
    // This prevents overriding the immediate 'complete' status set by the market maker
    const statusUpdate = currentStatus === 'complete' ? 'complete' : 'closing';
    
    await this.redisSessionManager.update({
      sessionId: this.sessionId,
      status: statusUpdate,
      closingPhase: 'RECONCILE_AND_CANCEL',
      closingStartedAt: Date.now(),
      lastUpdated: Date.now()
    });
    
    this.logger.info(`[SessionCloseManager] Session status preserved as '${statusUpdate}' during cleanup`);

    if (!this.redisOrderManager) {
      this.logger.warn('[SessionCloseManager] RedisOrderManager not available, skipping pre-cancel reconciliation.');
      return;
    }

    const allOrders = await this.redisOrderManager.getAll();
    const openBuyOrders = allOrders.filter(order =>
      (order.side === 'buy' || order.side === 'BUY') &&
      (order.status === 'OPEN' || order.status === 'open' || order.status === 'NEW')
    );

    if (openBuyOrders.length === 0) {
      this.logger.info('[SessionCloseManager] No open buy orders found to reconcile or cancel.');
      return;
    }

    this.logger.info(`[SessionCloseManager] Found ${openBuyOrders.length} orders marked as 'open'. Verifying status against trade history...`);

    const tradeLedgerManager = await this._getTradeLedgerManager();
    if (!tradeLedgerManager) {
      this.logger.error('[SessionCloseManager] Could not get TradeLedgerManager. Aborting pre-cancel reconciliation and cancelling all orders without verification as a fallback.');
      await this._cancelOrdersUnsafe(openBuyOrders);
      return;
    }
    
    // Log WebSocket connection status before attempting reconciliation
    if (this.exchangeAdapter && this.exchangeAdapter.ws) {
      const connectionState = this.exchangeAdapter.connectionState || 'unknown';
      const lastMsgTime = this.exchangeAdapter.lastPrivateMessageTimestamp ? 
        `${Math.round((Date.now() - this.exchangeAdapter.lastPrivateMessageTimestamp)/1000)}s ago` : 'unknown';
      
      this.logger.info(`[SESSION_WS_STATUS] WebSocket connection status before reconciliation: ${connectionState}, last message received: ${lastMsgTime}`);
    }
    
    let trulyOpenCount = 0;
    for (const order of openBuyOrders) {
      const exchangeOrderId = order.exchangeOrderId || order.id;

      // First: Verify with Kraken REST API if order is truly open
      const orderStatus = await this._verifyOrderStatusBeforeCancellation(order);
      
      if (orderStatus === 'FILLED') {
        this.logger.info(`[SessionCloseManager] ✅ DETECTED FILLED ORDER via REST API for ${exchangeOrderId}. It was filled but marked as open in Redis.`);
        // Get trade details from TradeLedgerManager
        const trades = await tradeLedgerManager.findTradesByOrderTxId(exchangeOrderId);

        let fillData = null;
        if (trades && trades.length > 0) {
          // Have trade details
          const fill = trades[0]; // Assume first trade is the primary fill
          fillData = {
            orderId: exchangeOrderId,
            clientOrderId: order.id,
            price: parseFloat(fill.price),
            amount: parseFloat(fill.vol),
            side: fill.type,
            fee: parseFloat(fill.fee),
            timestamp: fill.time * 1000,
            reconciliationSource: 'PRE_CANCEL_REST_API_VERIFICATION'
          };
        } else {
          // No trade details, use generic fill data
          fillData = {
            orderId: exchangeOrderId,
            clientOrderId: order.id,
            price: parseFloat(order.price || 0),
            amount: parseFloat(order.size || 0),
            side: order.side,
            fee: 0,
            timestamp: Date.now(),
            reconciliationSource: 'PRE_CANCEL_REST_API_VERIFICATION_NO_DETAILS'
          };
        }

        // 1. Update order status in Redis
        await this.redisOrderManager.update({
          id: order.id, // Use our internal ID
          status: 'FILLED',
          filledAt: fillData.timestamp,
          executedVolume: fillData.amount,
          executedValue: fillData.amount * fillData.price,
          fee: fillData.fee,
          lastUpdated: Date.now(),
          reconciliationSource: 'PRE_CANCEL_REST_API_VERIFICATION'
        });

        // 2. Emit a fill event so the system can react (e.g., create take-profit order)
        if (this.exchangeAdapter) {
          this.exchangeAdapter.emit('fill', fillData);
          this.exchangeAdapter.emit('orderFilled', fillData);
        }
        
      // Check if order was already filled (from TradeLedgerManager)
      } else if (await tradeLedgerManager.findTradesByOrderTxId(exchangeOrderId).then(trades => trades && trades.length > 0)) {
        // FILL DETECTED!
        this.logger.info(`[SessionCloseManager] ✅ RECONCILED FILL for order ${exchangeOrderId}. It was filled but marked as open.`);
        const trades = await tradeLedgerManager.findTradesByOrderTxId(exchangeOrderId);
        const fill = trades[0]; // Assume first trade is the primary fill
        
        const fillData = {
          orderId: exchangeOrderId,
          clientOrderId: order.id,
          price: parseFloat(fill.price),
          amount: parseFloat(fill.vol),
          side: fill.type,
          fee: parseFloat(fill.fee),
          timestamp: fill.time * 1000,
          reconciliationSource: 'PRE_CANCEL_RECONCILIATION'
        };

        // 1. Update order status in Redis
        await this.redisOrderManager.update({
          id: order.id, // Use our internal ID
          status: 'FILLED',
          filledAt: fillData.timestamp,
          executedVolume: fillData.amount,
          executedValue: parseFloat(fill.cost),
          fee: fillData.fee,
          lastUpdated: Date.now(),
          reconciliationSource: 'PRE_CANCEL_RECONCILIATION'
        });

        // 2. Emit a fill event so the system can react (e.g., create take-profit order)
        if (this.exchangeAdapter) {
          this.exchangeAdapter.emit('fill', fillData);
          this.exchangeAdapter.emit('orderFilled', fillData);
        }

      } else {
        // This order is TRULY open. Cancel it.
        this.logger.info(`[SessionCloseManager] Order ${exchangeOrderId} confirmed as open. Proceeding with cancellation.`);
        trulyOpenCount++;
        try {
          if (this.exchangeAdapter && typeof this.exchangeAdapter.cancelOrder === 'function') {
            await this.exchangeAdapter.cancelOrder(order.id, { reason: 'SESSION_CLOSING_VERIFIED_OPEN' });
            this.logger.info(`[SessionCloseManager] Cancelled truly open order ${order.id}`);
          }
        } catch (error) {
          this.logger.warn(`[SessionCloseManager] Failed to cancel verified open order ${order.id}: ${error.message}`);
        }
      }
    }
    this.logger.info(`[SessionCloseManager] Pre-cancel reconciliation summary: ${openBuyOrders.length - trulyOpenCount} fills recovered, ${trulyOpenCount} orders cancelled.`);
  }

  /**
   * Verifies an order's status directly with the Kraken REST API
   * This is a critical check to prevent cancelling orders that are actually filled
   * @param {Object} order - The order to verify
   * @returns {Promise<string>} - The verified order status ('OPEN', 'FILLED', 'CANCELLED', etc.)
   * @private
   */
  async _verifyOrderStatusBeforeCancellation(order) {
    try {
      const exchangeOrderId = order.exchangeOrderId || order.id;
      this.logger.info(`[ORDER_VERIFICATION] Verifying order status for ${exchangeOrderId} via REST API`);
      
      // Get REST client
      const restClient = await this._getRestClient();
      if (!restClient) {
        this.logger.error(`[ORDER_VERIFICATION] No REST client available to verify order status for ${exchangeOrderId}`);
        return 'UNKNOWN'; // Cannot verify, assume original status
      }
      
      // Call REST API to get order status
      let orderDetails = null;
      try {
        // First check closed orders
        const closedOrdersResponse = await restClient.getClosedOrders({ trades: true });
        if (closedOrdersResponse && closedOrdersResponse.result && closedOrdersResponse.result.closed) {
          const closedOrders = closedOrdersResponse.result.closed;
          if (closedOrders[exchangeOrderId]) {
            orderDetails = closedOrders[exchangeOrderId];
            this.logger.info(`[ORDER_VERIFICATION] Found order ${exchangeOrderId} in closed orders with status: ${orderDetails.status}`);
          }
        }
        
        // If not found in closed orders, check open orders
        if (!orderDetails) {
          const openOrdersResponse = await restClient.getOpenOrders();
          if (openOrdersResponse && openOrdersResponse.result && openOrdersResponse.result.open) {
            const openOrders = openOrdersResponse.result.open;
            if (openOrders[exchangeOrderId]) {
              orderDetails = openOrders[exchangeOrderId];
              this.logger.info(`[ORDER_VERIFICATION] Found order ${exchangeOrderId} in open orders with status: ${orderDetails.status}`);
            }
          }
        }
      } catch (apiError) {
        this.logger.error(`[ORDER_VERIFICATION] Error fetching order details from Kraken API: ${apiError.message}`);
        return 'ERROR';
      }
      
      // Map Kraken status to our standardized status
      if (!orderDetails) {
        this.logger.warn(`[ORDER_VERIFICATION] Order ${exchangeOrderId} not found in open or closed orders`);
        return 'NOT_FOUND';
      }
      
      const krakenStatus = orderDetails.status;
      let standardStatus = 'UNKNOWN';
      
      // Map Kraken statuses to our standard statuses
      if (krakenStatus === 'closed' && orderDetails.vol_exec === orderDetails.vol) {
        standardStatus = 'FILLED';
      } else if (krakenStatus === 'closed' && parseFloat(orderDetails.vol_exec) > 0) {
        standardStatus = 'PARTIALLY_FILLED';
      } else if (krakenStatus === 'closed' || krakenStatus === 'canceled' || krakenStatus === 'expired') {
        standardStatus = 'CANCELLED';
      } else if (krakenStatus === 'open' || krakenStatus === 'pending') {
        standardStatus = 'OPEN';
      }
      
      this.logger.info(`[ORDER_VERIFICATION] Order ${exchangeOrderId} verified status: ${standardStatus} (Kraken status: ${krakenStatus})`);
      return standardStatus;
      
    } catch (error) {
      this.logger.error(`[ORDER_VERIFICATION] Error in order verification for ${order.id}: ${error.message}`);
      return 'ERROR';
    }
  }

  /**
   * Fallback to cancel orders without verification if reconciliation fails.
   * @private
   */
  async _cancelOrdersUnsafe(ordersToCancel) {
    this.logger.warn(`[SessionCloseManager] Executing unsafe cancellation for ${ordersToCancel.length} orders.`);
    for (const order of ordersToCancel) {
      try {
        if (this.exchangeAdapter && typeof this.exchangeAdapter.cancelOrder === 'function') {
          await this.exchangeAdapter.cancelOrder(order.id, { reason: 'SESSION_CLOSING_UNVERIFIED_CANCEL' });
          this.logger.info(`[SessionCloseManager] Unsafe cancel for order ${order.id}`);
        }
      } catch (error) {
        this.logger.warn(`[SessionCloseManager] Failed to perform unsafe cancel for order ${order.id}: ${error.message}`);
      }
    }
  }
  
  /**
   * Phase 2: Monitor for delayed fills while keeping WebSocket connected
   * @private
   */
  async _monitorForDelayedFills() {
    this.logger.info(`[SessionCloseManager] Starting delayed fill monitoring for ${this.settlementDelayMs}ms...`);
    
    const fillsDetected = [];
    const startTime = Date.now();
    
    // Check WebSocket status at beginning of monitoring period
    this._logWebSocketStatus('START_MONITORING');
    
    // Set up fill detection during monitoring period
    let fillListener;
    let messageListener;
    if (this.exchangeAdapter) {
      fillListener = (fillData) => {
        this.logger.info('[SessionCloseManager] 🎯 FILL DETECTED during monitoring period!', {
          orderId: fillData.orderId,
          price: fillData.price,
          amount: fillData.amount || fillData.quantity,
          side: fillData.side,
          detectedAt: Date.now(),
          timeAfterSessionEnd: Date.now() - startTime
        });
        fillsDetected.push({
          ...fillData,
          detectedAt: Date.now(),
          detectionPhase: 'DELAYED_MONITORING'
        });
      };
      
      this.exchangeAdapter.on('fill', fillListener);
      this.exchangeAdapter.on('orderFilled', fillListener);
      
      // Add websocket message monitor to track any incoming messages
      messageListener = (message) => {
        if (message && message.channel === 'executions') {
          this.logger.info('[WEBSOCKET_MONITOR] Received execution channel message during monitoring phase');
        }
      };
      this.exchangeAdapter.on('message', messageListener);
    }
    
    // Update session status
    await this.redisSessionManager.update({
      sessionId: this.sessionId,
      closingPhase: 'MONITORING_DELAYED_FILLS',
      monitoringStartedAt: Date.now(),
      lastUpdated: Date.now()
    });
    
    // Set up periodic monitoring during the delay period
    const monitorInterval = 30000; // Check every 30 seconds
    const totalChecks = Math.floor(this.settlementDelayMs / monitorInterval);
    
    for (let i = 0; i < totalChecks; i++) {
      await new Promise(resolve => setTimeout(resolve, monitorInterval));
      this._logWebSocketStatus(`MONITORING_CHECK_${i + 1}`);
      
      // Fetch the latest open orders and check if any have been filled
      await this._checkForRecentlyFilledOrders();
    }
    
    // Wait for any remaining time
    const remainingTime = this.settlementDelayMs - (totalChecks * monitorInterval);
    if (remainingTime > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingTime));
    }
    
    // Final WebSocket status check
    this._logWebSocketStatus('END_MONITORING');
    
    // Remove listeners
    if (this.exchangeAdapter && fillListener) {
      this.exchangeAdapter.off('fill', fillListener);
      this.exchangeAdapter.off('orderFilled', fillListener);
      if (messageListener) {
        this.exchangeAdapter.off('message', messageListener);
      }
    }
    
    this.logger.info(`[SessionCloseManager] Delayed fill monitoring completed`, {
      fillsDetected: fillsDetected.length,
      monitoringDuration: Date.now() - startTime
    });
    
    return { fillsDetected };
  }
  
  /**
   * Logs the current WebSocket connection status
   * @param {string} phase - Current monitoring phase
   * @private
   */
  _logWebSocketStatus(phase) {
    if (!this.exchangeAdapter) return;
    
    try {
      const connectionState = this.exchangeAdapter.connectionState || 'unknown';
      const publicConnectionState = this.exchangeAdapter.publicConnectionState || 'unknown';
      const lastMsgTime = this.exchangeAdapter.lastPrivateMessageTimestamp ? 
        `${Math.round((Date.now() - this.exchangeAdapter.lastPrivateMessageTimestamp)/1000)}s ago` : 'unknown';
      
      this.logger.info(`[WEBSOCKET_MONITOR] [${phase}] WebSocket Status:`, {
        privateConnected: connectionState === 'connected',
        publicConnected: publicConnectionState === 'connected',
        privateState: connectionState,
        publicState: publicConnectionState,
        lastMessageTime: lastMsgTime,
        monitoringPhase: phase,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.warn(`[WEBSOCKET_MONITOR] Error getting WebSocket status: ${error.message}`);
    }
  }
  
  /**
   * Check for orders that have been filled but we might have missed the WebSocket notification
   * @private
   */
  async _checkForRecentlyFilledOrders() {
    if (!this.tradeLedgerManager || !this.redisOrderManager) return;
    
    try {
      // Get all orders that are still marked as OPEN
      const allOrders = await this.redisOrderManager.getAll();
      const openOrders = allOrders.filter(order => 
        order.status === 'OPEN' || order.status === 'open' || order.status === 'NEW'
      );
      
      if (openOrders.length === 0) return;
      
      this.logger.info(`[FILL_CHECK] Checking ${openOrders.length} open orders for missed fills...`);
      
      for (const order of openOrders) {
        const exchangeOrderId = order.exchangeOrderId || order.id;
        
        // Verify status with Kraken REST API
        const orderStatus = await this._verifyOrderStatusBeforeCancellation(order);
        
        if (orderStatus === 'FILLED') {
          this.logger.info(`[FILL_CHECK] ✅ DETECTED MISSED FILL for order ${exchangeOrderId}!`);
          
          // Get trade details
          const trades = await this.tradeLedgerManager.findTradesByOrderTxId(exchangeOrderId);
          let fillData;
          
          if (trades && trades.length > 0) {
            const fill = trades[0];
            fillData = {
              orderId: exchangeOrderId,
              clientOrderId: order.id,
              price: parseFloat(fill.price),
              amount: parseFloat(fill.vol),
              side: fill.type,
              fee: parseFloat(fill.fee),
              timestamp: fill.time * 1000,
              reconciliationSource: 'MONITORING_PERIOD_CHECK'
            };
          } else {
            fillData = {
              orderId: exchangeOrderId,
              clientOrderId: order.id,
              price: parseFloat(order.price || 0),
              amount: parseFloat(order.size || 0),
              side: order.side,
              fee: 0,
              timestamp: Date.now(),
              reconciliationSource: 'MONITORING_PERIOD_CHECK_NO_DETAILS'
            };
          }
          
          // Update order status in Redis
          await this.redisOrderManager.update({
            id: order.id,
            status: 'FILLED',
            filledAt: fillData.timestamp,
            executedVolume: fillData.amount,
            executedValue: fillData.price * fillData.amount,
            fee: fillData.fee,
            lastUpdated: Date.now(),
            reconciliationSource: fillData.reconciliationSource
          });
          
          // Emit fill events
          if (this.exchangeAdapter) {
            this.exchangeAdapter.emit('fill', fillData);
            this.exchangeAdapter.emit('orderFilled', fillData);
          }
        }
      }
    } catch (error) {
      this.logger.error(`[FILL_CHECK] Error checking for recently filled orders: ${error.message}`);
    }
  }
  
  /**
   * Phase 3: REST API reconciliation to catch any missed fills
   * @private
   */
  async _performRestApiReconciliation() {
    this.logger.info('[SessionCloseManager] Starting comprehensive REST API reconciliation...');
    
    // Step 1: Run OrderReconciliationService for deep consistency check
    this.logger.info('[SessionCloseManager] Step 1: Running OrderReconciliationService final reconciliation...');
    let reconciliationFills = 0;
    
    try {
      const { OrderReconciliationService } = await import('../../order-reconciliation-service.js');
      
      const reconciliationService = new OrderReconciliationService({
        paperMode: this.tradingMode === 'paper',
        activeSessionInterval: 30000,  // Faster for session close
        apiCallDelay: 500,             // Faster for session close
        maxConcurrentSessions: 1,
        sessionId: this.sessionId
      });
      
      // Run reconciliation for this specific session
      const reconciliationResults = await reconciliationService.forceReconcileSession(this.sessionId);
      
      if (reconciliationResults.success) {
        reconciliationFills = reconciliationResults.statusCorrections?.length || 0;
        this.logger.info('[SessionCloseManager] OrderReconciliationService completed', {
          statusCorrections: reconciliationResults.statusCorrections?.length || 0,
          fillsRecovered: reconciliationResults.fillsRecovered || 0
        });
      } else {
        this.logger.warn('[SessionCloseManager] OrderReconciliationService failed (continuing with manual reconciliation)');
      }
      
      // Clean up the reconciliation service
      await reconciliationService.stop();
      
    } catch (reconciliationError) {
      this.logger.warn('[SessionCloseManager] OrderReconciliationService failed (non-critical):', reconciliationError.message);
    }
    
    // Step 2: Manual REST API reconciliation as backup
    this.logger.info('[SessionCloseManager] Step 2: Running manual REST API reconciliation as backup...');
    
    try {
      // RATE LIMIT FIX: Use reusable REST client instead of creating new one
      const restClient = await this._getRestClient();
      
      this.logger.debug('[SessionCloseManager] Making REST API calls for reconciliation...');
      
      // Get current state from exchange
      const [closedOrdersResponse, recentTradesResponse] = await Promise.allSettled([
        restClient.getClosedOrders({ trades: true }), // Include trade info
        restClient.getTrades ? restClient.getTrades(this.tradingPair, { limit: 100 }) : Promise.resolve([])
      ]);
      
      let ordersReconciled = 0;
      let fillsRecovered = 0;
      
      // Process closed orders to find any missed fills
      if (closedOrdersResponse.status === 'fulfilled' && closedOrdersResponse.value) {
        const closedOrdersData = closedOrdersResponse.value;
        
        // Handle Kraken response format
        let closedOrders = [];
        if (closedOrdersData.result && closedOrdersData.result.closed) {
          closedOrders = Object.entries(closedOrdersData.result.closed).map(([orderId, orderData]) => ({
            id: orderId,
            ...orderData
          }));
        }
        
        this.logger.info(`[SessionCloseManager] Found ${closedOrders.length} closed orders from REST API`);
        
        // Get our session orders from Redis
        const sessionOrders = await this.redisOrderManager.getAll();
        const sessionOrderIds = new Set(sessionOrders.map(o => o.exchangeOrderId || o.id));
        
        // Check each closed order against our session
        for (const exchangeOrder of closedOrders) {
          if (sessionOrderIds.has(exchangeOrder.id)) {
            // This is one of our orders - check if we have the fill recorded
            const ourOrder = sessionOrders.find(o => (o.exchangeOrderId || o.id) === exchangeOrder.id);
            
            if (ourOrder && ourOrder.status !== 'FILLED' && 
                (exchangeOrder.status === 'closed' || exchangeOrder.vol_exec > 0)) {
              
              this.logger.info('[SessionCloseManager] 🎯 FOUND MISSED FILL via REST reconciliation!', {
                orderId: exchangeOrder.id,
                ourStatus: ourOrder.status,
                exchangeStatus: exchangeOrder.status,
                volumeExecuted: exchangeOrder.vol_exec,
                executedValue: exchangeOrder.cost
              });
              
              // Update our order status
              const updatedOrder = {
                ...ourOrder,
                status: 'FILLED',
                filledAt: Date.now(),
                executedVolume: parseFloat(exchangeOrder.vol_exec || 0),
                executedValue: parseFloat(exchangeOrder.cost || 0),
                lastUpdated: Date.now(),
                reconciliationSource: 'REST_API'
              };
              
              await this.redisOrderManager.update(updatedOrder);
              
              ordersReconciled++;
              fillsRecovered++;
              
              this.logger.info('[SessionCloseManager] ✅ Updated order status from REST reconciliation', {
                orderId: exchangeOrder.id,
                newStatus: 'FILLED'
              });
            }
          }
        }
      } else if (closedOrdersResponse.status === 'rejected') {
        this.logger.warn('[SessionCloseManager] Failed to fetch closed orders:', closedOrdersResponse.reason);
      }
      
      await this.redisSessionManager.update({
        sessionId: this.sessionId,
        closingPhase: 'REST_RECONCILIATION_COMPLETED',
        reconciliationResults: {
          ordersReconciled,
          fillsRecovered,
          completedAt: Date.now()
        },
        lastUpdated: Date.now()
      });
      
      this.logger.info('[SessionCloseManager] ✅ REST API reconciliation completed', {
        ordersReconciled,
        fillsRecovered,
        usedSharedClient: true,
        clientStats: restClientManager.getStats()
      });
      
      return { ordersReconciled, fillsRecovered: fillsRecovered + reconciliationFills };
      
    } catch (error) {
      this.logger.error('[SessionCloseManager] REST API reconciliation failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Phase 4: Call settlement service for final reconciliation
   * @private
   */
  async _callSettlementService() {
    this.logger.info('[SessionCloseManager] Calling settlement service...');
    
    try {
      const { spawn } = await import('child_process');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      
      // Get the correct path to the settlement service
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const settlementServicePath = path.resolve(__dirname, '../settlement-service/run-settlement-service-unified.js');
      
      return new Promise((resolve, reject) => {
        const settlementProcess = spawn('node', [
          settlementServicePath,
          '--mode=one-time',
          '--session-id=' + this.sessionId
        ], {
          env: {
            ...process.env,
            UPSTASH_REDIS_URL: process.env.UPSTASH_REDIS_URL,
            UPSTASH_REDIS_TOKEN: process.env.UPSTASH_REDIS_TOKEN
          },
          stdio: 'pipe'
        });

        let output = '';
        let errorOutput = '';

        settlementProcess.stdout.on('data', (data) => {
          output += data.toString();
        });

        settlementProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        settlementProcess.on('close', (code) => {
          if (code === 0) {
            this.logger.info('[SessionCloseManager] Settlement service completed successfully');
            // Only return success status, not the full output which can be massive
            resolve({ success: true });
          } else {
            this.logger.warn(`[SessionCloseManager] Settlement service exited with code ${code}`);
            // Truncate error output to prevent massive logs in session data
            const truncatedError = errorOutput.length > 1000 ? 
              errorOutput.substring(0, 1000) + '...[truncated]' : errorOutput;
            resolve({ success: false, code, error: truncatedError });
          }
        });

        settlementProcess.on('error', (error) => {
          this.logger.error('[SessionCloseManager] Failed to start settlement service:', error);
          reject(error);
        });

        // Timeout after 30 seconds
        setTimeout(() => {
          settlementProcess.kill();
          reject(new Error('Settlement service timeout'));
        }, 30000);
      });

    } catch (error) {
      this.logger.error('[SessionCloseManager] Failed to call settlement service:', error);
      // Truncate error message to prevent massive logs in session data
      const truncatedError = error.message.length > 500 ? 
        error.message.substring(0, 500) + '...[truncated]' : error.message;
      return { success: false, error: truncatedError };
    }
  }
  
  /**
   * Update session with enhanced close results
   * @private
   */
  async _updateSessionWithCloseResults(results) {
    try {
      // Get current session to check status
      const currentSession = await this.redisSessionManager.get();
      const currentStatus = currentSession?.status;
      
      // Preserve 'complete' status if already set, otherwise use 'closed'
      const finalStatus = currentStatus === 'complete' ? 'complete' : 'closed';
      
      await this.redisSessionManager.update({
        sessionId: this.sessionId,
        status: finalStatus,
        endedAt: Date.now(),
        closingPhase: 'COMPLETED',
        enhancedCloseResults: {
          ...results,
          completedAt: Date.now(),
          method: 'DELAYED_CLOSE_WITH_SETTLEMENT'
        },
        lastUpdated: Date.now()
      });
      
      this.logger.info(`[SessionCloseManager] Session updated with enhanced close results (status: ${finalStatus})`);
    } catch (error) {
      this.logger.error('[SessionCloseManager] Failed to update session with close results', error);
      throw error;
    }
  }
}

export default SessionCloseManager; 