/**
 * Session Analyzer Module
 * 
 * Provides functions for analyzing trading session performance.
 * Extracted from analyze-session-performance.js to be reusable in API endpoints.
 */

import { formatSymbol, generateRedisKey } from '../../../lib/utils/redis-key-formatter.js';
import { createLogger } from './logger-factory.js';

// Create a logger for the session analyzer
const logger = createLogger('session-analyzer');

// Constants
const DEFAULT_COMMISSION_RATE = 0; // 0% (No commission)
const DEFAULT_SLIPPAGE = 0.0001; // 0.01%

/**
 * Load all session data from Redis
 * @param {Object} redis - Redis client
 * @param {string} sessionId - Session ID
 * @returns {Object} Session data
 */
export async function loadSessionData(redis, sessionId) {
  // Use the standardized Redis key formatter
  const strategy = 'traditional';
  const exchange = 'kraken'; 
  const symbol = 'btc-usd';
  
  const data = {
    session: null,
    orderHistory: [],
    fills: [],
    activeOrders: [],
    balances: null,
    positions: null,
  };
  
  // Load session info
  const sessionKey = generateRedisKey({
    strategy,
    exchange,
    symbol,
    sessionId,
    keyName: 'session'
  });
  
  logger.debug(`Looking for session data at key: ${sessionKey}`);
  const sessionInfo = await redis.get(sessionKey);
  if (sessionInfo) {
    try {
      data.session = typeof sessionInfo === 'string' ? JSON.parse(sessionInfo) : sessionInfo;
      logger.debug('Found session data');
    } catch (e) {
      logger.error('Error parsing session info:', e.message);
    }
  } else {
    logger.warn('Session data not found');
  }
  
  // Load orders
  const ordersKey = generateRedisKey({
    strategy,
    exchange,
    symbol,
    sessionId,
    keyName: 'orders'
  });
  
  logger.debug(`Looking for orders data at key: ${ordersKey}`);
  const orders = await redis.get(ordersKey);
  if (orders) {
    try {
      let parsedOrders = typeof orders === 'string' ? JSON.parse(orders) : orders;
      
      // Handle different structures
      if (Array.isArray(parsedOrders)) {
        data.orderHistory = parsedOrders;
      } else if (parsedOrders && typeof parsedOrders === 'object') {
        if (parsedOrders.orders && Array.isArray(parsedOrders.orders)) {
          data.orderHistory = parsedOrders.orders;
        } else if (parsedOrders.timestamp && parsedOrders.lastUpdated) {
          // Handle the format from our updated OrderManager
          data.orderHistory = parsedOrders;
        }
      }
      logger.debug(`Found ${Array.isArray(data.orderHistory) ? data.orderHistory.length : 0} orders`);
    } catch (e) {
      logger.error('Error parsing orders:', e.message);
    }
  } else {
    logger.debug('Orders data not found');
  }
  
  // Load fills
  const fillsKey = generateRedisKey({
    strategy,
    exchange,
    symbol,
    sessionId,
    keyName: 'fills'
  });
  
  logger.debug(`Looking for fills data at key: ${fillsKey}`);
  const fills = await redis.get(fillsKey);
  if (fills) {
    try {
      if (fills && typeof fills === 'object' && fills.fills && Array.isArray(fills.fills)) {
        data.fills = fills.fills;
      } else {
        const parsedFills = typeof fills === 'string' ? JSON.parse(fills) : fills;
        if (Array.isArray(parsedFills)) {
          data.fills = parsedFills;
        } else if (parsedFills && typeof parsedFills === 'object' && parsedFills.fills && Array.isArray(parsedFills.fills)) {
          data.fills = parsedFills.fills;
        }
      }
      logger.debug(`Found ${Array.isArray(data.fills) ? data.fills.length : 0} fills`);
    } catch (e) {
      logger.error('Error parsing fills:', e.message);
    }
  } else {
    logger.debug('Fills data not found');
  }
  
  // Load positions
  const positionsKey = generateRedisKey({
    strategy,
    exchange,
    symbol,
    sessionId,
    keyName: 'positions'
  });
  
  logger.debug(`Looking for positions data at key: ${positionsKey}`);
  const positions = await redis.get(positionsKey);
  if (positions) {
    try {
      const parsedPositions = typeof positions === 'string' ? JSON.parse(positions) : positions;
      
      // Handle different position data structures
      if (parsedPositions.positions && typeof parsedPositions.positions === 'object') {
        // Handle nested positions structure: { positions: { "BTC/USD": {...} } }
        data.positions = parsedPositions;
        logger.debug(`Loaded positions with nested structure. Keys: ${Object.keys(parsedPositions.positions)}`);
      } else {
        data.positions = parsedPositions;
      }
    } catch (e) {
      logger.error('Error parsing positions:', e.message);
    }
  } else {
    logger.debug('Positions data not found');
  }
  
  return data;
}

/**
 * Generate a performance report from session data
 * @param {Object} sessionData - Session data
 * @returns {Object} Performance report
 */
export function generatePerformanceReport(sessionData) {
  const { session, fills, orderHistory, balances, positions } = sessionData;
  
  // Initialize report object
  const report = {
    sessionId: session?.id || 'unknown',
    symbol: session?.symbol || 'BTC/USD',
    startTime: session?.startedAt || 0,
    endTime: session?.endTime || 0,
    duration: session?.duration || (session?.endTime && session?.startedAt ? session.endTime - session.startedAt : 0),
    status: session?.status || 'unknown',
    tradingMode: session?.tradingMode || 'paper',
    
    // Trading statistics
    totalOrders: orderHistory?.length || 0,
    totalFills: fills?.length || 0,
    filledOrders: 0,
    fillRate: 0,
    
    // P&L metrics
    totalPnl: 0,
    totalPnlPercent: 0,
    totalCommissions: 0,
    effectiveCommissionRate: 0,
    
    // Trade quality metrics
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    avgWinAmount: 0,
    avgLossAmount: 0,
    largestWin: 0,
    largestLoss: 0,
    profitFactor: 0,
    
    // Position metrics
    maxPosition: 0,
    avgPosition: 0,
    
    // Balance metrics
    startingBalance: session?.budget || 1000, // Default to $1000 if not specified
    endingBalance: 0,
    balanceChange: 0,
    balanceChangePercent: 0,
    
    // Volume metrics
    totalVolume: 0,
    
    // Position data
    positions: positions?.positions || [],
  };
  
  // Skip further calculation if no fills
  if (!fills || fills.length === 0) {
    return report;
  }
  
  // Calculate the number of filled orders and fill rate correctly
  if (orderHistory && orderHistory.length > 0) {
    // Check for filled orders using various possible indicators
    const filledOrders = orderHistory.filter(order => 
      order.status === 'filled' || 
      order.filled === true || 
      order.fillPrice || 
      order.fillTime
    ).length;
    
    report.filledOrders = filledOrders;
    report.fillRate = Math.min(filledOrders / orderHistory.length, 1.0); // Cap at 100%
    
    // If we couldn't detect filled orders from order status, use the fills as a proxy
    if (report.filledOrders === 0 && fills && fills.length > 0) {
      // Extract unique order IDs from fills
      const uniqueOrderIds = new Set();
      fills.forEach(fill => {
        if (fill.id || fill.orderId || fill.originalOrderId) {
          uniqueOrderIds.add(fill.id || fill.orderId || fill.originalOrderId);
        }
      });
      
      if (uniqueOrderIds.size > 0) {
        // Ensure we don't exceed the total number of orders
        report.filledOrders = Math.min(uniqueOrderIds.size, orderHistory.length);
        report.fillRate = Math.min(report.filledOrders / orderHistory.length, 1.0); // Cap at 100%
        logger.debug(`Using fill records to estimate filled orders: ${report.filledOrders} filled orders (capped at total orders)`);
      }
    }
  }
  
  // Calculate P&L metrics from fills
  let totalPnl = 0;
  let totalCommissions = 0;
  let totalVolume = 0;
  let winningPnl = 0;
  let losingPnl = 0;
  const winningTrades = [];
  const losingTrades = [];
  
  // Sort fills by timestamp for chronological processing
  const sortedFills = [...fills].sort((a, b) => {
    const timeA = a.fillTime || a.timestamp || 0;
    const timeB = b.fillTime || b.timestamp || 0;
    return timeA - timeB;
  });
  
  // Process each fill
  sortedFills.forEach(fill => {
    // Calculate trade P&L
    const profit = fill.profit || 0;
    totalPnl += profit;
    
    // Calculate commission
    const price = fill.fillPrice || fill.price;
    const size = fill.size;
    const value = price * size;
    totalVolume += value;
    
    const commission = value * DEFAULT_COMMISSION_RATE;
    totalCommissions += commission;
    
    // Categorize trade
    const adjustedProfit = profit - commission;
    if (adjustedProfit >= 0) { // Any non-negative profit is a win
      report.winningTrades++;
      winningPnl += adjustedProfit;
      winningTrades.push(adjustedProfit);
      
      if (adjustedProfit > report.largestWin) {
        report.largestWin = adjustedProfit;
      }
    } else {
      report.losingTrades++;
      losingPnl += Math.abs(adjustedProfit);
      losingTrades.push(adjustedProfit);
      
      if (Math.abs(adjustedProfit) > Math.abs(report.largestLoss)) {
        report.largestLoss = adjustedProfit;
      }
    }
  });
  
  // Calculate aggregate metrics
  report.totalPnl = totalPnl - totalCommissions;
  report.totalCommissions = totalCommissions;
  report.totalVolume = totalVolume;
  
  // Calculate win rate
  const totalTrades = report.winningTrades + report.losingTrades;
  report.winRate = totalTrades > 0 ? report.winningTrades / totalTrades : 0;
  
  // Calculate average win and loss
  report.avgWinAmount = report.winningTrades > 0 ? winningPnl / report.winningTrades : 0;
  report.avgLossAmount = report.losingTrades > 0 ? losingPnl / report.losingTrades : 0;
  
  // Calculate profit factor
  report.profitFactor = losingPnl > 0 ? winningPnl / losingPnl : winningPnl > 0 ? Infinity : 0;
  
  // Calculate balance metrics
  report.endingBalance = report.startingBalance + report.totalPnl;
  report.balanceChange = report.totalPnl;
  report.balanceChangePercent = report.startingBalance > 0 ? (report.balanceChange / report.startingBalance) * 100 : 0;
  
  // Calculate effective commission rate
  report.effectiveCommissionRate = totalVolume > 0 ? (totalCommissions / totalVolume) * 100 : 0;
  
  return report;
}

/**
 * Generate a paired trades report that matches buys with sells using FIFO method
 * @param {Object} orders - Orders
 * @param {Object} fills - Fills
 * @param {Object} session - Session
 * @returns {Object} Paired trades report
 */
export function generatePairedTradesReport(orders, fills, session) {
  // Initialize report
  const report = {
    sessionId: session?.id || 'unknown',
    pairedTrades: [],
    openPositions: [],
    totalRealizedPnl: 0,
    totalUnrealizedPnl: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakEvenTrades: 0,
    avgHoldingPeriod: 0,
    totalStartingBudget: session?.budget || 1000,
    totalTradingVolume: 0
  };
  
  // Skip if no fills
  if (!fills || fills.length === 0) {
    return report;
  }
  
  // Sort fills by timestamp
  const sortedFills = [...fills].sort((a, b) => {
    const timeA = a.fillTime || a.timestamp || 0;
    const timeB = b.fillTime || b.timestamp || 0;
    return timeA - timeB;
  });
  
  // Separate buys and sells
  const buyFills = sortedFills.filter(fill => fill.side === 'buy');
  const sellFills = sortedFills.filter(fill => fill.side === 'sell');
  
  // Calculate total trading volume
  let totalVolume = 0;
  sortedFills.forEach(fill => {
    const price = fill.fillPrice || fill.price || 0;
    const size = fill.size || 0;
    totalVolume += price * size;
  });
  report.totalTradingVolume = totalVolume;
  
  // Track open positions (buys that haven't been matched with sells)
  const openPositions = [];
  
  // Process each buy fill
  buyFills.forEach(buyFill => {
    const buyPrice = buyFill.fillPrice || buyFill.price || 0;
    const buySize = buyFill.size || 0;
    const buyTime = buyFill.fillTime || buyFill.timestamp || 0;
    const buyId = buyFill.id || buyFill.orderId || `buy-${buyTime}`;
    
    // Add to open positions
    openPositions.push({
      id: buyId,
      price: buyPrice,
      size: buySize,
      time: buyTime,
      remainingSize: buySize
    });
  });
  
  // Process each sell fill using FIFO method
  sellFills.forEach(sellFill => {
    const sellPrice = sellFill.fillPrice || sellFill.price || 0;
    const sellSize = sellFill.size || 0;
    const sellTime = sellFill.fillTime || sellFill.timestamp || 0;
    
    let remainingSellSize = sellSize;
    
    // Match with open positions using FIFO
    while (remainingSellSize > 0 && openPositions.length > 0) {
      const position = openPositions[0]; // Get the oldest position
      
      // Calculate the matched size
      const matchedSize = Math.min(position.remainingSize, remainingSellSize);
      
      // Calculate profit
      const profit = (sellPrice - position.price) * matchedSize;
      const profitPercent = position.price > 0 ? (profit / (position.price * matchedSize)) * 100 : 0;
      
      // Calculate holding period
      const holdingPeriod = sellTime - position.time;
      
      // Add to paired trades
      report.pairedTrades.push({
        buyId: position.id,
        sellTime: sellTime,
        buyTime: position.time,
        buyPrice: position.price,
        sellPrice: sellPrice,
        size: matchedSize,
        profit: profit,
        profitPercent: profitPercent,
        holdingPeriod: holdingPeriod
      });
      
      // Update total realized P&L
      report.totalRealizedPnl += profit;
      
      // Update trade statistics
      if (profit > 0) {
        report.winningTrades++;
      } else if (profit < 0) {
        report.losingTrades++;
      } else {
        report.breakEvenTrades++;
      }
      
      // Update position and remaining sell size
      position.remainingSize -= matchedSize;
      remainingSellSize -= matchedSize;
      
      // Remove position if fully matched
      if (position.remainingSize <= 0) {
        openPositions.shift();
      }
    }
  });
  
  // Calculate average holding period
  const totalHoldingPeriod = report.pairedTrades.reduce((sum, trade) => sum + trade.holdingPeriod, 0);
  report.avgHoldingPeriod = report.pairedTrades.length > 0 ? totalHoldingPeriod / report.pairedTrades.length : 0;
  
  // Calculate unrealized P&L for open positions
  const lastPrice = sortedFills.length > 0 ? 
    (sortedFills[sortedFills.length - 1].fillPrice || sortedFills[sortedFills.length - 1].price) : 0;
  
  openPositions.forEach(position => {
    const unrealizedProfit = (lastPrice - position.price) * position.remainingSize;
    const unrealizedProfitPercent = position.price > 0 ? 
      (unrealizedProfit / (position.price * position.remainingSize)) * 100 : 0;
    
    report.openPositions.push({
      id: position.id,
      price: position.price,
      size: position.remainingSize,
      time: position.time,
      currentPrice: lastPrice,
      unrealizedProfit: unrealizedProfit,
      unrealizedProfitPercent: unrealizedProfitPercent
    });
    
    report.totalUnrealizedPnl += unrealizedProfit;
  });
  
  return report;
}

/**
 * Format duration in milliseconds to a human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
export function formatDuration(ms) {
  if (!ms) return 'Unknown';
  
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

/**
 * Analyze session performance
 * @param {Object} redis - Redis client
 * @param {string} sessionId - Session ID
 * @returns {Object} Performance analysis
 */
export async function analyzeSessionPerformance(redis, sessionId) {
  try {
    // Load all session data
    logger.info(`Loading data for session: ${sessionId}...`);
    const sessionData = await loadSessionData(redis, sessionId);
    
    if (!sessionData.session) {
      logger.error(`No session data found for ID: ${sessionId}`);
      return { error: `No session data found for ID: ${sessionId}` };
    }
    
    // Generate performance report
    logger.info('Generating performance report...');
    const performanceReport = generatePerformanceReport(sessionData);
    
    // Generate paired trades report
    const pairedTradesReport = generatePairedTradesReport(
      sessionData.orderHistory, 
      sessionData.fills, 
      sessionData.session
    );
    
    // Combine reports
    return {
      performance: performanceReport,
      pairedTrades: pairedTradesReport,
      sessionData: {
        id: sessionData.session?.id,
        startedAt: sessionData.session?.startedAt,
        status: sessionData.session?.status,
        tradingMode: sessionData.session?.tradingMode
      }
    };
    
  } catch (error) {
    logger.error('Error analyzing session performance:', error);
    return { error: `Error analyzing session performance: ${error.message}` };
  }
}
