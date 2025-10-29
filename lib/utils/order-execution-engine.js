/**
 * Order Execution Engine
 *
 * This module is responsible for executing trading decisions by placing orders
 * through the exchange adapter. It handles order placement, cancellation, and tracking.
 */

import { TradingLogger } from "../../../utils/trading-logger.js";
import { OrderStatus } from './order/OrderStatus.js';

export default class OrderExecutionEngine {
  /**
   * Create a new OrderExecutionEngine
   * @param {Object} config Configuration options
   * @param {Object} config.exchange Exchange adapter
   * @param {Object} config.memoryManager Memory manager for storing state
   * @param {Object} config.logger Logger instance
   * @param {string} config.symbol Trading symbol (e.g., 'BTC/USD')
   * @param {Object} config.redisOrderManager OrderManager instance
   */
  constructor(config) {
    this.exchange = config.exchange;
    this.memoryManager = config.memoryManager;
    this.logger = config.logger || new TradingLogger("OrderExecutionEngine");
    this.symbol = config.symbol;
    this.baseCurrency = config.baseCurrency; // Store baseCurrency
    this.redisOrderManager = config.redisOrderManager; // Store the OrderManager instance

    // Default balances for initialization
    this.defaultBalances = {
      USD: { total: 10000, available: 10000, reserved: 0 },
    };

    this.logger.info("OrderExecutionEngine initialized", {
      exchange: this.exchange ? this.exchange.constructor.name : "none",
      hasMemoryManager: !!this.memoryManager,
      symbol: this.symbol,
    });
  }

  /**
   * Execute a trading decision
   * @param {Object} params Execution parameters
   * @param {Object} params.decision Trading decision from TradingDecisionEngine
   * @param {Object} params.marketData Current market data
   * @param {Object} params.balances Current balances
   * @returns {Promise<Object>} Execution results
   */
  async executeOrder(params) {
    let { decision, marketData, balances = null } = params;
    const startTime = Date.now();

    // Initialize results
    const results = {
      buy: null,
      sell: null,
      canceled: [],
      error: null,
      executionTime: 0,
      newOrderPlaced: false, // Track if a new order was actually placed
    };

    try {
      // Retrieve balances from memory manager if not provided
      if (this.memoryManager) {
        const balanceKey = "current_balances";
        const memoryBalances = this.memoryManager.getBalance(balanceKey);

        if (memoryBalances) {
          balances = memoryBalances;
        }

        // If balances don't exist or USD is missing, initialize them
        if (!balances || !balances.USD) {
          // CRITICAL: No budget defaults allowed - must have explicit budget
          let initialBalance = null;
          
          // Try to get actual budget from memory manager metadata
          if (this.memoryManager) {
            const sessionMetrics = this.memoryManager.getMetrics('session');
            if (sessionMetrics && sessionMetrics.budget && parseFloat(sessionMetrics.budget) > 0) {
              initialBalance = parseFloat(sessionMetrics.budget);
              this.logger.info("Using session budget from memory manager for balance initialization", {
                sessionBudget: initialBalance
              });
            }
          }
          
          // CRITICAL: Exit if no valid budget found - no defaults allowed
          if (!initialBalance || initialBalance <= 0) {
            const errorMessage = "CRITICAL: No valid budget found for balance initialization. Cannot proceed without explicit budget.";
            this.logger.error(errorMessage, {
              memoryManagerAvailable: !!this.memoryManager,
              sessionMetrics: this.memoryManager ? this.memoryManager.getMetrics('session') : null,
              initialBalance
            });
            console.error(errorMessage);
            process.exit(1); // Exit immediately - no trading without explicit budget
          }
          
          balances = {
            USD: { total: initialBalance, available: initialBalance, reserved: 0 },
          };
          this.logger.info("Created balances for paper trading (EXPLICIT BUDGET ENFORCED)", {
            balances: JSON.stringify(balances),
            budgetSource: 'session_budget_required'
          });
          this.memoryManager.addBalance(balanceKey, balances);
        }

        // Log the balances for debugging
        const hasUSD = balances && balances.USD;
        const USDAvailable = hasUSD ? balances.USD.available : 0;
        const USDReserved = hasUSD ? balances.USD.reserved : 0;
        const USDTotal = hasUSD ? balances.USD.total : 0;

        this.logger.info("Using balance from memory manager", {
          balance: JSON.stringify(balances),
          key: balanceKey,
          hasUSD,
          USDAvailable,
          USDReserved,
          USDTotal,
        });
      }

      // Log input parameters
      this.logger.debug("Starting order execution with params", {
        decision: JSON.stringify(decision),
        marketDataPresent: !!marketData,
        balances: balances ? JSON.stringify(balances) : "null",
        symbol: this.symbol,
      });

      // Add detailed debugging for the decision
      this.logger.debug("DETAILED ORDER EXECUTION PARAMS", {
        decision: JSON.stringify(decision),
        balances: JSON.stringify(balances),
        marketData: marketData ? "present" : "missing",
        forceTrade: decision.marketConditions?.forceTrade === true,
        defaultBalances: JSON.stringify(this.defaultBalances),
      });

      // Ensure balances have the correct structure
      if (
        balances &&
        balances.USD &&
        balances.USD.total === 0 &&
        this.defaultBalances.USD &&
        this.defaultBalances.USD.total > 0
      ) {
        this.logger.debug("Detected zero USD balance, using default balance", {
          defaultUsdBalance: this.defaultBalances.USD,
        });
        balances.USD = { ...this.defaultBalances.USD };

        // Update the balance in memory manager
        if (this.memoryManager) {
          this.memoryManager.addBalance("current_balances", balances);
          this.logger.debug(
            "Updated balances in memory manager with default USD balance",
            {
              updatedBalances: JSON.stringify(balances),
            }
          );
        }
      }

      // Check if we should execute the order
      if (!decision.shouldTrade) {
        this.logger.info("Skipping order execution: shouldTrade is false");
        results.executionTime = Date.now() - startTime;
        return results;
      }

      // Validate decision parameters
      if (!decision.action) {
        this.logger.warn("Invalid decision: missing action");
        results.error = "Invalid decision: missing action";
        results.executionTime = Date.now() - startTime;
        return results;
      }

      // Log the start of order execution
      this.logger.info("Starting order execution", {
        action: decision.action,
        side: decision.side,
        price: decision.price,
        size: decision.size,
        reason: decision.reason,
        symbol: this.symbol,
        hasExchange: !!this.exchange,
        exchangeType: this.exchange ? this.exchange.constructor.name : "none",
      });

      // Execute the order based on the action
      if (decision.action === "BUY") {
        const buyResult = await this._placeBuyOrder(decision, marketData, balances);
        if (buyResult) {
            results.buy = buyResult.order;
            results.newOrderPlaced = buyResult.newOrderPlaced;
        } else {
            results.buy = null;
            results.newOrderPlaced = false;
        }
      } else if (decision.action === "SELL") {
        const sellResult = await this._placeSellOrder(decision, marketData, balances);
        if (sellResult) {
            results.sell = sellResult.order;
            results.newOrderPlaced = sellResult.newOrderPlaced;
        } else {
            results.sell = null;
            results.newOrderPlaced = false;
        }
      } else if (decision.action === "HOLD") {
        this.logger.info("HOLD action received, no order placed.", {
          reason: decision.reason, // Include reason if available
        });
        // No order is placed, results.buy and results.sell remain null
        // results.newOrderPlaced remains false
      } else {
        this.logger.warn("Unknown or unhandled action in decision", { // Message changed for clarity
          action: decision.action,
        });
      }

      // Calculate execution time
      results.executionTime = Date.now() - startTime;

      // Log the completion of order execution
      this.logger.info("Order execution complete", {
        executionTime: `${results.executionTime}ms`,
        actionTaken: decision.action, // Added to clarify what action was processed
        buyOrderPlaced: decision.action === "BUY" && results.newOrderPlaced, // Corrected to decision.action and check newOrderPlaced
        sellOrderPlaced: decision.action === "SELL" && results.newOrderPlaced, // Corrected to decision.action and check newOrderPlaced
        orderReused: (decision.action === "BUY" || decision.action === "SELL") && !results.newOrderPlaced && (results.buy || results.sell), // More precise reuse check
        canceledOrders: results.canceled.length,
        error: results.error || "none",
      });

      return results;
    } catch (error) {
      this.logger.error("Error during order execution", {
        error: error.message,
        stack: error.stack,
      });

      results.error = error.message;
      results.executionTime = Date.now() - startTime;

      return results;
    }
  }

  /**
   * Place a buy order
   * @param {Object} decision Trading decision
   * @param {Object} marketData Current market data
   * @param {Object} balances Current balances
   * @returns {Promise<Object>} Created order
   * @private
   */
  async _placeBuyOrder(decision, marketData, balances) {
    try {
      const { price, size, clientOrderId, parentOrderId } = decision;

      // Format price and size
      const formattedPrice = this._formatPrice(price);
      const formattedSize = this._formatSize(size);

      this.logger.info("Placing buy order", {
        symbol: this.symbol,
        price: formattedPrice,
        size: formattedSize,
        clientOrderId,
        parentOrderId
      });

      // Check if we have enough balance
      if (balances && balances.USD) {
        const orderValue = formattedPrice * formattedSize;

        if (orderValue > balances.USD.available) {
          this.logger.warn("Insufficient USD balance for buy order", {
            required: orderValue,
            available: balances.USD.available,
            price: formattedPrice,
            size: formattedSize,
          });

          return null;
        }
      }

      // Prepare params for the exchange
      const paramsForExchange = {};
      if (clientOrderId) paramsForExchange.clientOrderId = clientOrderId;
      if (parentOrderId) paramsForExchange.parentOrderId = parentOrderId;

      // Create the order if no matching orders found
      if (this.exchange) {
        const order = await this.exchange.createOrder(
          this.symbol,
          "limit",
          "buy",
          formattedSize,
          formattedPrice,
          paramsForExchange // Pass the extra parameters here
        );

        this.logger.info("Buy order placed successfully", {
          orderId: order.id,
          price: formattedPrice,
          size: formattedSize,
          status: order.status,
        });

        return { order, newOrderPlaced: true };
      } else {
        this.logger.error(
          "Cannot place buy order: exchange adapter not available"
        );
        return null;
      }
    } catch (error) {
      this.logger.error("Error placing buy order", {
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  /**
   * Place a sell order
   * @param {Object} decision Trading decision
   * @param {Object} marketData Current market data
   * @param {Object} balances Current balances
   * @returns {Promise<Object>} Created order
   * @private
   */
  async _placeSellOrder(decision, marketData, balances) {
    try {
      // Log the received balances object immediately upon entry
      this.logger.info("[OEE._placeSellOrder] Entry - Balances received:", { 
        balances: balances ? JSON.stringify(balances) : 'null or undefined' 
      });

      const { price, size, clientOrderId, parentOrderId } = decision;

      // Format price and size
      const formattedPrice = this._formatPrice(price);
      const formattedSize = this._formatSize(size);

      this.logger.info("Placing sell order", {
        symbol: this.symbol,
        price: formattedPrice,
        size: formattedSize,
        clientOrderId,
        parentOrderId
      });

      // Check balance for the base currency
      if (!this.baseCurrency) {
        this.logger.error(
          "Cannot place sell order: baseCurrency not configured in OrderExecutionEngine."
        );
        return null;
      }

      // ENHANCED: Position-based logic for take-profit orders
      const isTakeProfitOrder = parentOrderId && (
        decision.reason?.includes('Take-Profit') || 
        decision.reason?.includes('take-profit') ||
        decision.reason?.includes('TP') ||
        clientOrderId?.includes('tp-')
      );

      if (isTakeProfitOrder) {
        // For take-profit orders, use position-based validation instead of balance checks
        this.logger.info("[OEE._placeSellOrder] Take-profit order detected - using position-based validation", {
          parentOrderId,
          size: formattedSize,
          reason: decision.reason,
          clientOrderId,
          skipBalanceCheck: true
        });
        
        // Validate that we have a parent order ID for position tracking
        if (!parentOrderId) {
          this.logger.error("Take-profit order missing parentOrderId for position validation", {
            decision,
            formattedSize
          });
          return null;
        }
        
        // Log position-based order creation
        this.logger.info("Creating take-profit order based on filled position", {
          parentBuyOrderId: parentOrderId,
          sellQuantity: formattedSize,
          sellPrice: formattedPrice,
          positionBased: true
        });
        
      } else {
        // For primary orders, check balance as usual
        if (
          balances &&
          balances[this.baseCurrency] &&
          typeof balances[this.baseCurrency].available === "number"
        ) {
          if (formattedSize > balances[this.baseCurrency].available) {
            this.logger.warn(
              `Insufficient ${this.baseCurrency} balance for primary sell order`,
              {
                required: formattedSize,
                available: balances[this.baseCurrency].available,
                currency: this.baseCurrency,
                price: formattedPrice,
                size: formattedSize,
                orderType: 'primary'
              }
            );
            return null;
          }
        } else {
          this.logger.warn(
            `No valid balance information for ${this.baseCurrency} to place primary sell order. Required: ${formattedSize}`,
            {
              balances: balances ? JSON.stringify(balances) : "undefined",
              currency: this.baseCurrency,
              orderType: 'primary'
            }
          );
          return null;
        }
      }

      // Prepare params for the exchange
      const paramsForExchange = {};
      if (clientOrderId) paramsForExchange.clientOrderId = clientOrderId;
      if (parentOrderId) paramsForExchange.parentOrderId = parentOrderId;

      // Create the order if no matching orders found
      if (this.exchange) {
        const order = await this.exchange.createOrder(
          this.symbol,
          "limit",
          "sell",
          formattedSize,
          formattedPrice,
          paramsForExchange // Pass the extra parameters here
        );

        this.logger.info("[OEE._placeSellOrder] Order object received from exchange.createOrder:", { order: order ? JSON.stringify(order) : null });

        this.logger.info("Sell order placed successfully", {
          orderId: order.id,
          price: formattedPrice,
          size: formattedSize,
          status: order.status,
        });

        return { order, newOrderPlaced: true };
      } else {
        this.logger.error(
          "Cannot place sell order: exchange adapter not available"
        );
        return null;
      }
    } catch (error) {
      this.logger.error("Error placing sell order", {
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  /**
   * Format price to correct precision using exchange-specific rules
   * @param {number} price Price to format
   * @returns {number} Formatted price
   * @private
   */
  _formatPrice(price) {
    try {
      // Use the exchange adapter's REST client formatPrice method for proper precision
      if (this.exchange && this.exchange._restClient && this.exchange._restClient.formatPrice) {
        const formattedStr = this.exchange._restClient.formatPrice(price, this.symbol);
        return parseFloat(formattedStr);
      }
      
      // Fallback to exchange adapter's formatPrice if available
      if (this.exchange && this.exchange.formatPrice) {
        return this.exchange.formatPrice(price, this.symbol);
      }
      
      // If no exchange-specific formatting available, fail fast with detailed error
      this.logger.error("Cannot format price: No exchange formatPrice method available", {
        hasExchange: !!this.exchange,
        hasRestClient: !!(this.exchange && this.exchange._restClient),
        hasFormatPrice: !!(this.exchange && this.exchange._restClient && this.exchange._restClient.formatPrice),
        symbol: this.symbol,
        price: price
      });
      
      throw new Error(`Cannot format price for ${this.symbol}: Exchange formatPrice method not available`);
      
    } catch (error) {
      this.logger.error("Error formatting price", {
        error: error.message,
        symbol: this.symbol,
        price: price
      });
      throw error;
    }
  }

  /**
   * Format size to correct precision
   * @param {number} size Size to format
   * @returns {number} Formatted size
   * @private
   */
  _formatSize(size) {
    // Default to 8 decimal places for BTC
    return parseFloat(size.toFixed(8));
  }

  /**
   * Cancel all active orders provided
   * @param {string} reason - Reason for cancellation
   * @param {Object} activeOrders - Object containing active bid and ask orders { bid: order, ask: order }
   * @returns {Promise<Object>} Updated activeOrders object after cancellation attempts
   */
  async cancelAllOrders(reason, activeOrders) {
    this.logger.info("Cancelling all active orders", { reason });
    const updatedOrders = { bid: activeOrders.bid, ask: activeOrders.ask };
    const cancelPromises = [];

    const cancelOrder = async (order, side) => {
      if (order && order.id) {
        try {
          this.logger.debug(`Attempting to cancel ${side} order`, {
            orderId: order.id,
            reason,
          });
          const result = await this.exchange.cancelOrder(order.id);

          // Check cancellation result - exchange adapters might return different structures
          // Assuming a successful cancellation means the order is no longer active
          this.logger.info(
            `${
              side.charAt(0).toUpperCase() + side.slice(1)
            } order cancelled successfully`,
            { orderId: order.id }
          );
          updatedOrders[side] = null; // Remove from active orders if cancellation confirmed
        } catch (error) {
          // Handle cases where order might already be filled or cancelled
          if (
            error.message.includes("Order not found") ||
            error.message.includes("Already closed")
          ) {
            this.logger.warn(
              `${side.charAt(0).toUpperCase() + side.slice(1)} order ${
                order.id
              } already closed or not found, removing from active list.`,
              { reason: error.message }
            );
            updatedOrders[side] = null;
          } else {
            this.logger.error(`Failed to cancel ${side} order ${order.id}`, {
              error: error.message,
              reason,
            });
            // Keep the order in activeOrders if cancellation failed for other reasons
          }
        }
      }
    };

    if (activeOrders.bid) {
      cancelPromises.push(cancelOrder(activeOrders.bid, "bid"));
    }
    if (activeOrders.ask) {
      cancelPromises.push(cancelOrder(activeOrders.ask, "ask"));
    }

    await Promise.all(cancelPromises);
    this.logger.info("Finished attempting to cancel all orders.", {
      remainingBid: updatedOrders.bid ? updatedOrders.bid.id : null,
      remainingAsk: updatedOrders.ask ? updatedOrders.ask.id : null,
    });
    return updatedOrders; // Return the potentially updated active orders object
  }
}