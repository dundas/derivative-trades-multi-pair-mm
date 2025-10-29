/**
 * Volatility Detector for Crypto Trading
 * 
 * This utility detects extreme market volatility by analyzing price movements
 * across multiple timeframes. It uses a weighted scoring system to determine
 * when the market is too volatile for safe trading, and implements a cooling
 * off period after volatility events.
 */

class VolatilityDetector {
  constructor(options = {}) {
    // Timeframe configurations
    this.shortTermConfig = {
      timeframe: options.shortTermTimeframe || 15 * 1000, // 15 seconds in ms (updated from 5 min)
      weight: options.shortTermWeight || 0.5, // 50% weight
      threshold: options.shortTermThreshold || 1.5, // Lower threshold for testing
      upwardThreshold: options.shortTermUpwardThreshold || 2.5, // Lower threshold for testing
      meanPeriod: options.shortTermMeanPeriod || 60 * 1000, // 1 minute in ms (updated from 24 hours)
      maxDataPoints: options.shortTermMaxDataPoints || 500, // Reduced to prevent memory issues
      dataPoints: [] // Price data points for this timeframe
    };
    
    this.mediumTermConfig = {
      timeframe: options.mediumTermTimeframe || 1 * 60 * 1000, // 1 minute in ms (updated from 4 hours)
      weight: options.mediumTermWeight || 0.3, // 30% weight
      threshold: options.mediumTermThreshold || 1.5, // Lower threshold for testing
      upwardThreshold: options.mediumTermUpwardThreshold || 2.5, // Lower threshold for testing
      meanPeriod: options.mediumTermMeanPeriod || 5 * 60 * 1000, // 5 minutes in ms (updated from 7 days)
      maxDataPoints: options.mediumTermMaxDataPoints || 1000, // Reduced for faster testing
      dataPoints: [] // Price data points for this timeframe
    };
    
    this.longTermConfig = {
      timeframe: options.longTermTimeframe || 5 * 60 * 1000, // 5 minutes in ms (updated from 7 days)
      weight: options.longTermWeight || 0.2, // 20% weight
      threshold: options.longTermThreshold || 1.5, // Lower threshold for testing
      upwardThreshold: options.longTermUpwardThreshold || 2.5, // Lower threshold for testing
      meanPeriod: options.longTermMeanPeriod || 15 * 60 * 1000, // 15 minutes in ms (updated from 30 days)
      maxDataPoints: options.longTermMaxDataPoints || 1500, // Reduced for faster testing
      dataPoints: [] // Price data points for this timeframe
    };
    
    // Add timeframes object for compatibility with new code
    this.timeframes = {
      short: this.shortTermConfig.timeframe,
      medium: this.mediumTermConfig.timeframe,
      long: this.longTermConfig.timeframe
    };
    
    // Cooling off period after detecting extreme volatility
    this.coolingOffPeriod = options.coolingOffPeriod || 30 * 1000; // 30 seconds in ms (updated from 30 min)
    this.lastVolatilityEvent = 0;
    
    // Redis client for persistence
    this.redis = options.redis;
    this.stateManager = options.stateManager;
    
    // Key prefixes for Redis storage
    this.keyPrefix = 'market-maker:kraken:btc-usd:volatility:';
    
    // In-memory cache for volatility data
    this.cache = {
      short: { dataPoints: [], lastSync: 0 },
      medium: { dataPoints: [], lastSync: 0 },
      long: { dataPoints: [], lastSync: 0 }
    };
    
    // Cache settings
    this.cacheTTL = options.cacheTTL || 60 * 1000; // 1 minute default
    this.syncInterval = options.syncInterval || 5000; // 5 seconds default
    this.lastFullSync = 0;
    
    // Memory management settings
    this.dataPointSampleRate = options.dataPointSampleRate || 1; // Store every nth data point
    this.sampleCounter = 0;
    
    // Volatility state - expanded to track directional volatility
    this.isVolatile = false;
    this.isDownwardVolatile = false;
    this.isUpwardVolatile = false;
    
    // Record the start time for the startup period
    this.startTime = Date.now();
    this.lastVolatileTimestamp = 0; // Initialize this property
    
    // Volatility detection mode
    this.volatilityDetectionMode = options.volatilityDetectionMode || 'majority';
    
    // Initialize cache
    this.initializeCache();
  }
  
  /**
   * Initialize cache by loading data from Redis
   */
  async initializeCache() {
    if (!this.redis) return;
    
    try {
      // Load data for each timeframe
      await Promise.all([
        this.loadTimeframeData('short'),
        this.loadTimeframeData('medium'),
        this.loadTimeframeData('long')
      ]);
      
      this.lastFullSync = Date.now();
    } catch (error) {
      console.warn('Failed to initialize volatility cache from Redis:', error.message);
      // Continue with empty cache - will be built up as new data points arrive
    }
  }
  
  /**
   * Load timeframe data from Redis into cache
   */
  async loadTimeframeData(timeframeType) {
    if (!this.redis) return;
    
    const key = `${this.keyPrefix}${timeframeType}`;
    try {
      const dataStr = await this.redis.get(key);
      if (dataStr) {
        let dataPoints;
        
        // Handle different data formats
        if (typeof dataStr === 'string') {
          try {
            dataPoints = JSON.parse(dataStr);
          } catch (parseError) {
            console.warn(`Error parsing ${timeframeType} timeframe data: ${parseError.message}`);
            dataPoints = [];
          }
        } else if (Array.isArray(dataStr)) {
          // Data is already an array
          dataPoints = dataStr;
        } else if (typeof dataStr === 'object' && dataStr !== null) {
          // Data is an object, convert to array if possible
          console.warn(`${timeframeType} timeframe data is an object, not an array. Converting to array.`);
          dataPoints = Object.values(dataStr);
        } else {
          console.warn(`${timeframeType} timeframe data is in an unexpected format. Using empty array.`);
          dataPoints = [];
        }
        
        // Apply data point limits to prevent memory issues
        const config = this.getTimeframeConfig(timeframeType);
        if (dataPoints.length > config.maxDataPoints) {
          // Keep most recent data points up to the max limit
          dataPoints = this.pruneDataPoints(dataPoints, config.maxDataPoints);
        }
        
        this.cache[timeframeType].dataPoints = dataPoints;
        this.cache[timeframeType].lastSync = Date.now();
        this.getTimeframeConfig(timeframeType).dataPoints = dataPoints;
      }
    } catch (error) {
      console.warn(`Failed to load ${timeframeType} timeframe data from Redis:`, error.message);
    }
  }
  
  /**
   * Sync cache to Redis (less frequently than we add data points)
   */
  async syncCacheToRedis(force = false) {
    if (!this.redis) return;
    
    const now = Date.now();
    const syncInterval = force ? 0 : this.syncInterval;
    
    // Only sync periodically to avoid hitting Redis rate limits
    if (now - this.lastFullSync < syncInterval && !force) {
      return;
    }
    
    try {
      // Sync each timeframe
      await Promise.all([
        this.syncTimeframeToRedis('short'),
        this.syncTimeframeToRedis('medium'),
        this.syncTimeframeToRedis('long')
      ]);
      
      this.lastFullSync = now;
    } catch (error) {
      console.warn('Failed to sync cache to Redis:', error.message);
    }
  }
  
  /**
   * Sync a specific timeframe to Redis
   */
  async syncTimeframeToRedis(timeframeType) {
    if (!this.redis) return;
    
    const key = `${this.keyPrefix}${timeframeType}`;
    const dataPoints = this.cache[timeframeType].dataPoints;
    
    try {
      // Only store a reasonable number of data points to Redis
      const config = this.getTimeframeConfig(timeframeType);
      const prunedDataPoints = this.pruneDataPoints(dataPoints, config.maxDataPoints);
      
      await this.redis.set(key, JSON.stringify(prunedDataPoints));
      this.cache[timeframeType].lastSync = Date.now();
    } catch (error) {
      console.warn(`Failed to sync ${timeframeType} timeframe to Redis:`, error.message);
    }
  }
  
  /**
   * Prune data points to a maximum size, keeping the most recent ones
   * and sampling older ones to reduce memory usage
   */
  pruneDataPoints(dataPoints, maxSize) {
    if (dataPoints.length <= maxSize) return dataPoints;
    
    // For large datasets, keep most recent points and sample older ones
    const recentCount = Math.floor(maxSize * 0.7); // Keep 70% recent points
    const sampledCount = maxSize - recentCount; // Sample the rest
    
    // Get most recent points
    const recentPoints = dataPoints.slice(-recentCount);
    
    // Sample older points (take every nth point)
    const olderPoints = dataPoints.slice(0, -recentCount);
    const sampledOlderPoints = [];
    
    if (olderPoints.length > 0) {
      const sampleRate = Math.max(1, Math.floor(olderPoints.length / sampledCount));
      for (let i = 0; i < olderPoints.length; i += sampleRate) {
        if (sampledOlderPoints.length < sampledCount) {
          sampledOlderPoints.push(olderPoints[i]);
        }
      }
    }
    
    // Combine sampled older points with recent points
    return [...sampledOlderPoints, ...recentPoints];
  }
  
  /**
   * Add a new price data point
   */
  async addPriceDataPoint(price, timestamp = Date.now()) {
    // Sample data points to reduce memory usage
    this.sampleCounter++;
    if (this.sampleCounter % this.dataPointSampleRate !== 0) {
      return this.isVolatile; // Skip this data point
    }
    
    const dataPoint = { price, timestamp };
    
    // Add to each timeframe's data points (in memory)
    this.addToTimeframeCache('short', dataPoint);
    this.addToTimeframeCache('medium', dataPoint);
    this.addToTimeframeCache('long', dataPoint);
    
    // Don't sync on every data point - only every 5 seconds or when forced
    // This dramatically reduces Redis API calls
    const now = Date.now();
    const shouldSync = now - this.lastFullSync >= this.syncInterval;
    
    if (shouldSync) {
      await this.syncCacheToRedis();
    }
    
    // Check for extreme volatility
    this.isVolatile = await this.checkVolatility();
    return this.isVolatile;
  }
  
  /**
   * Add data point to specific timeframe cache
   */
  addToTimeframeCache(timeframeType, dataPoint) {
    const config = this.getTimeframeConfig(timeframeType);
    const cacheData = this.cache[timeframeType];
    
    // Add new data point
    cacheData.dataPoints.push(dataPoint);
    
    // Keep data points for the mean calculation period, which is longer than the timeframe
    const cutoffTime = dataPoint.timestamp - config.meanPeriod;
    cacheData.dataPoints = cacheData.dataPoints.filter(point => point.timestamp >= cutoffTime);
    
    // Enforce maximum data points limit
    if (cacheData.dataPoints.length > config.maxDataPoints) {
      cacheData.dataPoints = this.pruneDataPoints(cacheData.dataPoints, config.maxDataPoints);
    }
    
    // Update config data points to match cache
    config.dataPoints = cacheData.dataPoints;
  }
  
  /**
   * Legacy method - now uses cache instead of direct Redis calls
   */
  async addToTimeframe(timeframeType, dataPoint) {
    // This method now just updates the cache
    this.addToTimeframeCache(timeframeType, dataPoint);
  }
  
  /**
   * Get configuration for a specific timeframe
   */
  getTimeframeConfig(timeframeType) {
    switch (timeframeType) {
      case 'short':
        return this.shortTermConfig;
      case 'medium':
        return this.mediumTermConfig;
      case 'long':
        return this.longTermConfig;
      default:
        throw new Error(`Unknown timeframe type: ${timeframeType}`);
    }
  }
  
  /**
   * Calculate volatility for a specific timeframe
   */
  calculateTimeframeVolatility(timeframeType) {
    const config = this.getTimeframeConfig(timeframeType);
    const dataPoints = config.dataPoints;
    
    // Need at least 2 data points to calculate volatility
    if (dataPoints.length < 2) {
      return {
        stdDev: 0,
        mean: 0,
        dataPoints: {
          total: dataPoints.length,
          timeframe: 0
        },
        weight: config.weight,
        threshold: config.threshold,
        weightedValue: 0
      };
    }
    
    // Filter data points for the specific timeframe
    const now = Date.now();
    const timeframeDataPoints = dataPoints.filter(point => {
      return point.timestamp >= now - config.timeframe;
    });
    
    // Need at least 2 data points in the timeframe to calculate volatility
    if (timeframeDataPoints.length < 2) {
      console.log(`VOLATILITY DEBUG: Not enough data points in the ${timeframeType} timeframe (${timeframeDataPoints.length})`);
      return {
        stdDev: 0,
        mean: 0,
        dataPoints: {
          total: dataPoints.length,
          timeframe: timeframeDataPoints.length
        },
        weight: config.weight,
        threshold: config.threshold,
        weightedValue: 0
      };
    }
    
    // Sort data points by timestamp to ensure correct sequence
    timeframeDataPoints.sort((a, b) => a.timestamp - b.timestamp);
    
    // Log the actual price values in the timeframe for debugging
    console.log(`PRICE DATA (${timeframeType}): [` + 
      timeframeDataPoints.map((p, i) => 
        `\n  {idx: ${i}, price: ${p.price}, time: ${new Date(p.timestamp).toISOString().substr(11, 8)}}`
      ).join(',') + 
    '\n]');
    
    // For better volatility calculation, ensure we have data spanning at least
    // 50% of the timeframe window
    const oldestTimestamp = timeframeDataPoints[0].timestamp;
    const newestTimestamp = timeframeDataPoints[timeframeDataPoints.length - 1].timestamp;
    const timeSpanSeconds = (newestTimestamp - oldestTimestamp) / 1000;
    const timeframeSeconds = config.timeframe / 1000;
    
    if (timeSpanSeconds < timeframeSeconds * 0.5) {
      console.log(`VOLATILITY DEBUG: Timespan (${timeSpanSeconds.toFixed(3)} seconds) is less than 50% of the ${timeframeType} timeframe (${timeframeSeconds} seconds)`);
    }
    
    // Check for feed issues by detecting identical prices
    const uniquePrices = new Set(timeframeDataPoints.map(p => p.price));
    const allIdentical = uniquePrices.size === 1;
    
    // Log detailed price distribution information
    console.log(`PRICE DISTRIBUTION (${timeframeType}): ${uniquePrices.size} unique prices out of ${timeframeDataPoints.length} data points`);
    if (uniquePrices.size <= 10) {
      const priceCounts = {};
      timeframeDataPoints.forEach(p => {
        priceCounts[p.price] = (priceCounts[p.price] || 0) + 1;
      });
      
      console.log('PRICE COUNTS: ' + 
        Object.entries(priceCounts)
          .map(([price, count]) => `${price}: ${count} times (${(count/timeframeDataPoints.length*100).toFixed(1)}%)`)
          .join(', ')
      );
    }
    
    // Log a critical warning if all prices are identical - likely a feed issue
    if (allIdentical && timeframeDataPoints.length > 5) {
      console.warn(`CRITICAL FEED ISSUE: All ${timeframeDataPoints.length} prices are identical (${timeframeDataPoints[0].price}) in the ${timeframeType} timeframe.`);
      console.warn('This indicates a market data feed problem. Volatility calculation will be inaccurate.');
      
      // Calculate how long we've been receiving identical prices
      const identicalDurationMs = newestTimestamp - oldestTimestamp;
      const identicalDurationSec = identicalDurationMs / 1000;
      console.warn(`Identical prices have been received for ${identicalDurationSec.toFixed(1)} seconds.`);
    }
    
    // Calculate percentage changes between consecutive data points
    const percentageChanges = [];
    for (let i = 1; i < timeframeDataPoints.length; i++) {
      const prevPrice = timeframeDataPoints[i - 1].price;
      const currentPrice = timeframeDataPoints[i].price;
      const percentageChange = (currentPrice - prevPrice) / prevPrice;
      percentageChanges.push(percentageChange);
    }
    
    // Log the actual percentage changes used in volatility calculation
    if (percentageChanges.length > 0) {
      console.log(`PERCENTAGE CHANGES (${timeframeType}): [
  ${percentageChanges.map((c, i) => `{idx: ${i}, timestamp: "${new Date(timeframeDataPoints[i].timestamp).toISOString()}", change: ${c.toFixed(8)}, from ${timeframeDataPoints[i].price} to ${timeframeDataPoints[i+1].price}}`).join(',\n  ')}
]`);
    }
    
    // Calculate mean and standard deviation
    const mean = percentageChanges.reduce((sum, change) => sum + change, 0) / percentageChanges.length;
    
    const squaredDifferences = percentageChanges.map(change => Math.pow(change - mean, 2));
    const variance = squaredDifferences.reduce((sum, diff) => sum + diff, 0) / squaredDifferences.length;
    const stdDev = Math.sqrt(variance);
    
    // Log detailed information about the volatility calculation
    console.log(`VOLATILITY DEBUG: Historical volatility calculation: {
  priceDataPoints: ${timeframeDataPoints.length},
  returns: ${percentageChanges.length},
  meanReturn: '${mean.toFixed(6)}',
  variance: '${variance.toFixed(6)}',
  stdDev: '${stdDev.toFixed(6)}',
  latestPrice: ${timeframeDataPoints[timeframeDataPoints.length - 1].price},
  oldestPrice: ${timeframeDataPoints[0].price},
  timeSpan: '${timeSpanSeconds.toFixed(3)} seconds'
}`);
    
    // Calculate weighted volatility value
    const weightedValue = stdDev * config.weight;
    
    // Calculate time span ratio (actual timespan compared to configured timeframe)
    const timeSpanRatio = timeSpanSeconds / timeframeSeconds;
    
    // Apply variance stabilization for short timespans
    // This ensures we don't get artificially low volatility during startup
    let adjustedStdDev = stdDev;
    if (timeSpanRatio < 0.5) {
      // Scale up volatility for very short timespans to avoid underestimation
      // This corrects for the artificial stability in short periods
      const scaleFactor = Math.max(1, 0.5 / timeSpanRatio);
      adjustedStdDev = Math.min(adjustedStdDev * scaleFactor, 0.01); // Cap at 1% to prevent extreme values
    }
    
    // Log additional debug information
    console.log(`VOLATILITY DEBUG: Time span ratio: ${timeSpanRatio.toFixed(3)}, Adjusted standard deviation: ${adjustedStdDev.toFixed(6)}`);
    
    return {
      stdDev: adjustedStdDev,
      mean,
      dataPoints: {
        total: dataPoints.length,
        timeframe: timeframeDataPoints.length
      },
      weight: config.weight,
      threshold: config.threshold,
      weightedValue: adjustedStdDev * config.weight
    };
  }
  
  /**
   * Check if the market is currently volatile
   * @returns {Promise<boolean>} True if market is volatile
   */
  async checkVolatility() {
    try {
      // Get volatility data for all timeframes
      const shortTermVolatility = await this.calculateTimeframeVolatility('short');
      const mediumTermVolatility = await this.calculateTimeframeVolatility('medium');
      const longTermVolatility = await this.calculateTimeframeVolatility('long');
      
      // Ensure we have valid volatility data for all timeframes
      if (!shortTermVolatility || !mediumTermVolatility || !longTermVolatility) {
        console.warn('VOLATILITY DEBUG: Missing volatility data for one or more timeframes');
        return false; // Cannot determine volatility with incomplete data
      }
      
      // Calculate the final weighted volatility value
      const volatilityValue = 
        shortTermVolatility.weightedValue + 
        mediumTermVolatility.weightedValue + 
        longTermVolatility.weightedValue;
      
      // Record volatility for monitoring
      this.lastVolatility = volatilityValue;
      this.isFirstCheck = false;
      
      // Calculate if current volatility is above all thresholds
      const shortThresholdMet = shortTermVolatility.stdDev > shortTermVolatility.threshold;
      const mediumThresholdMet = mediumTermVolatility.stdDev > mediumTermVolatility.threshold;
      const longThresholdMet = longTermVolatility.stdDev > longTermVolatility.threshold;
      
      let isVolatile = false;
      
      // Check if volatility exceeds thresholds
      if (this.volatilityDetectionMode === 'any') {
        // Any timeframe exceeding threshold indicates volatile market
        isVolatile = shortThresholdMet || mediumThresholdMet || longThresholdMet;
      } else if (this.volatilityDetectionMode === 'majority') {
        // Majority of timeframes (2+ out of 3) exceeding threshold indicates volatile market
        const thresholdsExceeded = [shortThresholdMet, mediumThresholdMet, longThresholdMet].filter(Boolean).length;
        isVolatile = thresholdsExceeded >= 2;
      } else {
        // Default 'all' mode - all timeframes must exceed threshold to indicate volatile market
        isVolatile = shortThresholdMet && mediumThresholdMet && longThresholdMet;
      }
      
      // Apply cooling off period after volatility period ends
      const now = Date.now();
      
      if (isVolatile) {
        // Update last volatile timestamp when volatile
        this.lastVolatileTimestamp = now;
        
        // Record volatility event if not already in a volatile period
        if (!this.isVolatile) {
          this.recordVolatilityEvent(volatilityValue);
        }
      } else if (this.lastVolatileTimestamp > 0) {
        // Apply cooling off period - remain "volatile" for a period after actual volatility ends
        const timeSinceVolatile = now - this.lastVolatileTimestamp;
        if (timeSinceVolatile < this.coolingOffPeriod) {
          isVolatile = true;
          console.log(`VOLATILITY DEBUG: In cooling off period (${Math.round(timeSinceVolatile / 1000)}s elapsed of ${Math.round(this.coolingOffPeriod / 1000)}s period)`);
        }
      }
      
      // Get timespan data safely with fallbacks
      const getTimespan = (volatility) => {
        if (volatility && volatility.dataPoints && typeof volatility.dataPoints.timespan === 'number') {
          return volatility.dataPoints.timespan;
        }
        return 0; // Default to 0 if missing or invalid
      };
      
      // Get timeframes in seconds safely
      const getTimeframeSeconds = (timeframe) => {
        if (this.timeframes && typeof this.timeframes[timeframe] === 'number') {
          return this.timeframes[timeframe] / 1000;
        }
        
        // Fallback values if timeframes are undefined
        const fallbackValues = {
          short: 15,  // 15 seconds
          medium: 60, // 1 minute
          long: 300   // 5 minutes
        };
        
        return fallbackValues[timeframe] || 60; // Default to 60 seconds if unknown
      };
      
      // Calculate timespan data
      const shortTimeSpan = getTimespan(shortTermVolatility);
      const mediumTimeSpan = getTimespan(mediumTermVolatility);
      const longTimeSpan = getTimespan(longTermVolatility);
      
      // Calculate timeframe durations
      const shortFrameSeconds = getTimeframeSeconds('short');
      const mediumFrameSeconds = getTimeframeSeconds('medium');
      const longFrameSeconds = getTimeframeSeconds('long');
      
      // Calculate coverage percentages safely
      const shortTermCoverage = shortFrameSeconds > 0 ? shortTimeSpan / shortFrameSeconds : 0;
      const mediumTermCoverage = mediumFrameSeconds > 0 ? mediumTimeSpan / mediumFrameSeconds : 0;
      const longTermCoverage = longFrameSeconds > 0 ? longTimeSpan / longFrameSeconds : 0;
      
      // During the first minute of operation, apply special startup logic
      const startupPeriod = 60 * 1000; // 1 minute warm-up
      const timeSinceStart = now - this.startTime;
      
      if (timeSinceStart < startupPeriod) {
        // If we're in startup period and have very limited coverage, don't trigger volatility
        // This prevents false positives at startup
        const avgCoverage = (shortTermCoverage + mediumTermCoverage + longTermCoverage) / 3;
        if (avgCoverage < 0.3) { // Less than 30% coverage across timeframes
          console.log(`VOLATILITY DEBUG: In startup period (${Math.round(timeSinceStart / 1000)}s), limited data coverage (${(avgCoverage * 100).toFixed(1)}%), avoiding volatility triggers`);
          isVolatile = false;
        }
      }
      
      // Log diagnostic information
      console.log(`VOLATILITY ANALYSIS: Overall=${volatilityValue.toFixed(6)}, Short=${shortTermVolatility.stdDev.toFixed(6)}/${shortTermVolatility.threshold.toFixed(6)}, Medium=${mediumTermVolatility.stdDev.toFixed(6)}/${mediumTermVolatility.threshold.toFixed(6)}, Long=${longTermVolatility.stdDev.toFixed(6)}/${longTermVolatility.threshold.toFixed(6)}, Result=${isVolatile}`);
      
      return isVolatile;
    } catch (error) {
      console.error('Error checking volatility:', error);
      return false;
    }
  }
  
  /**
   * Check for directional volatility (upward or downward trends)
   */
  checkDirectionalVolatility() {
    // Calculate short-term trend direction
    const shortTermConfig = this.shortTermConfig;
    const shortTermDataPoints = shortTermConfig.dataPoints;
    
    // Need enough data points to determine direction
    if (shortTermDataPoints.length < 10) {
      this.isUpwardVolatile = false;
      this.isDownwardVolatile = false;
      return;
    }
    
    // Get recent data points
    const now = Date.now();
    const recentPoints = shortTermDataPoints.filter(point => {
      return point.timestamp >= now - shortTermConfig.timeframe;
    });
    
    if (recentPoints.length < 2) {
      this.isUpwardVolatile = false;
      this.isDownwardVolatile = false;
      return;
    }
    
    // Calculate percentage changes
    const changes = [];
    for (let i = 1; i < recentPoints.length; i++) {
      const prevPrice = recentPoints[i - 1].price;
      const currentPrice = recentPoints[i].price;
      const change = (currentPrice - prevPrice) / prevPrice;
      changes.push(change);
    }
    
    // Calculate mean and standard deviation of changes
    const mean = changes.reduce((sum, change) => sum + change, 0) / changes.length;
    
    // Calculate upward and downward volatility scores
    const upwardChanges = changes.filter(change => change > 0);
    const downwardChanges = changes.filter(change => change < 0);
    
    const upwardScore = upwardChanges.length > 0 ?
      upwardChanges.reduce((sum, change) => sum + change, 0) / upwardChanges.length :
      0;
    
    const downwardScore = downwardChanges.length > 0 ?
      Math.abs(downwardChanges.reduce((sum, change) => sum + change, 0)) / downwardChanges.length :
      0;
    
    // Determine directional volatility
    this.isUpwardVolatile = upwardScore > shortTermConfig.upwardThreshold / 1000;
    this.isDownwardVolatile = downwardScore > shortTermConfig.threshold / 1000;
  }
  
  /**
   * Get current volatility state
   */
  getVolatilityState() {
    return {
      isVolatile: this.isVolatile,
      isUpwardVolatile: this.isUpwardVolatile,
      isDownwardVolatile: this.isDownwardVolatile,
      lastVolatilityEvent: this.lastVolatilityEvent,
      coolingOffPeriod: this.coolingOffPeriod,
      inCoolingOffPeriod: Date.now() - this.lastVolatilityEvent < this.coolingOffPeriod
    };
  }
  
  /**
   * Get detailed volatility metrics for all timeframes
   */
  getDetailedVolatilityMetrics() {
    return {
      short: this.calculateTimeframeVolatility('short'),
      medium: this.calculateTimeframeVolatility('medium'),
      long: this.calculateTimeframeVolatility('long'),
      state: this.getVolatilityState(),
      dataPointCounts: {
        short: this.shortTermConfig.dataPoints.length,
        medium: this.mediumTermConfig.dataPoints.length,
        long: this.longTermConfig.dataPoints.length
      }
    };
  }
}

export default VolatilityDetector;