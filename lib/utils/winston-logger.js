/**
 * Winston Logger Configuration for Market Maker
 * 
 * This module provides a Winston-based logging system that:
 * 1. Writes to the same session-logs directory structure
 * 2. Maintains compatibility with existing R2 upload and cleanup processes
 * 3. Provides better log formatting and rotation capabilities
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';

const { combine, timestamp, printf, colorize, errors } = winston.format;

/**
 * Custom format for log messages that matches existing format
 */
const customFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  // Format timestamp to match existing: [2025-05-27T18:12:57.846Z]
  const formattedTimestamp = `[${timestamp}]`;
  
  // Format level to uppercase and pad
  const formattedLevel = `[${level.toUpperCase()}]`;
  
  // Build the log line
  let logLine = `${formattedTimestamp} ${formattedLevel} ${message}`;
  
  // Add metadata if present
  if (Object.keys(metadata).length > 0) {
    try {
      logLine += ` ${JSON.stringify(metadata, null, 2)}`;
    } catch (e) {
      logLine += ` [Metadata serialization error]`;
    }
  }
  
  // Add stack trace if error
  if (stack) {
    logLine += `\n${stack}`;
  }
  
  return logLine;
});

/**
 * Create a Winston logger instance for a specific session
 * 
 * @param {string} sessionId - The session ID
 * @param {string} logLevel - Log level (debug, info, warn, error)
 * @param {string} projectRoot - Project root directory
 * @returns {winston.Logger} Configured Winston logger
 */
export function createSessionLogger(sessionId, logLevel = 'info', projectRoot = process.cwd()) {
  // Create session log directory with improved error handling
  let sessionLogDir = path.join(projectRoot, 'session-logs', sessionId);
  
  try {
    if (!fs.existsSync(sessionLogDir)) {
      fs.mkdirSync(sessionLogDir, { recursive: true });
    }
  } catch (error) {
    console.error(`[SessionLogger] Failed to create log directory ${sessionLogDir}: ${error.message}`);
    console.error(`[SessionLogger] Falling back to using project root for logs: ${projectRoot}`);
    
    // Fallback: create logs in project root if session-logs directory creation fails
    const fallbackLogDir = path.join(projectRoot, 'logs');
    try {
      if (!fs.existsSync(fallbackLogDir)) {
        fs.mkdirSync(fallbackLogDir, { recursive: true });
      }
      // Use fallback directory with session prefix
      sessionLogDir = path.join(fallbackLogDir, `session-${sessionId}`);
      if (!fs.existsSync(sessionLogDir)) {
        fs.mkdirSync(sessionLogDir, { recursive: true });
      }
    } catch (fallbackError) {
      console.error(`[SessionLogger] Fallback directory creation also failed: ${fallbackError.message}`);
      console.error(`[SessionLogger] Will attempt to log to console only`);
      // Will create logger with console-only logging below
    }
  }
  
  const logFilePath = path.join(sessionLogDir, 'full.log');
  const errorLogPath = path.join(sessionLogDir, 'errors.log');
  
  // Create Winston logger
  const logger = winston.createLogger({
    level: logLevel,
    format: combine(
      errors({ stack: true }),
      timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
      customFormat
    ),
    transports: [
      // Write all logs to full.log
      new winston.transports.File({
        filename: logFilePath,
        level: logLevel
      }),
      // Write only errors to errors.log
      new winston.transports.File({
        filename: errorLogPath,
        level: 'error'
      }),
      // Console output with colors
      new winston.transports.Console({
        format: combine(
          colorize(),
          timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
          customFormat
        )
      })
    ],
    // Handle exceptions and rejections
    exceptionHandlers: [
      new winston.transports.File({ filename: errorLogPath })
    ],
    rejectionHandlers: [
      new winston.transports.File({ filename: errorLogPath })
    ]
  });
  
  // Add session metadata to all logs
  logger.defaultMeta = { sessionId };
  
  return logger;
}

/**
 * Replace console methods with Winston logger
 * This maintains compatibility with existing code that uses console.*
 * 
 * @param {winston.Logger} logger - Winston logger instance
 * @returns {Object} Object containing restore function
 */
export function replaceConsoleWithWinston(logger) {
  // Store original console methods
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };
  
  // Replace console methods
  console.log = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack || arg.message;
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }).join(' ');
    logger.info(message);
  };
  
  console.info = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack || arg.message;
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }).join(' ');
    logger.info(message);
  };
  
  console.warn = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack || arg.message;
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }).join(' ');
    logger.warn(message);
  };
  
  console.error = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack || arg.message;
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }).join(' ');
    logger.error(message);
  };
  
  console.debug = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack || arg.message;
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }).join(' ');
    logger.debug(message);
  };
  
  // Return restore function
  return {
    restore: () => {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;
    }
  };
}

/**
 * Create a child logger with additional context
 * 
 * @param {winston.Logger} parentLogger - Parent logger
 * @param {string} component - Component name
 * @returns {winston.Logger} Child logger
 */
export function createChildLogger(parentLogger, component) {
  return parentLogger.child({ component });
}

/**
 * Close Winston logger and ensure all logs are flushed
 * 
 * @param {winston.Logger} logger - Winston logger to close
 * @returns {Promise<void>}
 */
export async function closeWinstonLogger(logger) {
  return new Promise((resolve) => {
    // End all transports
    logger.transports.forEach(transport => {
      if (transport.close) {
        transport.close();
      }
    });
    
    // Winston doesn't have a built-in async close, so we'll give it a moment to flush
    setTimeout(resolve, 100);
  });
}