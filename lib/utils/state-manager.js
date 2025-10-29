/**
 * State Manager for Market Making Agents
 * 
 * This class provides centralized state management for trading agents,
 * persisting state in Redis for recovery and monitoring.
 */

import { formatSymbol, formatExchange, generateRedisKey } from '../../../lib/utils/redis-key-formatter.js';

class StateManager {
  constructor(redis, options = {}) {
    this.redis = redis;
    
    // Accept trading pair as a parameter, but make it optional
    this.tradingPair = options.tradingPair || process.env.DEFAULT_TRADING_PAIR || '';
    
    // Allow initialization without a trading pair for multi-session operations
    this.hasTradingPair = !!this.tradingPair;
    
    if (!this.hasTradingPair) {
      console.warn('[StateManager] No trading pair specified. Some operations will require explicit trading pair or session ID.');
    } else {
      // Only set up trading pair specific properties if we have a pair
      // Store exchange and strategy for key generation
      this.exchange = options.exchange || 'kraken';
      this.strategy = options.strategy || 'traditional';
      
      // Log the strategy being used
      console.log(`[StateManager] Using strategy: ${this.strategy}`);
      
      // Format the trading pair using the centralized formatter
      this.formattedSymbol = formatSymbol(this.tradingPair);
      this.formattedExchange = formatExchange(this.exchange);
      
      // Generate key prefix using consistent formatting
      this.keyPrefix = `${this.strategy}:${this.formattedExchange}:${this.formattedSymbol}:`;
      
      console.log(`[StateManager] Initialized with trading pair: ${this.tradingPair}, using key prefix: ${this.keyPrefix}`);
      
      // Set up Redis keys using the prefix pattern
      this.stateKey = `${this.keyPrefix}state`;
      this.positionsKey = `${this.keyPrefix}positions`;
      this.configKey = `${this.keyPrefix}config`;
      this.errorsKey = `${this.keyPrefix}errors`;
      this.activeSessionKey = `${this.keyPrefix}active-session`;
      this.recentSessionsKey = `${this.keyPrefix}recent-sessions`;
      this.sessionHistoryKey = `${this.keyPrefix}session-history`;
      this.tradesKey = `${this.keyPrefix}trades`;
      this.metricsKey = `${this.keyPrefix}metrics`;
      this.volumeKey = `${this.keyPrefix}volume`;
    }
    
    // Add memory cache for improved performance and reduced Redis calls
    this.cache = {
      state: null,
      positions: null,
      lastSync: Date.now()
    };
    
    // Sync interval in milliseconds (1 second)
    this.syncInterval = 1000;
  }
  
  /**
   * Load the current market maker state from Redis
   */
  async loadState() {
    try {
      // If no trading pair is specified, return a basic state
      if (!this.hasTradingPair) {
        return {
          message: "No trading pair specified. Use a specific session ID or trading pair for detailed state.",
          timestamp: Date.now(),
          hasValidTradingPair: false
        };
      }
      
      // Use cached state if available and recently updated
      if (this.cache.state && this.cache.positions) {
        return {
          ...this.cache.state,
          positions: this.cache.positions
        };
      }
      
      // Otherwise, load from Redis
      const [stateStr, positionsStr, configStr] = await Promise.all([
        this.redis.get(this.stateKey),
        this.redis.get(this.positionsKey),
        this.redis.get(this.configKey)
      ]);
      
      let state = {};
      let positions = [];
      let config = {};
      
      if (stateStr) {
        state = JSON.parse(stateStr);
        this.cache.state = state; // Update cache
      }
      
      if (positionsStr) {
        positions = JSON.parse(positionsStr);
        this.cache.positions = positions; // Update cache
      }
      
      if (configStr) {
        config = JSON.parse(configStr);
      }
      
      return {
        ...state,
        positions,
        ...config
      };
    } catch (error) {
      console.error('Error loading state from Redis:', error);
      
      // If cache is available, use it as fallback
      if (this.cache.state) {
        return {
          ...this.cache.state,
          positions: this.cache.positions || []
        };
      }
      
      return {
        budget: 200,
        allocatedBudget: 0,
        reservedBudget: 0,
        totalProfitLoss: 0,
        drawdownCurrent: 0,
        drawdownMax: 0,
        positions: [],
        buyAgentConfig: {
          maxRiskPerTrade: 0.02,
          budget: 200
        },
        sellAgentConfig: {
          minProfitMargin: 0.005,
          maxHoldingPeriod: 48 * 60 * 60 * 1000
        }
      };
    }
  }
  
  /**
   * Save the current market maker state to Redis
   */
  async saveState(newState) {
    try {
      // First update our in-memory cache immediately
      const currentState = this.cache.state || {};
      const mergedState = {
        ...currentState,
        ...newState,
        lastUpdated: Date.now()
      };
      
      // Extract positions for separate storage
      const { positions, ...stateWithoutPositions } = mergedState;
      
      // Always update the cache immediately
      this.cache.state = stateWithoutPositions;
      if (positions) this.cache.positions = positions;
      
      // Only sync to Redis periodically to avoid rate limits
      const now = Date.now();
      if (now - this.cache.lastSync < this.syncInterval) {
        return true; // Skip Redis update, use cache only
      }
      
      // It's time to sync to Redis
      this.cache.lastSync = now;
      
      // Save state and positions in parallel
      await Promise.all([
        this.redis.set(this.stateKey, JSON.stringify(stateWithoutPositions)),
        this.redis.set(this.positionsKey, JSON.stringify(positions || []))
      ]);
      
      return true;
    } catch (error) {
      console.error('Error saving state to Redis:', error);
      return false;
    }
  }
  
  /**
   * Load strategy configuration
   * @returns {Promise<Object>} Strategy configuration
   */
  async loadStrategyConfig() {
    try {
      // If no trading pair is specified, we can't get a specific config
      if (!this.hasTradingPair) {
        return null;
      }
      
      const configStr = await this.redis.get(this.configKey);
      
      if (!configStr) {
        // No saved config, return default
        return null;
      }
      
      // Parse configuration
      let config;
      if (typeof configStr === 'string') {
        try {
          config = JSON.parse(configStr);
        } catch (e) {
          console.warn(`Failed to parse config as JSON: ${e.message}. Using default config.`);
          return null;
        }
      } else {
        config = configStr;
      }
      
      return config;
    } catch (error) {
      console.error('Error loading strategy config:', error);
      return null;
    }
  }
  
  /**
   * Update configuration
   */
  async updateConfig(newConfig) {
    try {
      const currentConfig = await this.redis.get(this.configKey);
      
      // Properly handle the case when currentConfig might be an object or a string
      let parsedConfig;
      if (currentConfig) {
        if (typeof currentConfig === 'string') {
          try {
            parsedConfig = JSON.parse(currentConfig);
          } catch (e) {
            console.warn(`Config is not valid JSON, using default config: ${e.message}`);
            parsedConfig = {
              strategyType: 'dual-agent',
              buyAgentConfig: {},
              sellAgentConfig: {}
            };
          }
        } else if (typeof currentConfig === 'object') {
          // If it's already an object, use it directly
          parsedConfig = currentConfig;
        } else {
          // Fallback to default if config is neither string nor object
          console.warn(`Unexpected config type: ${typeof currentConfig}, using default config`);
          parsedConfig = {
            strategyType: 'dual-agent',
            buyAgentConfig: {},
            sellAgentConfig: {}
          };
        }
      } else {
        // Default configuration if none exists
        parsedConfig = {
          strategyType: 'dual-agent',
          buyAgentConfig: {},
          sellAgentConfig: {}
        };
      }
      
      // Ensure newConfig is also properly handled
      let configToMerge = newConfig;
      if (typeof newConfig === 'string') {
        try {
          configToMerge = JSON.parse(newConfig);
        } catch (e) {
          console.warn(`New config is not valid JSON, using as-is: ${e.message}`);
          configToMerge = {};
        }
      }
      
      // Merge configurations
      const mergedConfig = {
        ...parsedConfig,
        ...configToMerge,
        lastUpdated: Date.now()
      };
      
      // Ensure we're storing a JSON string
      const configToStore = JSON.stringify(mergedConfig);
      await this.redis.set(this.configKey, configToStore);
      return true;
    } catch (error) {
      console.error('Error updating config in Redis:', error);
      return false;
    }
  }
  
  /**
   * Add a position to inventory
   * @param {Object} position - Position object
   */
  async addPosition(position) {
    try {
      // Generate a position ID if not provided
      if (!position.id) {
        position.id = uuidv4();
      }
      
      // Set creation timestamp if not provided
      if (!position.createdAt) {
        position.createdAt = Date.now();
      }
      
      // Calculate position value
      const size = parseFloat(position.size || position.quantity || 0);
      const entryPrice = parseFloat(position.entryPrice || 0);
      const positionValue = size * entryPrice;
      
      // Get current state to update allocated budget
      const currentState = await this.loadState();
      const currentAllocatedBudget = parseFloat(currentState.allocatedBudget || 0);
      const budget = parseFloat(currentState.budget || 200);
      
      // Check if adding this position would exceed the budget limit
      const newAllocatedBudget = currentAllocatedBudget + positionValue;
      const maxAllocationPercentage = 0.7; // 70% maximum allocation
      
      if (newAllocatedBudget > budget * maxAllocationPercentage) {
        console.warn(`[StateManager] Cannot add position: would exceed ${maxAllocationPercentage * 100}% budget allocation limit`);
        console.warn(`[StateManager] Current allocation: $${currentAllocatedBudget.toFixed(2)}, Position value: $${positionValue.toFixed(2)}, Budget: $${budget.toFixed(2)}`);
        return { success: false, error: 'Budget allocation limit exceeded', budgetLimitExceeded: true };
      }
      
      // Get all positions to check count limit
      const positions = await this.getPositions();
      const maxPositionCount = 30; // Maximum 30 positions
      
      if (positions.length >= maxPositionCount) {
        console.error(`[StateManager] Cannot add position: would exceed maximum position count of ${maxPositionCount}`);
        console.error(`[StateManager] Current position count: ${positions.length}`);
        return { success: false, error: 'Maximum position count reached' };
      }
      
      // Get the active session ID
      const session = await this.getActiveSession();
      const sessionId = session ? session.id : 'default';
      
      // Make sure the position has the session ID
      position.sessionId = sessionId;
      
      // Store position in Redis
      await this.redis.set(`position:${position.id}`, position);
      
      // Add position ID to the positions set
      await this.redis.sAdd(`positions:${sessionId}`, position.id);
      
      // Update allocated budget in state
      await this.saveState({ allocatedBudget: newAllocatedBudget });
      
      console.log(`[StateManager] Added position ${position.id} with value $${positionValue.toFixed(2)}`);
      console.log(`[StateManager] Updated allocated budget: $${newAllocatedBudget.toFixed(2)} / $${budget.toFixed(2)} (${(newAllocatedBudget/budget*100).toFixed(2)}%)`);
      
      return { success: true, position };
    } catch (error) {
      console.error('Error adding position:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Update a position in inventory
   */
  async updatePosition(positionId, updates) {
    try {
      const positionsStr = await this.redis.get(this.positionsKey);
      const positions = positionsStr ? JSON.parse(positionsStr) : [];
      
      // Find and update position
      const updatedPositions = positions.map(position => {
        if (position.id === positionId) {
          return { ...position, ...updates, updatedAt: Date.now() };
        }
        return position;
      });
      
      await this.redis.set(this.positionsKey, JSON.stringify(updatedPositions));
      return true;
    } catch (error) {
      console.error('Error updating position in Redis:', error);
      return false;
    }
  }
  
  /**
   * Remove a position from inventory
   * @param {string} positionId - Position ID to remove
   * @returns {Promise<Object>} Result of the operation
   */
  async removePosition(positionId) {
    try {
      // Get the position data first
      const position = await this.redis.get(`position:${positionId}`);
      
      if (!position) {
        console.warn(`[StateManager] Position ${positionId} not found, cannot remove`);
        return { success: false, error: 'Position not found' };
      }
      
      // Calculate position value
      const size = parseFloat(position.size || position.quantity || 0);
      const entryPrice = parseFloat(position.entryPrice || 0);
      const positionValue = size * entryPrice;
      
      // Get current state to update allocated budget
      const currentState = await this.loadState();
      const currentAllocatedBudget = parseFloat(currentState.allocatedBudget || 0);
      
      // Calculate new allocated budget (ensure it doesn't go below 0)
      const newAllocatedBudget = Math.max(0, currentAllocatedBudget - positionValue);
      
      // Remove position from Redis
      await this.redis.del(`position:${positionId}`);
      
      // Remove position ID from the positions set
      const sessionId = position.sessionId || 'default';
      await this.redis.sRem(`positions:${sessionId}`, positionId);
      
      // Update allocated budget in state
      await this.saveState({ allocatedBudget: newAllocatedBudget });
      
      console.log(`[StateManager] Removed position ${positionId} with value $${positionValue.toFixed(2)}`);
      console.log(`[StateManager] Updated allocated budget: $${newAllocatedBudget.toFixed(2)}`);
      
      return { success: true, position };
    } catch (error) {
      console.error('Error removing position:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Record an error for monitoring
   */
  async recordError(error) {
    try {
      const errorsStr = await this.redis.get(this.errorsKey);
      
      // Handle errors data - could be string or object
      let errors = [];
      if (errorsStr) {
        if (typeof errorsStr === 'string') {
          try {
            errors = JSON.parse(errorsStr);
          } catch (e) {
            console.warn(`Failed to parse errors as JSON: ${e.message}. Using empty array.`);
            errors = Array.isArray(errorsStr) ? errorsStr : [];
          }
        } else {
          // If it's already an object, use it directly
          errors = Array.isArray(errorsStr) ? errorsStr : [];
        }
      }
      
      // Add new error with timestamp
      errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: Date.now()
      });
      
      // Keep only the last 50 errors
      const recentErrors = errors.slice(-50);
      
      await this.redis.set(this.errorsKey, JSON.stringify(recentErrors));
      return true;
    } catch (e) {
      console.error('Error recording error to Redis:', e);
      return false;
    }
  }

  /**
   * Get the active trading session for the specified pair/strategy
   * @param {string} sessionId Optional session ID to retrieve a specific session
   * @returns {Promise<Object>} Active session or null if none active
   */
  async getActiveSession(sessionId = null) {
    try {
      // If sessionId is provided, use that to look up the session directly
      if (sessionId) {
        // Try to find the session by ID using different key formats
        const tradingPairsToTry = [
          this.tradingPair || 'BTC/USD', 
          'ETH/USD', 
          'SOL/USD', 
          'XRP/USD'
        ].filter(Boolean);
        
        for (const tradingPair of tradingPairsToTry) {
          // Format the trading pair for Redis keys
          const formattedPair = tradingPair.replace('/', '-').toLowerCase();
          
          // Build key formats to try
          const keyFormats = [
            `traditional-v2:kraken:${formattedPair}:${sessionId}:session`,
            `traditional:kraken:${formattedPair}:${sessionId}:session`,
            `strategy:traditional:${formattedPair.replace('-', '_')}:${sessionId}:session`
          ];
          
          // Try each key format
          for (const keyFormat of keyFormats) {
            const sessionData = await this.redis.get(keyFormat);
            if (sessionData) {
              try {
                return JSON.parse(sessionData);
              } catch (e) {
                console.warn(`Error parsing session data: ${e.message}`);
              }
            }
          }
        }
        
        // If session wasn't found, check if redis-backend-api SessionManager can find it
        try {
          const { SessionManager } = await import('../../../lib/redis-backend-api/session-manager.js');
          const sessionResult = await SessionManager.findBySessionId({
            redis: this.redis,
            sessionId,
            logger: console
          });
          
          if (sessionResult && sessionResult.data) {
            return sessionResult.data;
          }
        } catch (e) {
          console.warn(`Error using SessionManager to find session: ${e.message}`);
        }
        
        return null;
      }
      
      // If no sessionId and no trading pair, we can get all active sessions
      if (!this.hasTradingPair) {
        // Use redis SCAN to find active sessions (more efficient than KEYS)
        const sessionsMap = {};
        
        try {
          // Use the scan method which handles large key sets better
          const allSessionKeys = await this.redis.scan('*:session');
          
          // Process each session key found
          for (const key of allSessionKeys) {
            const sessionData = await this.redis.get(key);
            if (sessionData) {
              try {
                const session = JSON.parse(sessionData);
                if (session.id && session.status === 'active') {
                  // Extract trading pair from key
                  const keyParts = key.split(':');
                  let tradingPair = '';
                  if (keyParts.length >= 3) {
                    tradingPair = keyParts[2].replace('-', '/').toUpperCase();
                  }
                  
                  sessionsMap[session.id] = {
                    ...session,
                    tradingPair,
                    keyFormat: key
                  };
                }
              } catch (e) {
                console.warn(`Error parsing session data for key ${key}: ${e.message}`);
              }
            }
          }
          
          return Object.values(sessionsMap);
        } catch (error) {
          console.error('Error getting active sessions:', error);
          return [];
        }
      }
      
      // If trading pair is specified, use the legacy approach
      const sessionStr = await this.redis.get(this.activeSessionKey);
      
      if (!sessionStr) {
        return null;
      }
      
      try {
        return JSON.parse(sessionStr);
      } catch (error) {
        console.error('Error parsing active session:', error);
        return null;
      }
    } catch (error) {
      console.error('Error getting active session:', error);
      return null;
    }
  }

  /**
   * Create a new trading session
   * @param {string} sessionId - Unique identifier for the session
   * @param {string} tradingMode - Trading mode ('live' or 'paper')
   * @param {number} budget - Budget for the trading session (default: 200)
   */
  async createSession(sessionId, tradingMode, budget = 200) {
    try {
      // Get all open positions
      const positionsStr = await this.redis.get(this.positionsKey);
      
      // Handle positions data - could be string or object
      let positions = [];
      if (positionsStr) {
        if (typeof positionsStr === 'string') {
          try {
            positions = JSON.parse(positionsStr);
            // Ensure positions is an array
            if (!Array.isArray(positions)) {
              console.warn('Positions data is not an array, initializing empty array');
              positions = [];
            }
          } catch (e) {
            console.warn(`Failed to parse positions as JSON: ${e.message}. Using empty array.`);
            positions = [];
          }
        } else {
          // If it's already an object, ensure it's an array
          positions = Array.isArray(positionsStr) ? positionsStr : [];
        }
      }
      
      // Filter positions to only include those from the same trading mode
      // This ensures paper trading sessions don't inherit from live sessions and vice versa
      const filteredPositions = positions.filter(position => {
        // If position has no tradingMode, we can't determine if it should be included
        // Default to including it for backward compatibility
        if (!position.tradingMode) return true;
        
        // Only include positions from the same trading mode
        return position.tradingMode === tradingMode;
      });
      
      // Calculate total value of inherited positions for budget allocation
      let allocatedBudget = 0;
      if (filteredPositions.length > 0) {
        allocatedBudget = filteredPositions.reduce((total, position) => {
          // Use existing value if available
          if (position.value) {
            return total + parseFloat(position.value);
          }
          
          // Otherwise calculate it
          const size = parseFloat(position.size || position.quantity || 0);
          const entryPrice = parseFloat(position.entryPrice || 0);
          const positionValue = size * entryPrice;
          return total + positionValue;
        }, 0);
      }
      
      // Initialize session state
      const sessionState = {
        budget: budget,
        allocatedBudget: allocatedBudget,
        reservedBudget: 0,
        totalProfitLoss: 0,
        drawdownCurrent: 0,
        drawdownMax: 0,
        lastExecutionTime: 0,
        buyAgentConfig: {
          maxRiskPerTrade: 0.02,
          budget: budget
        },
        sellAgentConfig: {
          minProfitMargin: 0.005,
          maxHoldingPeriod: 48 * 60 * 60 * 1000
        }
      };
      
      // Initialize session
      const session = {
        id: sessionId,
        startedAt: Date.now(),
        status: 'active',
        tradingMode: tradingMode,
        executionCount: 0,
        totalProfitLoss: 0,
        currentDrawdown: 0,
        maxDrawdown: 0,
        tradeCount: 0,
        successfulTradeCount: 0,
        inheritedPositions: filteredPositions.length > 0 ? filteredPositions.map(p => p.id) : [],
        budget: budget,
        allocatedBudget: allocatedBudget
      };
      
      // If there are positions, update them to link to the new session
      if (filteredPositions.length > 0) {
        const updatedPositions = filteredPositions.map(position => {
          // Update position with value if not already set
          let positionWithValue = {...position};
          if (!positionWithValue.value) {
            const size = parseFloat(position.size || position.quantity || 0);
            const entryPrice = parseFloat(position.entryPrice || 0);
            positionWithValue.value = size * entryPrice;
          }
          
          return {
            ...positionWithValue,
            sessionId: sessionId,
            inheritedFromSession: position.sessionId,
            updatedAt: Date.now()
          };
        });
        
        await this.redis.set(this.positionsKey, JSON.stringify(updatedPositions));
      }
      
      // Save session state
      await this.saveState(sessionState);
      
      // Save session details
      await this.redis.set(this.activeSessionKey, JSON.stringify(session));
      
      console.log(`Created session with ID ${sessionId} and budget $${budget}`);
      console.log(`Inherited ${filteredPositions.length} positions with allocated budget $${allocatedBudget.toFixed(2)}`);
      
      return session;
    } catch (error) {
      console.error('Error creating session:', error);
      return null;
    }
  }

  /**
   * Update the existing active trading session
   */
  async updateSession(sessionUpdate) {
    try {
      const sessionStr = await this.redis.get(this.activeSessionKey);
      if (!sessionStr) return false;
      
      const session = JSON.parse(sessionStr);
      const updatedSession = {
        ...session,
        ...sessionUpdate,
        lastUpdated: Date.now()
      };
      
      await this.redis.set(this.activeSessionKey, JSON.stringify(updatedSession));
      return true;
    } catch (error) {
      console.error('Error updating session:', error);
      return false;
    }
  }

  /**
   * Close the current trading session and handle open positions
   */
  async closeSession(summary = {}) {
    try {
      const sessionStr = await this.redis.get(this.activeSessionKey);
      if (!sessionStr) return false;
      
      // Handle session data - could be string or object
      let session;
      if (typeof sessionStr === 'string') {
        try {
          session = JSON.parse(sessionStr);
        } catch (e) {
          console.warn(`Failed to parse session as JSON: ${e.message}. Using session as-is.`);
          session = sessionStr;
        }
      } else {
        // If it's already an object, use it directly
        session = sessionStr;
      }
      
      // Get all open positions
      const positionsStr = await this.redis.get(this.positionsKey);
      
      // Handle positions data - could be string or object
      let positions = [];
      if (positionsStr) {
        if (typeof positionsStr === 'string') {
          try {
            positions = JSON.parse(positionsStr);
            // Ensure positions is an array
            if (!Array.isArray(positions)) {
              console.warn('Positions data is not an array, initializing empty array');
              positions = [];
            }
          } catch (e) {
            console.warn(`Failed to parse positions as JSON: ${e.message}. Using empty array.`);
            positions = [];
          }
        } else {
          // If it's already an object, ensure it's an array
          positions = Array.isArray(positionsStr) ? positionsStr : [];
        }
      }
      
      const openPositions = positions.length > 0 ? positions.filter(p => !p.exitTime) : [];
      
      // Create closure summary with position status
      const closedSession = {
        ...session,
        status: 'closed',
        endedAt: Date.now(),
        duration: Date.now() - session.startedAt,
        openPositionsAtClose: openPositions.length,
        openPositionIds: openPositions.length > 0 ? openPositions.map(p => p.id) : [],
        ...summary
      };
      
      // Move the active session to recent sessions
      await this.addToRecentSessions(closedSession);
      
      // Clear the active session
      await this.redis.del(this.activeSessionKey);
      
      // Add to historical record
      await this.addToSessionHistory(closedSession);
      
      return true;
    } catch (error) {
      console.error('Error closing session:', error);
      return false;
    }
  }

  /**
   * Add a session to the recent sessions list
   */
  async addToRecentSessions(session) {
    try {
      const recentData = await this.redis.get(this.recentSessionsKey);
      
      // Handle different response types from Redis
      let recentSessions = [];
      if (recentData) {
        if (typeof recentData === 'string') {
          try {
            recentSessions = JSON.parse(recentData);
          } catch (e) {
            console.warn('Could not parse recent sessions data as JSON, using empty array');
          }
        } else if (typeof recentData === 'object') {
          recentSessions = recentData;
        }
      }
      
      // Add to recent sessions
      recentSessions.push(session);
      
      // Keep only the last 5 recent sessions
      const updatedRecentSessions = recentSessions.slice(-5);
      
      await this.redis.set(this.recentSessionsKey, JSON.stringify(updatedRecentSessions));
      return true;
    } catch (error) {
      console.error('Error adding to recent sessions:', error);
      return false;
    }
  }
  
  /**
   * Get recent sessions
   */
  async getRecentSessions() {
    try {
      const recentData = await this.redis.get(this.recentSessionsKey);
      
      // Handle different response types from Redis
      if (!recentData) {
        return [];
      }
      
      if (typeof recentData === 'string') {
        try {
          return JSON.parse(recentData);
        } catch (e) {
          console.warn('Could not parse recent sessions data as JSON, returning empty array');
          return [];
        }
      } else if (typeof recentData === 'object') {
        return recentData;
      }
      
      return [];
    } catch (error) {
      console.error('Error getting recent sessions:', error);
      return [];
    }
  }

  /**
   * Add a closed session to the session history
   */
  async addToSessionHistory(session) {
    try {
      // Make sure to use traditional:kraken:tradingpair as key prefix for consistency
      const historyKey = this.sessionHistoryKey;
      console.log(`[StateManager] Adding session to history with key: ${historyKey}`);
      
      const historyData = await this.redis.get(historyKey);
      
      // Handle different response types from Redis
      let sessionHistory = [];
      if (historyData) {
        if (typeof historyData === 'string') {
          try {
            sessionHistory = JSON.parse(historyData);
          } catch (e) {
            console.warn('Could not parse session history data as JSON, using empty array');
          }
        } else if (typeof historyData === 'object') {
          sessionHistory = historyData;
        }
      }
      
      // Add to history
      sessionHistory.push(session);
      
      // Keep only the last 100 sessions
      const recentHistory = sessionHistory.slice(-100);
      
      await this.redis.set(historyKey, JSON.stringify(recentHistory));
      return true;
    } catch (error) {
      console.error('Error adding to session history:', error);
      return false;
    }
  }

  /**
   * Record a trade associated with a session
   */
  async recordTrade(trade) {
    try {
      if (!trade.sessionId) {
        const session = await this.getActiveSession();
        if (session) {
          trade.sessionId = session.id;
        }
      }
      
      // Add timestamp if not present
      if (!trade.timestamp) {
        trade.timestamp = Date.now();
      }
      
      // Generate trade ID if not present
      if (!trade.id) {
        trade.id = `trade-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      }
      
      // Get current trades
      const tradesStr = await this.redis.get(this.tradesKey);
      const trades = tradesStr ? JSON.parse(tradesStr) : [];
      
      // Add new trade
      trades.push(trade);
      
      // Keep only the last 1000 trades
      const recentTrades = trades.slice(-1000);
      
      // Save trades
      await this.redis.set(this.tradesKey, JSON.stringify(recentTrades));
      
      // Update session trade count if this is associated with the active session
      if (trade.sessionId) {
        const activeSession = await this.getActiveSession();
        if (activeSession && activeSession.id === trade.sessionId) {
          const updatedSession = {
            ...activeSession,
            tradeCount: (activeSession.tradeCount || 0) + 1,
            lastTradeTimestamp: Date.now()
          };
          
          if (trade.profitable) {
            updatedSession.successfulTradeCount = (activeSession.successfulTradeCount || 0) + 1;
          }
          
          await this.redis.set(this.activeSessionKey, JSON.stringify(updatedSession));
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error recording trade:', error);
      return false;
    }
  }

  /**
   * Get trades for a specific session
   */
  async getSessionTrades(sessionId) {
    try {
      const tradesStr = await this.redis.get(this.tradesKey);
      if (!tradesStr) return [];
      
      const trades = JSON.parse(tradesStr);
      return trades.filter(trade => trade.sessionId === sessionId);
    } catch (error) {
      console.error('Error getting session trades:', error);
      return [];
    }
  }
  
  /**
   * Get most recent trades (limited by count)
   */
  async getRecentTrades(count = 10) {
    try {
      const tradesStr = await this.redis.get(this.tradesKey);
      if (!tradesStr) return [];
      
      const trades = JSON.parse(tradesStr);
      return trades.slice(-count);
    } catch (error) {
      console.error('Error getting recent trades:', error);
      return [];
    }
  }
  
  /**
   * Record trading volume for fee tier calculations
   * 
   * @param {number} volume - Volume in USD
   */
  async recordTradingVolume(volume) {
    try {
      // Get current volume data
      const volumeStr = await this.redis.get(this.volumeKey);
      let volumeData;
      
      if (volumeStr) {
        try {
          // Handle case where volumeStr is already an object
          volumeData = typeof volumeStr === 'string' ? JSON.parse(volumeStr) : volumeStr;
        } catch (e) {
          console.warn(`Failed to parse volume data: ${e.message}. Initializing new volume data.`);
          volumeData = {
            last24h: 0,
            last7d: 0,
            last30d: 0,
            volumeHistory: [],
            lastUpdated: Date.now()
          };
        }
      } else {
        // Initialize new volume data if none exists
        volumeData = {
          last24h: 0,
          last7d: 0,
          last30d: 0,
          volumeHistory: [],
          lastUpdated: Date.now()
        };
      }
      
      // Ensure volumeHistory exists
      if (!volumeData.volumeHistory) {
        volumeData.volumeHistory = [];
      }
      
      // Add new volume
      volumeData.last24h += volume;
      volumeData.last7d += volume;
      volumeData.last30d += volume;
      
      // Record in history with timestamp for rolling calculations
      volumeData.volumeHistory.push({
        volume,
        timestamp: Date.now()
      });
      
      // Keep only entries from last 30 days
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      volumeData.volumeHistory = volumeData.volumeHistory.filter(entry => 
        entry.timestamp >= thirtyDaysAgo
      );
      
      // Recalculate 24h, 7d, and 30d volumes from history for accuracy
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      volumeData.last24h = volumeData.volumeHistory
        .filter(entry => entry.timestamp >= oneDayAgo)
        .reduce((sum, entry) => sum + entry.volume, 0);
        
      volumeData.last7d = volumeData.volumeHistory
        .filter(entry => entry.timestamp >= sevenDaysAgo)
        .reduce((sum, entry) => sum + entry.volume, 0);
        
      volumeData.last30d = volumeData.volumeHistory
        .reduce((sum, entry) => sum + entry.volume, 0);
      
      volumeData.lastUpdated = Date.now();
      
      // Save updated volume data
      await this.redis.set(this.volumeKey, JSON.stringify(volumeData));
      
      console.log(`[StateManager] Recorded $${volume.toFixed(2)} trading volume, 30d total: $${volumeData.last30d.toFixed(2)}`);
      return volumeData;
    } catch (error) {
      console.error('Error recording trading volume:', error);
      return null;
    }
  }
  
  /**
   * Get 30-day rolling volume for fee tier calculations
   * 
   * @returns {Object} Volume data for different time periods
   */
  async get30DayVolume() {
    try {
      const volumeStr = await this.redis.get(this.volumeKey);
      
      if (!volumeStr) {
        return {
          last24h: 0,
          last7d: 0,
          last30d: 0,
          lastUpdated: Date.now()
        };
      }
      
      // Handle the case where volumeStr is already an object
      let volumeData;
      if (typeof volumeStr === 'string') {
        try {
          volumeData = JSON.parse(volumeStr);
        } catch (e) {
          console.warn(`Error parsing volume data: ${e.message}. Using default values.`);
          return {
            last24h: 0,
            last7d: 0,
            last30d: 0,
            lastUpdated: Date.now()
          };
        }
      } else {
        // If it's already an object, use it directly
        volumeData = volumeStr;
      }
      
      // Check if we need to recalculate (for data older than 1 hour)
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      if (volumeData.lastUpdated < oneHourAgo && volumeData.volumeHistory) {
        // Recalculate rolling volumes
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        // Filter out expired history entries
        volumeData.volumeHistory = volumeData.volumeHistory.filter(entry => 
          entry.timestamp >= thirtyDaysAgo
        );
        
        // Recalculate totals
        volumeData.last24h = volumeData.volumeHistory
          .filter(entry => entry.timestamp >= oneDayAgo)
          .reduce((sum, entry) => sum + entry.volume, 0);
          
        volumeData.last7d = volumeData.volumeHistory
          .filter(entry => entry.timestamp >= sevenDaysAgo)
          .reduce((sum, entry) => sum + entry.volume, 0);
          
        volumeData.last30d = volumeData.volumeHistory
          .reduce((sum, entry) => sum + entry.volume, 0);
        
        volumeData.lastUpdated = Date.now();
        
        // Save updated calculations
        await this.redis.set(this.volumeKey, JSON.stringify(volumeData));
      }
      
      return {
        last24h: volumeData.last24h || 0,
        last7d: volumeData.last7d || 0,
        last30d: volumeData.last30d || 0,
        lastUpdated: volumeData.lastUpdated || Date.now()
      };
    } catch (error) {
      console.error('Error getting 30-day volume:', error);
      return {
        last24h: 0,
        last7d: 0,
        last30d: 0,
        lastUpdated: Date.now()
      };
    }
  }
  
  /**
   * Save metrics from an agent
   */
  async saveAgentMetrics(agentType, metrics) {
    try {
      const key = `${this.keyPrefix}${agentType}-metrics`;
      await this.redis.set(key, JSON.stringify({
        ...metrics,
        timestamp: Date.now()
      }));
      return true;
    } catch (error) {
      console.error(`Error saving ${agentType} metrics:`, error);
      return false;
    }
  }

  /**
   * Get all positions from inventory
   * 
   * @returns {Promise<Array>} Array of positions
   */
  async getPositions() {
    try {
      // Get the active session ID
      const session = await this.getActiveSession();
      const sessionId = session ? session.id : 'default';
      
      // Get position IDs from the positions set
      const positionIds = await this.redis.sMembers(`positions:${sessionId}`);
      
      if (!positionIds || positionIds.length === 0) {
        return [];
      }
      
      // Get position data for each ID
      const positions = [];
      for (const posId of positionIds) {
        const position = await this.redis.get(`position:${posId}`);
        if (position) {
          positions.push(position);
        }
      }
      
      return positions;
    } catch (error) {
      console.error('Error getting positions:', error);
      return [];
    }
  }

  /**
   * Reset all trading data for a specific trading mode
   * This will clear positions, trades, and other session data
   * 
   * @param {string} tradingMode - The trading mode to reset ('paper' or 'live')
   * @returns {Promise<Object>} Result of the reset operation
   */
  async resetTradingMode(tradingMode) {
    try {
      console.log(`Resetting all ${tradingMode} trading data...`);
      
      // Get all sessions for this trading mode
      let recentSessions = [];
      try {
        const recentSessionsData = await this.redis.get(this.recentSessionsKey);
        if (typeof recentSessionsData === 'string') {
          recentSessions = JSON.parse(recentSessionsData);
        } else if (Array.isArray(recentSessionsData)) {
          recentSessions = recentSessionsData;
        }
      } catch (error) {
        console.warn(`Error parsing recent sessions: ${error.message}. Using empty array.`);
      }
      
      // Filter sessions for the specified trading mode
      const modeSessions = recentSessions.filter(session => session.tradingMode === tradingMode);
      
      // Track removed items
      let positionsRemoved = 0;
      let sessionsRemoved = 0;
      
      // Process each session
      for (const session of modeSessions) {
        // Get positions for this session
        const positionIds = await this.redis.sMembers(`positions:${session.id}`);
        
        // Remove each position
        for (const posId of positionIds) {
          await this.redis.del(`position:${posId}`);
          positionsRemoved++;
        }
        
        // Remove the positions set
        await this.redis.del(`positions:${session.id}`);
        
        // Remove session data
        await this.redis.del(`session:${session.id}`);
        sessionsRemoved++;
      }
      
      // Update recent sessions list to exclude the reset mode
      const updatedSessions = recentSessions.filter(session => session.tradingMode !== tradingMode);
      await this.redis.set(this.recentSessionsKey, updatedSessions);
      
      // Reset state for this trading mode
      await this.saveState({
        allocatedBudget: 0,
        reservedBudget: 0,
        totalProfitLoss: 0,
        drawdownCurrent: 0,
        drawdownMax: 0
      });
      
      console.log(`Reset of ${tradingMode} trading data complete.`);
      
      return {
        success: true,
        tradingMode,
        positionsRemoved,
        sessionsRemoved
      };
    } catch (error) {
      console.error(`Error resetting ${tradingMode} trading mode:`, error);
      return {
        success: false,
        tradingMode,
        error: error.message
      };
    }
  }
}

export default StateManager;
