/**
 * Logger utility for Market Maker
 */

import winston from 'winston';

export function createLogger(component) {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
    ),
    defaultMeta: { component },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ]
  });
}