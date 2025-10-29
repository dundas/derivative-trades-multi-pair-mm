/**
 * SpreadCalculator
 * 
 * Handles dynamic spread calculations using order book data and time-weighted analysis.
 * This is a core utility for market making that provides accurate spread calculations
 * while handling edge cases and market anomalies.
 */
export class SpreadCalculator {
  constructor(config = {}) {
    this.logger = config.logger || console;
    this.debug = config.debug || false;
    this.maxSpread = config.maxSpread || 0.01; // 1% maximum spread
  }

  /**
   * Calculate market-based spread using order book buffer
   * @param {Object} marketData - Current market data with bid/ask prices
   * @param {Object} orderBookBuffer - Buffer of recent order book states
   * @param {boolean} detailedLogging - Whether to enable detailed logging
   * @returns {Object} Calculated spread information
   */
  calculateMarketBasedSpread(marketData, orderBookBuffer, detailedLogging = false) {
    try {
      const logMethod = detailedLogging ? 'warn' : 'log';
      
      // Log calculation inputs if in debug mode
      if (this.debug) {
        this.logger.debug('========== SPREAD CALCULATION INPUTS ==========');
        this.logger.debug(`Market Data: ${JSON.stringify({
          bestBid: marketData?.bestBid,
          bestAsk: marketData?.bestAsk,
          spread: marketData?.spread,
          midPrice: marketData?.midPrice
        }, null, 2)}`);
        this.logger.debug(`Order Book Buffer Length: ${orderBookBuffer?.length || 0}`);
      }
      
      if (!marketData) {
        this.logger.warn('No market data provided for spread calculation');
        return { spreadPercentage: 0.0001 }; // Default tiny spread
      }

      // If we have an order book buffer with historical data, use time-weighted averages
      if (orderBookBuffer && Array.isArray(orderBookBuffer) && orderBookBuffer.length > 1) {
        // Filter entries from the last 250ms
        const now = Date.now();
        const recentTimeWindow = now - 250;
        const recentEntries = orderBookBuffer.filter(entry => {
          return entry.timestamp && entry.timestamp > recentTimeWindow;
        });
        
        if (detailedLogging) {
          this.logger[logMethod](`Recent order book entries (last 250ms): ${recentEntries.length}`);
        }
        
        if (recentEntries.length > 0) {
          // Extract best bid/ask from each entry
          const normalizedEntries = recentEntries.map(entry => {
            if (entry.bids && entry.bids.length > 0 && entry.asks && entry.asks.length > 0) {
              return {
                timestamp: entry.timestamp,
                bestBid: parseFloat(entry.bids[0][0]),
                bestAsk: parseFloat(entry.asks[0][0])
              };
            } else if (entry.bestBid && entry.bestAsk) {
              return {
                timestamp: entry.timestamp,
                bestBid: parseFloat(entry.bestBid),
                bestAsk: parseFloat(entry.bestAsk)
              };
            }
            return null;
          }).filter(entry => entry !== null);
          
          if (normalizedEntries.length > 0) {
            // Calculate average bid and ask
            let sumBids = 0;
            let sumAsks = 0;
            let validEntries = 0;
            
            normalizedEntries.forEach(entry => {
              if (entry.bestBid && entry.bestAsk) {
                sumBids += entry.bestBid;
                sumAsks += entry.bestAsk;
                validEntries++;
              }
            });
            
            if (validEntries > 0) {
              const avgBid = sumBids / validEntries;
              const avgAsk = sumAsks / validEntries;
              const spreadValue = avgAsk - avgBid;
              
              // Calculate spread percentage and handle negative spreads
              let spreadPercentage = spreadValue / avgBid;
              if (spreadValue < 0 || spreadPercentage < 0) {
                this.logger.warn(`Detected negative spread: ${spreadValue.toFixed(2)} (${spreadPercentage.toFixed(8)}%). Using absolute value.`);
                spreadPercentage = Math.abs(spreadPercentage);
              }
              
              if (detailedLogging) {
                this.logger[logMethod](`========== SPREAD CALCULATION FROM BUFFER ==========`);
                this.logger[logMethod](`Valid entries: ${validEntries}/${normalizedEntries.length}`);
                this.logger[logMethod](`Average bid: ${avgBid.toFixed(2)}`);
                this.logger[logMethod](`Average ask: ${avgAsk.toFixed(2)}`);
                this.logger[logMethod](`Spread value: ${spreadValue.toFixed(2)}`);
                this.logger[logMethod](`Spread percentage: ${spreadPercentage.toFixed(8)}`);
              }
              
              return {
                spreadPercentage,
                avgBid,
                avgAsk
              };
            }
          }
        }
      }

      // Fallback to current market data
      let spreadPercentage;
      
      if (detailedLogging) {
        this.logger[logMethod](`========== FALLBACK SPREAD CALCULATION ==========`);
      }
      
      if (typeof marketData.spreadPercentage === 'number' && marketData.spreadPercentage > 0) {
        spreadPercentage = marketData.spreadPercentage;
        if (detailedLogging) {
          this.logger[logMethod](`Using pre-calculated spreadPercentage: ${spreadPercentage.toFixed(8)}`);
        }
      } else if (marketData.bestAsk && marketData.bestBid) {
        const spread = marketData.bestAsk - marketData.bestBid;
        spreadPercentage = spread / marketData.bestBid;
        
        if (spread < 0 || spreadPercentage < 0) {
          this.logger.warn(`Detected negative spread: ${spread.toFixed(2)} (${spreadPercentage.toFixed(8)}%). Using absolute value.`);
          spreadPercentage = Math.abs(spreadPercentage);
        }
        
        if (detailedLogging) {
          this.logger[logMethod](`Calculated from best bid/ask: ${marketData.bestBid} / ${marketData.bestAsk}`);
          this.logger[logMethod](`Raw spread: ${spread.toFixed(2)}, Spread percentage: ${spreadPercentage.toFixed(8)}`);
        }
      } else if (marketData.spread) {
        const referencePrice = marketData.midPrice || marketData.bestBid || marketData.lastPrice;
        spreadPercentage = Math.abs(marketData.spread / referencePrice);
        if (detailedLogging) {
          this.logger[logMethod](`Using raw spread: ${marketData.spread.toFixed(2)} relative to ${referencePrice.toFixed(2)}`);
          this.logger[logMethod](`Spread percentage: ${spreadPercentage.toFixed(8)}`);
        }
      } else {
        spreadPercentage = 0.0001;
        this.logger.warn('Using default minimum spread: insufficient market data');
      }
      
      if (detailedLogging) {
        this.logger[logMethod](`========== FINAL SPREAD VALUE: ${spreadPercentage.toFixed(8)} ==========`);
      }

      return {
        spreadPercentage,
        avgBid: null,
        avgAsk: null
      };
      
    } catch (error) {
      this.logger.error(`Error calculating market-based spread: ${error.message}`);
      return {
        spreadPercentage: 0.0001,
        avgBid: null,
        avgAsk: null
      };
    }
  }

  /**
   * Calculate spread in basis points
   * @param {number} bestBid - The best bid price
   * @param {number} bestAsk - The best ask price
   * @returns {number} - Spread in basis points, or Infinity if inputs are invalid
   */
  calculateSpreadBps(bestBid, bestAsk) {
    if (this.debug) {
      this.logger.debug(`[SpreadCalculator] calculateSpreadBps called with: bestBid=${bestBid}, bestAsk=${bestAsk}`);
    }
    if (!bestBid || bestBid <= 0 || !bestAsk || bestAsk <= 0) { // Added more robust check for invalid prices
      this.logger.warn('[SpreadCalculator] Invalid bestBid or bestAsk for BPS calculation', { bestBid, bestAsk });
      return Infinity;
    }
    const spread = bestAsk - bestBid;
    if (spread < 0) {
        // This can happen in crossed markets, though rare.
        // Returning Infinity or a very large number might be appropriate depending on handling.
        this.logger.warn('[SpreadCalculator] Detected negative spread for BPS calculation', { bestBid, bestAsk, spread });
    }
    // Ensure bestBid is not zero to prevent division by zero, though already checked.
    return (spread / bestBid) * 10000; // Convert to basis points
  }
}
