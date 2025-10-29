/**
 * AMM Log Configuration
 * Controls log verbosity for different components
 */

export const AMMLogConfig = {
  // Global log level for AMM (error, warn, info, debug)
  globalLevel: process.env.AMM_LOG_LEVEL || 'info',
  
  // Component-specific log levels
  components: {
    'START_DEBUG': process.env.AMM_START_DEBUG || 'warn',
    'LISTENER_DEBUG': process.env.AMM_LISTENER_DEBUG || 'warn',
    'ORDERBOOK_DEBUG': process.env.AMM_ORDERBOOK_DEBUG || 'warn',
    'MAIN_LOOP_DEBUG': process.env.AMM_MAIN_LOOP_DEBUG || 'warn',
    'TDE_DEBUG': process.env.AMM_TDE_DEBUG || 'warn',
    'BUDGET_DEBUG': process.env.AMM_BUDGET_DEBUG || 'info',
    'DECISION_DEBUG': process.env.AMM_DECISION_DEBUG || 'info'
  },
  
  // Disable specific log patterns
  disabledPatterns: [
    process.env.DISABLE_AMM_DEBUG === 'true' && /_DEBUG/,
    process.env.DISABLE_AMM_ORDERBOOK === 'true' && /ORDERBOOK/,
    process.env.DISABLE_AMM_LISTENER === 'true' && /LISTENER/
  ].filter(Boolean)
};
