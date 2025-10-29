#!/usr/bin/env node

/**
 * Build Session Command Utility
 * 
 * This script reads session data from Redis and builds the proper command line
 * arguments to recreate or continue that session. This is useful for:
 * - Rolling sessions (building next session command)
 * - Session recovery (restarting failed sessions)
 * - Manual session continuation
 * - Command line validation and debugging
 * 
 * Usage:
 *   node build-session-command.js <sessionId>
 *   node build-session-command.js <sessionId> --for-rolling
 *   node build-session-command.js <sessionId> --output=json
 *   node build-session-command.js <sessionId> --new-session-id=uuid
 */

import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { RedisAdapter } from '../../../lib/utils/redis-adapter.js';
import minimist from 'minimist';

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../..');

// Load environment variables
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn(`Warning: .env file not found at ${envPath}`);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const argv = minimist(process.argv.slice(2), {
    string: ['output', 'new-session-id', 'script-path'],
    boolean: ['for-rolling', 'help', 'validate', 'verbose'],
    alias: {
      h: 'help',
      v: 'verbose',
      o: 'output'
    },
    default: {
      output: 'command',
      'script-path': 'src/services/market-maker/run-market-maker.js',
      verbose: false
    }
  });

  if (argv.help || argv._.length === 0) {
    console.log(`
Build Session Command Utility

USAGE:
  node build-session-command.js <sessionId> [options]

ARGUMENTS:
  sessionId              UUID of the session to build command for

OPTIONS:
  --for-rolling          Build command for a rolling session (generates new session ID)
  --new-session-id=ID    Use specific session ID instead of generating one
  --output=FORMAT        Output format: 'command', 'json', 'env', 'array' (default: command)
  --script-path=PATH     Path to the market maker script (default: src/services/market-maker/run-market-maker.js)
  --validate             Validate the built command syntax
  --verbose, -v          Show detailed information
  --help, -h             Show this help message

OUTPUT FORMATS:
  command                Shell command string (default)
  json                   JSON object with command parts
  env                    Environment variables format
  array                  Array of command arguments

EXAMPLES:
  # Build command to restart existing session
  node build-session-command.js 123e4567-e89b-12d3-a456-426614174000
  
  # Build command for rolling session (new session ID)
  node build-session-command.js 123e4567-e89b-12d3-a456-426614174000 --for-rolling
  
  # Output as JSON for programmatic use
  node build-session-command.js 123e4567-e89b-12d3-a456-426614174000 --output=json
  
  # Use specific new session ID for rolling
  node build-session-command.js 123e4567-e89b-12d3-a456-426614174000 --for-rolling --new-session-id=456e7890-e89b-12d3-a456-426614174000
`);
    process.exit(0);
  }

  return argv;
}

/**
 * Find session data in Redis by trying different key patterns
 */
async function findSessionData(redis, sessionId, verbose = false) {
  if (verbose) {
    console.log(`🔍 Searching for session data for ID: ${sessionId}`);
  }

  // Try to find the session key by pattern matching
  const pattern = `*${sessionId}*`;
  const allKeys = await redis.keys(pattern);
  
  if (verbose) {
    console.log(`Found ${allKeys.length} keys matching pattern: ${pattern}`);
    allKeys.forEach(key => console.log(`  - ${key}`));
  }

  const sessionKey = allKeys.find(key => key.endsWith(':session'));
  
  if (!sessionKey) {
    throw new Error(`No session data found for session ID: ${sessionId}`);
  }

  if (verbose) {
    console.log(`📋 Using session key: ${sessionKey}`);
  }

  // Load session data - try different storage formats
  let sessionData = null;
  
  try {
    // Try GET method first (JSON string storage)
    const sessionString = await redis.get(sessionKey);
    if (sessionString) {
      sessionData = typeof sessionString === 'string' ? JSON.parse(sessionString) : sessionString;
      if (verbose) {
        console.log(`✅ Loaded session data using GET method`);
      }
    }
  } catch (getError) {
    if (verbose) {
      console.log(`❌ GET method failed: ${getError.message}`);
    }
  }

  // Try HGETALL if GET didn't work
  if (!sessionData) {
    try {
      const hashData = await redis.hGetAll(sessionKey);
      if (hashData && Object.keys(hashData).length > 0) {
        sessionData = hashData;
        if (verbose) {
          console.log(`✅ Loaded session data using HGETALL method`);
        }
      }
    } catch (hgetError) {
      if (verbose) {
        console.log(`❌ HGETALL method failed: ${hgetError.message}`);
      }
    }
  }

  if (!sessionData) {
    throw new Error(`Could not load session data from key: ${sessionKey}`);
  }

  // Extract key components for context
  const keyParts = sessionKey.split(':');
  const keyInfo = {
    strategy: keyParts[0],
    exchange: keyParts[1],
    symbol: keyParts[2].replace('-', '/').toUpperCase(),
    sessionId: keyParts[3],
    originalKey: sessionKey
  };

  return { sessionData, keyInfo };
}

/**
 * Build command arguments from session data
 */
function buildCommandArgs(sessionData, keyInfo, options = {}) {
  const args = [];
  
  // Core required arguments
  args.push(`--trading-pair=${keyInfo.symbol}`);
  args.push(`--strategy=${keyInfo.strategy}`);
  args.push(`--exchange=${keyInfo.exchange}`);
  
  // Session ID - use new one for rolling, original for restart
  const sessionId = options.forRolling 
    ? (options.newSessionId || uuidv4())
    : keyInfo.sessionId;
  
  // Budget
  if (sessionData.budget !== undefined) {
    args.push(`--budget=${sessionData.budget}`);
  }
  
  // Trading mode
  if (sessionData.tradingMode || sessionData.settings?.tradingMode) {
    const tradingMode = sessionData.tradingMode || sessionData.settings.tradingMode;
    args.push(`--trading-mode=${tradingMode}`);
  }
  
  // Session length - NOW MANDATORY
  let sessionLength = null;
  if (sessionData.sessionLength !== undefined) {
    sessionLength = sessionData.sessionLength;
  } else if (sessionData.settings?.sessionLength) {
    sessionLength = sessionData.settings.sessionLength;
  } else if (sessionData.settings?.duration) {
    sessionLength = sessionData.settings.duration;
  }
  
  if (!sessionLength || sessionLength <= 0) {
    throw new Error(`CRITICAL ERROR: sessionLength is required but missing or invalid. ` +
      `Found: ${sessionLength}. Session commands MUST include a valid session duration to prevent infinite execution.`);
  }
  
  args.push(`--session-length=${sessionLength}`);
  
  // Pricing strategy configuration
  if (sessionData.pricingStrategyConfig || sessionData.settings?.pricingStrategyConfig) {
    const pricingConfig = sessionData.pricingStrategyConfig || sessionData.settings.pricingStrategyConfig;
    args.push(`--pricing-config='${JSON.stringify(pricingConfig)}'`);
  }
  
  // Pricing strategy name
  if (sessionData.pricingStrategyName || sessionData.settings?.pricingStrategyName) {
    const strategyName = sessionData.pricingStrategyName || sessionData.settings.pricingStrategyName;
    args.push(`--pricingStrategy=${strategyName}`);
  }
  
  // Trading parameters
  if (sessionData.pricePrecision !== undefined || sessionData.settings?.pricePrecision !== undefined) {
    const precision = sessionData.pricePrecision ?? sessionData.settings?.pricePrecision;
    args.push(`--price-precision=${precision}`);
  }
  
  if (sessionData.sizePrecision !== undefined || sessionData.settings?.sizePrecision !== undefined) {
    const precision = sessionData.sizePrecision ?? sessionData.settings?.sizePrecision;
    args.push(`--size-precision=${precision}`);
  }
  
  if (sessionData.minOrderSize !== undefined || sessionData.settings?.minOrderSize !== undefined) {
    const minSize = sessionData.minOrderSize ?? sessionData.settings?.minOrderSize;
    args.push(`--min-order-size=${minSize}`);
  }
  
  if (sessionData.mainLoopIntervalMs !== undefined || sessionData.settings?.mainLoopIntervalMs !== undefined) {
    const interval = sessionData.mainLoopIntervalMs ?? sessionData.settings?.mainLoopIntervalMs;
    args.push(`--main-loop-interval-ms=${interval}`);
  }
  
  // Rolling configuration
  if (options.forRolling || sessionData.rolling || sessionData.settings?.rolling) {
    args.push('--rolling=true');
    
    const maxChainLength = sessionData.maxRollingChainLength 
      || sessionData.settings?.maxRollingChainLength 
      || 10;
    args.push(`--max-rolling-chain-length=${maxChainLength}`);
  }
  
  // Force trading flag
  if (sessionData.forceTradingEnabled || sessionData.settings?.forceTradingEnabled) {
    args.push('--force-trading=true');
  }
  
  // Settlement flag
  if (sessionData.settleSession || sessionData.settings?.settleSession) {
    args.push('--settle-session=true');
  }
  
  // Export CSV flag
  if (sessionData.exportCsv || sessionData.settings?.exportCsv) {
    args.push('--export-csv=true');
  }
  
  // Fee configuration
  if (sessionData.feeConfig || sessionData.settings?.feeConfig) {
    const feeConfig = sessionData.feeConfig || sessionData.settings.feeConfig;
    // Fee config is typically passed through environment or config file
    // Add as comment for now
    args.push(`# Fee config: ${JSON.stringify(feeConfig)}`);
  }
  
  return { args, sessionId };
}

/**
 * Format output based on requested format
 */
function formatOutput(scriptPath, args, sessionId, format, sessionData, keyInfo) {
  switch (format) {
    case 'json':
      return JSON.stringify({
        command: `node ${scriptPath}`,
        args: args,
        sessionId: sessionId,
        fullCommand: `node ${scriptPath} ${args.join(' ')}`,
        sessionInfo: {
          originalSessionId: keyInfo.sessionId,
          strategy: keyInfo.strategy,
          exchange: keyInfo.exchange,
          symbol: keyInfo.symbol,
          tradingMode: sessionData.tradingMode || sessionData.settings?.tradingMode,
          budget: sessionData.budget
        }
      }, null, 2);
      
    case 'env':
      const envVars = [
        `export TRADING_PAIR="${keyInfo.symbol}"`,
        `export STRATEGY_TYPE="${keyInfo.strategy}"`,
        `export EXCHANGE_TYPE="${keyInfo.exchange}"`,
        `export SESSION_ID="${sessionId}"`,
        `export TRADING_MODE="${sessionData.tradingMode || sessionData.settings?.tradingMode || 'paper'}"`,
        `export BUDGET="${sessionData.budget || 1000}"`
      ];
      return envVars.join('\n') + '\n\n# Command:\n# node ' + scriptPath + ' ' + args.join(' ');
      
    case 'array':
      return JSON.stringify(['node', scriptPath, ...args], null, 2);
      
    default: // 'command'
      return `node ${scriptPath} ${args.join(' ')}`;
  }
}

/**
 * Validate command syntax (basic validation)
 */
function validateCommand(args) {
  const errors = [];
  const warnings = [];
  
  // Check for required arguments - NOW INCLUDING SESSION LENGTH
  const required = ['--trading-pair', '--strategy', '--exchange', '--session-id', '--budget', '--trading-mode', '--session-length'];
  for (const req of required) {
    const found = args.some(arg => arg.startsWith(req));
    if (!found) {
      errors.push(`Missing required argument: ${req}`);
    }
  }
  
  // Validate session length value if present
  const sessionLengthArg = args.find(arg => arg.startsWith('--session-length'));
  if (sessionLengthArg) {
    const sessionLengthValue = sessionLengthArg.split('=')[1];
    const sessionLengthMs = parseInt(sessionLengthValue, 10);
    
    if (isNaN(sessionLengthMs) || sessionLengthMs <= 0) {
      errors.push(`Invalid session length: ${sessionLengthValue}. Must be a positive number in milliseconds.`);
    } else if (sessionLengthMs < 60000) {
      warnings.push(`Very short session length: ${sessionLengthMs}ms (${sessionLengthMs / 1000}s). Sessions shorter than 1 minute may not function properly.`);
    } else if (sessionLengthMs > 86400000) {
      warnings.push(`Very long session length: ${sessionLengthMs}ms (${sessionLengthMs / 3600000}h). Sessions longer than 24 hours may consume excessive resources.`);
    }
  }
  
  const pricingArg = args.find(arg => arg.startsWith('--pricing') || arg.startsWith('--sellPricing') || arg.startsWith('--buyPricing'));
  if (!pricingArg) {
    warnings.push('No pricing strategy specified - using defaults');
  }
  
  return { errors, warnings };
}

/**
 * Main function
 */
async function main() {
  const argv = parseArgs();
  const sessionId = argv._[0];
  
  if (!sessionId) {
    console.error('❌ Session ID is required');
    process.exit(1);
  }
  
  try {
    // Initialize Redis
    const redis = RedisAdapter.fromEnv(process.env);
    
    if (argv.verbose) {
      console.log('🔌 Connected to Redis');
    }
    
    // Find and load session data
    const { sessionData, keyInfo } = await findSessionData(redis, sessionId, argv.verbose);
    
    if (argv.verbose) {
      console.log('📊 Session data loaded:');
      console.log(`  Strategy: ${keyInfo.strategy}`);
      console.log(`  Exchange: ${keyInfo.exchange}`);
      console.log(`  Symbol: ${keyInfo.symbol}`);
      console.log(`  Trading Mode: ${sessionData.tradingMode || sessionData.settings?.tradingMode}`);
      console.log(`  Budget: ${sessionData.budget}`);
      console.log(`  Status: ${sessionData.status}`);
      if (sessionData.settings) {
        console.log(`  Settings: ${Object.keys(sessionData.settings).join(', ')}`);
      }
    }
    
    // Build command arguments
    const options = {
      forRolling: argv['for-rolling'],
      newSessionId: argv['new-session-id']
    };
    
    const { args, sessionId: targetSessionId } = buildCommandArgs(sessionData, keyInfo, options);
    
    // Add session ID if specified and not for rolling (since rolling creates new session IDs)
    // NOTE: Removed --session-id parameter as run-market-maker.js no longer accepts it
    // The script auto-generates session IDs instead
    if (options.newSessionId && !options.forRolling) {
      console.warn('--session-id parameter is no longer supported by run-market-maker.js');
      console.warn('The market maker script will auto-generate a new session ID');
    }
    
    // Validate command if requested
    if (argv.validate) {
      const { errors, warnings } = validateCommand(args);
      
      if (errors.length > 0) {
        console.error('❌ Command validation errors:');
        errors.forEach(error => console.error(`  - ${error}`));
      }
      
      if (warnings.length > 0) {
        console.warn('⚠️  Command validation warnings:');
        warnings.forEach(warning => console.warn(`  - ${warning}`));
      }
      
      if (errors.length > 0) {
        process.exit(1);
      }
    }
    
    // Format and output result
    const output = formatOutput(argv['script-path'], args, targetSessionId, argv.output, sessionData, keyInfo);
    console.log(output);
    
    if (argv.verbose) {
      console.log('\n📋 Command Summary:');
      if (options.forRolling) {
        console.log(`  Rolling from session: ${keyInfo.sessionId}`);
        console.log(`  New session ID: ${targetSessionId}`);
      } else {
        console.log(`  Recreating session: ${keyInfo.sessionId}`);
      }
      console.log(`  Output format: ${argv.output}`);
      console.log(`  Total arguments: ${args.length}`);
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (argv.verbose) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { findSessionData, buildCommandArgs, formatOutput, validateCommand }; 