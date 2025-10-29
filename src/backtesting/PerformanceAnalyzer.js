/**
 * PerformanceAnalyzer
 *
 * Calculates performance metrics from backtest results.
 * Provides comprehensive analysis including P&L, Sharpe ratio, drawdown, win rate, etc.
 *
 * Based on Hummingbot's performance.py
 * Reference: hummingbot/client/performance.py
 */

/**
 * Performance metrics data structure
 */
class PerformanceMetrics {
  constructor() {
    // Trade metrics
    this.totalTrades = 0;
    this.winningTrades = 0;
    this.losingTrades = 0;
    this.breakEvenTrades = 0;

    // P&L metrics
    this.totalPnL = 0;
    this.grossProfit = 0;
    this.grossLoss = 0;
    this.netPnL = 0;

    // Return metrics
    this.returnPercent = 0;
    this.annualizedReturn = 0;

    // Risk metrics
    this.maxDrawdown = 0;
    this.maxDrawdownPercent = 0;
    this.sharpeRatio = 0;
    this.sortinoRatio = 0;

    // Volume metrics
    this.totalVolume = 0;
    this.totalFees = 0;

    // Win rate metrics
    this.winRate = 0;
    this.profitFactor = 0;
    this.averageWin = 0;
    this.averageLoss = 0;
    this.largestWin = 0;
    this.largestLoss = 0;

    // Hold comparison
    this.buyAndHoldReturn = 0;
    this.excessReturn = 0;

    // Time metrics
    this.startTime = null;
    this.endTime = null;
    this.duration = 0; // milliseconds
  }
}

/**
 * Performance analyzer
 */
class PerformanceAnalyzer {
  /**
   * Calculate comprehensive performance metrics
   * @param {Array} fills - Array of trade fills
   * @param {Map} initialBalances - Initial balances
   * @param {Map} finalBalances - Final balances
   * @param {number} startTime - Backtest start time
   * @param {number} endTime - Backtest end time
   * @param {Object} prices - Start and end prices for buy-and-hold comparison
   * @returns {PerformanceMetrics} Performance metrics
   */
  static analyze({
    fills,
    initialBalances,
    finalBalances,
    startTime,
    endTime,
    startPrices = {},
    endPrices = {}
  }) {
    const metrics = new PerformanceMetrics();

    metrics.startTime = startTime;
    metrics.endTime = endTime;
    metrics.duration = endTime - startTime;

    if (fills.length === 0) {
      return metrics;
    }

    // Group fills by pair and calculate P&L per completed trade
    const trades = this.groupFillsIntoTrades(fills);

    // Calculate trade-level metrics
    for (const trade of trades) {
      metrics.totalTrades++;

      if (trade.pnl > 0) {
        metrics.winningTrades++;
        metrics.grossProfit += trade.pnl;
        metrics.largestWin = Math.max(metrics.largestWin, trade.pnl);
      } else if (trade.pnl < 0) {
        metrics.losingTrades++;
        metrics.grossLoss += Math.abs(trade.pnl);
        metrics.largestLoss = Math.min(metrics.largestLoss, trade.pnl);
      } else {
        metrics.breakEvenTrades++;
      }

      metrics.totalPnL += trade.pnl;
      metrics.totalVolume += trade.volume;
      metrics.totalFees += trade.fees;
    }

    metrics.netPnL = metrics.totalPnL - metrics.totalFees;

    // Calculate win rate
    metrics.winRate = metrics.totalTrades > 0
      ? (metrics.winningTrades / metrics.totalTrades) * 100
      : 0;

    // Calculate average win/loss
    metrics.averageWin = metrics.winningTrades > 0
      ? metrics.grossProfit / metrics.winningTrades
      : 0;

    metrics.averageLoss = metrics.losingTrades > 0
      ? metrics.grossLoss / metrics.losingTrades
      : 0;

    // Calculate profit factor
    metrics.profitFactor = metrics.grossLoss > 0
      ? metrics.grossProfit / metrics.grossLoss
      : metrics.grossProfit > 0 ? Infinity : 0;

    // Calculate return
    const initialValue = this.calculatePortfolioValue(initialBalances, startPrices);
    const finalValue = this.calculatePortfolioValue(finalBalances, endPrices);

    if (initialValue > 0) {
      metrics.returnPercent = ((finalValue - initialValue) / initialValue) * 100;

      // Annualized return (assuming 365 days)
      const years = metrics.duration / (365 * 24 * 60 * 60 * 1000);
      metrics.annualizedReturn = years > 0
        ? (Math.pow(finalValue / initialValue, 1 / years) - 1) * 100
        : 0;
    }

    // Calculate drawdown
    const { maxDrawdown, maxDrawdownPercent } = this.calculateDrawdown(trades, initialValue);
    metrics.maxDrawdown = maxDrawdown;
    metrics.maxDrawdownPercent = maxDrawdownPercent;

    // Calculate Sharpe ratio
    metrics.sharpeRatio = this.calculateSharpeRatio(trades, metrics.duration);

    // Calculate Sortino ratio
    metrics.sortinoRatio = this.calculateSortinoRatio(trades, metrics.duration);

    // Calculate buy-and-hold comparison
    metrics.buyAndHoldReturn = this.calculateBuyAndHoldReturn(
      initialBalances,
      startPrices,
      endPrices
    );
    metrics.excessReturn = metrics.returnPercent - metrics.buyAndHoldReturn;

    return metrics;
  }

  /**
   * Group fills into completed trades (buy + sell pairs)
   * @param {Array} fills - Array of fills
   * @returns {Array} Array of trades
   */
  static groupFillsIntoTrades(fills) {
    const trades = [];
    const positions = new Map(); // pair -> { amount, avgPrice, fees }

    for (const fill of fills) {
      const pair = fill.pair;
      let position = positions.get(pair) || { amount: 0, avgPrice: 0, fees: 0 };

      if (fill.side === 'BUY') {
        // Add to position
        const newAmount = position.amount + fill.amount;
        const newAvgPrice = (position.avgPrice * position.amount + fill.price * fill.amount) / newAmount;

        position = {
          amount: newAmount,
          avgPrice: newAvgPrice,
          fees: position.fees + fill.fee
        };
      } else {
        // Sell from position
        if (position.amount >= fill.amount) {
          // Complete trade
          const pnl = (fill.price - position.avgPrice) * fill.amount;
          const fees = position.fees * (fill.amount / position.amount) + fill.fee;

          trades.push({
            pair,
            entryPrice: position.avgPrice,
            exitPrice: fill.price,
            amount: fill.amount,
            pnl,
            fees,
            volume: fill.amount * fill.price,
            timestamp: fill.timestamp
          });

          // Update remaining position
          const remainingAmount = position.amount - fill.amount;
          position = {
            amount: remainingAmount,
            avgPrice: position.avgPrice,
            fees: position.fees * (remainingAmount / position.amount)
          };
        }
      }

      positions.set(pair, position);
    }

    return trades;
  }

  /**
   * Calculate portfolio value
   * @param {Map} balances - Balances map
   * @param {Object} prices - Current prices
   * @returns {number} Portfolio value in USD
   */
  static calculatePortfolioValue(balances, prices) {
    let value = 0;

    for (const [asset, amount] of balances.entries()) {
      if (asset === 'USD' || asset === 'USDT' || asset === 'USDC') {
        value += amount;
      } else {
        const pair = `${asset}/USD`;
        const price = prices[pair] || 0;
        value += amount * price;
      }
    }

    return value;
  }

  /**
   * Calculate maximum drawdown
   * @param {Array} trades - Array of trades
   * @param {number} initialValue - Initial portfolio value
   * @returns {Object} { maxDrawdown, maxDrawdownPercent }
   */
  static calculateDrawdown(trades, initialValue) {
    let peak = initialValue;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let currentValue = initialValue;

    for (const trade of trades) {
      currentValue += trade.pnl - trade.fees;

      if (currentValue > peak) {
        peak = currentValue;
      }

      const drawdown = peak - currentValue;
      const drawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;

      maxDrawdown = Math.max(maxDrawdown, drawdown);
      maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);
    }

    return { maxDrawdown, maxDrawdownPercent };
  }

  /**
   * Calculate Sharpe ratio
   * @param {Array} trades - Array of trades
   * @param {number} duration - Duration in milliseconds
   * @returns {number} Sharpe ratio
   */
  static calculateSharpeRatio(trades, duration) {
    if (trades.length < 2) return 0;

    const returns = trades.map(trade => trade.pnl / (trade.amount * trade.entryPrice));

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Annualize
    const tradesPerYear = (trades.length / duration) * (365 * 24 * 60 * 60 * 1000);
    const annualizedReturn = avgReturn * tradesPerYear;
    const annualizedStdDev = stdDev * Math.sqrt(tradesPerYear);

    // Risk-free rate (assume 2% annual)
    const riskFreeRate = 0.02;

    return annualizedStdDev > 0 ? (annualizedReturn - riskFreeRate) / annualizedStdDev : 0;
  }

  /**
   * Calculate Sortino ratio (like Sharpe but only considers downside volatility)
   * @param {Array} trades - Array of trades
   * @param {number} duration - Duration in milliseconds
   * @returns {number} Sortino ratio
   */
  static calculateSortinoRatio(trades, duration) {
    if (trades.length < 2) return 0;

    const returns = trades.map(trade => trade.pnl / (trade.amount * trade.entryPrice));

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    // Only consider negative returns for downside deviation
    const negativeReturns = returns.filter(r => r < 0);

    if (negativeReturns.length === 0) return Infinity;

    const downsideVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
    const downsideStdDev = Math.sqrt(downsideVariance);

    if (downsideStdDev === 0) return 0;

    // Annualize
    const tradesPerYear = (trades.length / duration) * (365 * 24 * 60 * 60 * 1000);
    const annualizedReturn = avgReturn * tradesPerYear;
    const annualizedDownsideStdDev = downsideStdDev * Math.sqrt(tradesPerYear);

    // Risk-free rate (assume 2% annual)
    const riskFreeRate = 0.02;

    return annualizedDownsideStdDev > 0
      ? (annualizedReturn - riskFreeRate) / annualizedDownsideStdDev
      : 0;
  }

  /**
   * Calculate buy-and-hold return
   * @param {Map} initialBalances - Initial balances
   * @param {Object} startPrices - Start prices
   * @param {Object} endPrices - End prices
   * @returns {number} Buy-and-hold return percentage
   */
  static calculateBuyAndHoldReturn(initialBalances, startPrices, endPrices) {
    const startValue = this.calculatePortfolioValue(initialBalances, startPrices);
    const endValue = this.calculatePortfolioValue(initialBalances, endPrices);

    if (startValue === 0) return 0;

    return ((endValue - startValue) / startValue) * 100;
  }

  /**
   * Format metrics for display
   * @param {PerformanceMetrics} metrics - Performance metrics
   * @returns {string} Formatted report
   */
  static formatReport(metrics) {
    const duration = metrics.duration / (24 * 60 * 60 * 1000); // days

    return `
=== BACKTEST PERFORMANCE REPORT ===

Time Period:
  Start: ${new Date(metrics.startTime).toISOString()}
  End: ${new Date(metrics.endTime).toISOString()}
  Duration: ${duration.toFixed(2)} days

Trade Statistics:
  Total Trades: ${metrics.totalTrades}
  Winning Trades: ${metrics.winningTrades} (${metrics.winRate.toFixed(2)}%)
  Losing Trades: ${metrics.losingTrades}
  Break-even Trades: ${metrics.breakEvenTrades}

P&L Metrics:
  Total P&L: $${metrics.totalPnL.toFixed(2)}
  Gross Profit: $${metrics.grossProfit.toFixed(2)}
  Gross Loss: $${metrics.grossLoss.toFixed(2)}
  Total Fees: $${metrics.totalFees.toFixed(2)}
  Net P&L: $${metrics.netPnL.toFixed(2)}

Performance Metrics:
  Return: ${metrics.returnPercent.toFixed(2)}%
  Annualized Return: ${metrics.annualizedReturn.toFixed(2)}%
  Max Drawdown: $${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPercent.toFixed(2)}%)
  Sharpe Ratio: ${metrics.sharpeRatio.toFixed(3)}
  Sortino Ratio: ${metrics.sortinoRatio.toFixed(3)}
  Profit Factor: ${metrics.profitFactor === Infinity ? 'Infinity' : metrics.profitFactor.toFixed(3)}

Trade Analysis:
  Average Win: $${metrics.averageWin.toFixed(2)}
  Average Loss: $${metrics.averageLoss.toFixed(2)}
  Largest Win: $${metrics.largestWin.toFixed(2)}
  Largest Loss: $${metrics.largestLoss.toFixed(2)}

Volume:
  Total Volume: $${metrics.totalVolume.toFixed(2)}

Buy & Hold Comparison:
  Strategy Return: ${metrics.returnPercent.toFixed(2)}%
  Buy & Hold Return: ${metrics.buyAndHoldReturn.toFixed(2)}%
  Excess Return: ${metrics.excessReturn.toFixed(2)}%

====================================
    `.trim();
  }
}

export {
  PerformanceAnalyzer,
  PerformanceMetrics
};
