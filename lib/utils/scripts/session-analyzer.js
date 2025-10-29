/**
 * Session Analyzer
 * 
 * This script connects to Redis and retrieves detailed information about
 * trading sessions, including performance metrics, trades, and positions.
 * 
 * Usage:
 * node session-analyzer.js [--session-id=<id>] [--recent=<count>]
 */

import dotenv from 'dotenv';
import RedisClient from '../../../../lib/utils/redis-client.js';

// Load environment variables
dotenv.config();

/**
 * Format a timestamp as a human-readable date/time
 */
function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString();
}

/**
 * Format a duration in milliseconds as a human-readable string
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format a number as currency
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/**
 * Format a number as a percentage
 */
function formatPercentage(value) {
  return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2 }).format(value);
}

/**
 * Calculate capital allocation and summary
 */
function calculateCapitalSummary(session, positions, trades) {
  const budget = session.budget || 200; // Default to $200 if not specified
  let allocatedBudget = 0;
  
  // Calculate total allocated budget from positions
  if (positions && positions.length > 0) {
    allocatedBudget = positions.reduce((total, position) => {
      const size = position.size || position.quantity || 0;
      const value = position.entryPrice * size;
      return total + value;
    }, 0);
  }
  
  // Get total profit/loss from completed trades if available
  let totalProfitLoss = session.totalProfitLoss || 0;
  
  // Calculate remaining budget (starting budget - allocated budget + profit/loss)
  const remainingBudget = budget - allocatedBudget + totalProfitLoss;
  
  // Calculate max position size (10% of budget as per our risk management policy)
  const maxPositionSize = budget * 0.1;
  
  // Calculate the maximum total allocation (70% of budget as per state manager)
  const maxAllocationPercentage = 0.7; // 70%
  const maxTotalAllocation = budget * maxAllocationPercentage;
  
  return {
    budget,
    allocatedBudget,
    remainingBudget,
    allocationPercentage: allocatedBudget / budget,
    maxPositionSize,
    maxPositionPercentage: 0.1, // 10% of budget per position
    maxTotalAllocation,
    maxAllocationPercentage,
    totalProfitLoss
  };
}

/**
 * Display session details
 */
async function displaySessionDetails(session, trades, positions) {
  console.log('\n==== SESSION DETAILS ====');
  console.log(`ID: ${session.id}`);
  console.log(`Status: ${session.status}`);
  console.log(`Trading Mode: ${session.tradingMode}`);
  console.log(`Started: ${formatTimestamp(session.startedAt)}`);
  
  if (session.endedAt) {
    console.log(`Ended: ${formatTimestamp(session.endedAt)}`);
    console.log(`Duration: ${formatDuration(session.endedAt - session.startedAt)}`);
  } else {
    console.log(`Duration so far: ${formatDuration(Date.now() - session.startedAt)}`);
  }
  
  console.log(`\nPerformance:`);
  console.log(`Total P&L: ${formatCurrency(session.totalProfitLoss || 0)}`);
  console.log(`Current Drawdown: ${formatPercentage((session.currentDrawdown || 0) / 200)}`);
  console.log(`Max Drawdown: ${formatPercentage((session.maxDrawdown || 0) / 200)}`);
  console.log(`Trade Count: ${session.tradeCount || 0}`);
  console.log(`Successful Trades: ${session.successfulTradeCount || 0}`);
  console.log(`Win Rate: ${formatPercentage(session.tradeCount ? (session.successfulTradeCount || 0) / session.tradeCount : 0)}`);
  
  // Calculate and display capital allocation summary
  const capitalSummary = calculateCapitalSummary(session, positions, trades);
  console.log('\n==== CAPITAL ALLOCATION ====');
  console.log(`Starting Budget: ${formatCurrency(capitalSummary.budget)}`);
  console.log(`Allocated Budget: ${formatCurrency(capitalSummary.allocatedBudget)} (${formatPercentage(capitalSummary.allocationPercentage)})`);
  console.log(`Remaining Budget: ${formatCurrency(capitalSummary.remainingBudget)}`);
  console.log(`Max Position Size: ${formatCurrency(capitalSummary.maxPositionSize)} (${formatPercentage(capitalSummary.maxPositionPercentage)} of budget)`);
  console.log(`Max Total Allocation: ${formatCurrency(capitalSummary.maxTotalAllocation)} (${formatPercentage(capitalSummary.maxAllocationPercentage)} of budget)`);
  console.log(`Total Profit/Loss: ${formatCurrency(capitalSummary.totalProfitLoss)}`);
  
  // If we have both trades and positions, show a capital flow timeline
  if ((trades && trades.length > 0) || (positions && positions.length > 0)) {
    console.log('\n==== CAPITAL FLOW TIMELINE ====');
    
    // Create a combined timeline of trades and positions
    const events = [];
    
    // Add position entries to timeline
    if (positions && positions.length > 0) {
      positions.forEach(position => {
        const size = position.size || position.quantity;
        const value = position.entryPrice * size;
        events.push({
          type: 'position_open',
          id: position.id,
          timestamp: position.entryTime,
          symbol: position.symbol,
          price: position.entryPrice,
          size: size,
          value: value
        });
      });
    }
    
    // Add trade entries to timeline
    if (trades && trades.length > 0) {
      trades.forEach(trade => {
        events.push({
          type: trade.type === 'buy' ? 'buy_trade' : 'sell_trade',
          id: trade.id,
          timestamp: trade.timestamp, 
          symbol: trade.symbol,
          price: trade.price,
          size: trade.size,
          value: trade.value,
          profitLoss: trade.profitLoss
        });
      });
    }
    
    // Sort events by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);
    
    // Initialize tracking values
    let runningCapital = capitalSummary.budget;
    let allocatedCapital = 0;
    
    // Display the timeline
    if (events.length > 0) {
      events.forEach((event, index) => {
        const time = formatTimestamp(event.timestamp);
        let description = '';
        let capitalChange = 0;
        
        if (event.type === 'position_open') {
          description = `Position opened: ${event.symbol} - ${event.size} @ ${formatCurrency(event.price)}`;
          capitalChange = -event.value;
          allocatedCapital += event.value;
        } else if (event.type === 'buy_trade') {
          description = `Buy trade: ${event.symbol} - ${event.size} @ ${formatCurrency(event.price)}`;
          capitalChange = -event.value;
          allocatedCapital += event.value;
        } else if (event.type === 'sell_trade') {
          description = `Sell trade: ${event.symbol} - ${event.size} @ ${formatCurrency(event.price)}`;
          capitalChange = event.value;
          allocatedCapital -= event.value;
          if (event.profitLoss) {
            description += ` (P&L: ${formatCurrency(event.profitLoss)})`;
          }
        }
        
        // Update running capital
        runningCapital += capitalChange;
        
        console.log(`[${time}] ${description}`);
        console.log(`  Capital Change: ${capitalChange >= 0 ? '+' : ''}${formatCurrency(capitalChange)}`);
        console.log(`  Available Capital: ${formatCurrency(runningCapital)}`);
        console.log(`  Allocated Capital: ${formatCurrency(allocatedCapital)} (${formatPercentage(allocatedCapital/capitalSummary.budget)})`); 
      });
    } else {
      console.log('No capital flow events recorded for this session.');
    }
  }
  
  if (trades && trades.length > 0) {
    console.log('\n==== TRADES ====');
    trades.forEach((trade, index) => {
      console.log(`\nTrade #${index + 1}:`);
      console.log(`  ID: ${trade.id}`);
      console.log(`  Type: ${trade.type}`);
      console.log(`  Symbol: ${trade.symbol}`);
      console.log(`  Price: ${formatCurrency(trade.price)}`);
      console.log(`  Size: ${trade.size}`);
      console.log(`  Value: ${formatCurrency(trade.value)}`);
      console.log(`  Time: ${formatTimestamp(trade.timestamp)}`);
      console.log(`  P&L: ${trade.profitLoss ? formatCurrency(trade.profitLoss) : 'N/A'}`);
    });
  }
  
  if (positions && positions.length > 0) {
    console.log('\n==== POSITIONS ====');
    positions.forEach((position, index) => {
      console.log(`\nPosition #${index + 1}:`);
      console.log(`  ID: ${position.id}`);
      console.log(`  Symbol: ${position.symbol}`);
      console.log(`  Entry Price: ${formatCurrency(position.entryPrice)}`);
      console.log(`  Size: ${position.size || position.quantity}`);
      const size = position.size || position.quantity;
      const value = position.entryPrice * size;
      console.log(`  Value: ${formatCurrency(value)}`);
      console.log(`  Percentage of Budget: ${formatPercentage(value / capitalSummary.budget)}`);
      console.log(`  Opened: ${formatTimestamp(position.entryTime)}`);
      console.log(`  Age: ${formatDuration(Date.now() - position.entryTime)}`);
      
      if (position.stopLoss) {
        console.log(`  Stop Loss: ${formatCurrency(position.stopLoss)}`);
      }
      
      if (position.takeProfit) {
        console.log(`  Take Profit: ${formatCurrency(position.takeProfit)}`);
      }
    });
  }
}

/**
 * Analyze a trading session
 * 
 * @param {Object} options - Options for the analyzer
 * @param {string} [options.sessionId] - Specific session ID to analyze
 * @param {number} [options.recentCount=1] - Number of recent sessions to analyze
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeSession(options = {}) {
  const { sessionId, recentCount = 1 } = options;
  
  try {
    // Redis key prefixes
    const keyPrefix = 'market-maker:kraken:btc-usd:';
    const stateKey = `${keyPrefix}state`;
    const positionsKey = `${keyPrefix}positions`;
    const activeSessionKey = `${keyPrefix}active-session`;
    const recentSessionsKey = `${keyPrefix}recent-sessions`;
    const tradesKey = `${keyPrefix}trades`;
    const metricsKey = `${keyPrefix}metrics`;
    
    // Initialize Redis client
    const redis = new RedisClient({
  url: process.env.REDIS_URL,
  token: process.env.DO_REDIS_TOKEN
    });
    
    console.log('Connecting to Redis...');
    
    let sessionsToAnalyze = [];
    
    // If session ID is provided, get that specific session
    if (sessionId) {
      // Check if it's the active session
      const activeSessionStr = await redis.get(activeSessionKey);
      let activeSession = null;
      
      if (activeSessionStr) {
        if (typeof activeSessionStr === 'string') {
          try {
            activeSession = JSON.parse(activeSessionStr);
          } catch (e) {
            console.warn(`Failed to parse active session as JSON: ${e.message}`);
            activeSession = null;
          }
        } else {
          activeSession = activeSessionStr;
        }
      }
      
      if (activeSession && activeSession.id === sessionId) {
        sessionsToAnalyze.push(activeSession);
      } else {
        // Check in recent sessions
        const recentSessionsStr = await redis.get(recentSessionsKey);
        let recentSessions = [];
        
        if (recentSessionsStr) {
          if (typeof recentSessionsStr === 'string') {
            try {
              recentSessions = JSON.parse(recentSessionsStr);
              // Ensure it's an array
              if (!Array.isArray(recentSessions)) {
                console.warn('Recent sessions data is not an array, initializing empty array');
                recentSessions = [];
              }
            } catch (e) {
              console.warn(`Failed to parse recent sessions as JSON: ${e.message}`);
              recentSessions = [];
            }
          } else {
            recentSessions = recentSessionsStr;
          }
        }
        
        const matchingSession = recentSessions.find(s => s.id === sessionId);
        if (matchingSession) {
          sessionsToAnalyze.push(matchingSession);
        } else {
          console.error(`Session with ID ${sessionId} not found`);
          return { success: false, error: 'Session not found' };
        }
      }
    } else {
      // Get the most recent sessions
      const activeSessionStr = await redis.get(activeSessionKey);
      let activeSession = null;
      
      if (activeSessionStr) {
        if (typeof activeSessionStr === 'string') {
          try {
            activeSession = JSON.parse(activeSessionStr);
          } catch (e) {
            console.warn(`Failed to parse active session as JSON: ${e.message}`);
            activeSession = null;
          }
        } else {
          activeSession = activeSessionStr;
        }
      }
      
      const recentSessionsStr = await redis.get(recentSessionsKey);
      let recentSessions = [];
      
      if (recentSessionsStr) {
        if (typeof recentSessionsStr === 'string') {
          try {
            recentSessions = JSON.parse(recentSessionsStr);
            // Ensure it's an array
            if (!Array.isArray(recentSessions)) {
              console.warn('Recent sessions data is not an array, initializing empty array');
              recentSessions = [];
            }
          } catch (e) {
            console.warn(`Failed to parse recent sessions as JSON: ${e.message}`);
            recentSessions = [];
          }
        } else {
          recentSessions = recentSessionsStr;
        }
      }
      
      // Sort recent sessions by start time (newest first)
      recentSessions.sort((a, b) => b.startedAt - a.startedAt);
      
      // Add active session if it exists
      if (activeSession) {
        sessionsToAnalyze.push(activeSession);
      }
      
      // Add recent sessions up to the requested count
      const remainingCount = recentCount - sessionsToAnalyze.length;
      if (remainingCount > 0 && recentSessions.length > 0) {
        sessionsToAnalyze = sessionsToAnalyze.concat(recentSessions.slice(0, remainingCount));
      }
    }
    
    // If no sessions found, return error
    if (sessionsToAnalyze.length === 0) {
      console.error('No sessions found');
      return { success: false, error: 'No sessions found' };
    }
    
    // Analyze each session
    const results = [];
    for (const session of sessionsToAnalyze) {
      // Get trades for this session
      const trades = [];
      // Get positions for this session
      let positions = [];
      
      try {
        // Get positions from Redis set
        const positionIds = await redis.sMembers(`positions:${session.id}`);
        
        if (positionIds && positionIds.length > 0) {
          for (const posId of positionIds) {
            const positionData = await redis.get(`position:${posId}`);
            if (positionData) {
              positions.push(positionData);
            }
          }
        }
      } catch (error) {
        console.warn(`Error getting positions for session ${session.id}:`, error);
      }
      
      // Display session details
      await displaySessionDetails(session, trades, positions);
      
      results.push({
        session,
        trades,
        positions
      });
    }
    
    return { success: true, results };
  } catch (error) {
    console.error('Error analyzing session:', error);
    return { success: false, error: error.message };
  }
}

// Run the script if called directly
if (process.argv[1].includes('session-analyzer.js')) {
  // Process command line arguments
  const args = process.argv.slice(2);
  let sessionId = null;
  let recentCount = 1;
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--session-id=')) {
      sessionId = arg.split('=')[1];
    } else if (arg.startsWith('--recent=')) {
      recentCount = parseInt(arg.split('=')[1], 10);
      if (isNaN(recentCount) || recentCount <= 0) {
        console.error('Error: Recent count must be a positive number');
        process.exit(1);
      }
    }
  }
  
  analyzeSession({ sessionId, recentCount })
    .catch(error => {
      console.error('Error during session analysis:', error);
      process.exit(1);
    })
    .finally(() => {
      // Close any connections
      setTimeout(() => process.exit(0), 1000);
    });
}

export default analyzeSession;
