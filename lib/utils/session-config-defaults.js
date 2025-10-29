/**
 * Session Configuration Defaults
 * 
 * Provides default configuration values for trading sessions to prevent "N/A" displays
 * when session data is missing or incomplete.
 */

const DEFAULT_SESSION_CONFIG = {
  // Trading Configuration
  minOrderSize: 10.0,
  maxOrderSize: 100.0,
  mainLoopInterval: 30000, // 30 seconds
  forceTradingEnabled: false,
  dryRunMode: false,
  
  // Stop Loss & Take Profit
  stopLoss: 2.0,
  takeProfit: 1.5,
  spreadThreshold: 0.5,
  
  // Pricing Strategy
  pricingStrategy: {
    buyStrategy: {
      mode: 'percentage',
      percentage: 0.1,
      offset: 0.0,
      minPrice: null,
      maxPrice: null
    },
    sellStrategy: {
      mode: 'percentage',
      percentage: 0.1,
      offset: 0.0,
      minPrice: null,
      maxPrice: null
    }
  },
  
  // System & Debug Settings
  logLevel: 'info',
  consoleLogging: true,
  exportCsv: false,
  redisPersistence: true,
  containerAware: false,
  exitOnError: false,
  debugMode: false,
  autoRestart: false,
  autoStop: false,
  saveSessionHistory: true
};

/**
 * Applies default configuration to a session object
 * @param {Object} session - Session object that may be missing configuration
 * @returns {Object} Session object with default values applied
 */
export function applySessionDefaults(session) {
  if (!session) {
    return { ...DEFAULT_SESSION_CONFIG };
  }
  
  const sessionWithDefaults = { ...session };
  
  // Apply defaults for missing top-level fields
  Object.keys(DEFAULT_SESSION_CONFIG).forEach(key => {
    if (sessionWithDefaults[key] === undefined || sessionWithDefaults[key] === null) {
      sessionWithDefaults[key] = DEFAULT_SESSION_CONFIG[key];
    }
  });
  
  // Ensure nested pricing strategy has defaults
  if (!sessionWithDefaults.pricingStrategy || typeof sessionWithDefaults.pricingStrategy !== 'object') {
    sessionWithDefaults.pricingStrategy = { ...DEFAULT_SESSION_CONFIG.pricingStrategy };
  } else {
    // Apply defaults to existing pricing strategy
    if (!sessionWithDefaults.pricingStrategy.buyStrategy) {
      sessionWithDefaults.pricingStrategy.buyStrategy = { ...DEFAULT_SESSION_CONFIG.pricingStrategy.buyStrategy };
    }
    if (!sessionWithDefaults.pricingStrategy.sellStrategy) {
      sessionWithDefaults.pricingStrategy.sellStrategy = { ...DEFAULT_SESSION_CONFIG.pricingStrategy.sellStrategy };
    }
  }
  
  return sessionWithDefaults;
}

/**
 * Gets the display value for a session field, returning the value or a default
 * @param {Object} session - Session object
 * @param {string} fieldPath - Dot notation path to field (e.g., 'pricingStrategy.buyStrategy.mode')
 * @returns {any} Field value or appropriate default
 */
export function getSessionFieldValue(session, fieldPath) {
  const sessionWithDefaults = applySessionDefaults(session);
  
  // Navigate nested object path
  const pathParts = fieldPath.split('.');
  let value = sessionWithDefaults;
  
  for (const part of pathParts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return 'N/A';
    }
  }
  
  return value;
}

/**
 * Formats a session field value for display
 * @param {any} value - The field value
 * @param {string} type - The type of formatting to apply
 * @returns {string} Formatted display value
 */
export function formatSessionValue(value, type = 'default') {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  
  switch (type) {
    case 'currency':
      return typeof value === 'number' ? `$${value.toFixed(2)}` : value.toString();
    case 'percentage':
      return typeof value === 'number' ? `${value}%` : value.toString();
    case 'duration':
      return typeof value === 'number' ? `${value}ms` : value.toString();
    case 'boolean':
      return value ? 'Enabled' : 'Disabled';
    default:
      return value.toString();
  }
}

export default {
  DEFAULT_SESSION_CONFIG,
  applySessionDefaults,
  getSessionFieldValue,
  formatSessionValue
}; 