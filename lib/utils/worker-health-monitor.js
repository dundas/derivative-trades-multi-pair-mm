/**
 * Worker Health Monitor for Azure Container Apps
 * 
 * This module provides comprehensive health monitoring and self-healing capabilities
 * for market maker workers running in Azure Container Apps.
 */

import { serviceLogger } from './logger-factory.js';
import { RedisAdapter } from '../../../lib/utils/redis-adapter.js';

const logger = serviceLogger.createChild('WorkerHealthMonitor');

export class WorkerHealthMonitor {
  constructor(options = {}) {
    this.workerId = options.workerId || process.env.HOSTNAME || `worker-${Date.now()}`;
    this.redisUrl = options.redisUrl || process.env.UPSTASH_REDIS_URL;
    this.redisToken = options.redisToken || process.env.UPSTASH_REDIS_TOKEN;
    this.heartbeatInterval = options.heartbeatInterval || 30000; // 30 seconds
    this.stuckThreshold = options.stuckThreshold || 300000; // 5 minutes
    this.sessionTimeoutThreshold = options.sessionTimeoutThreshold || 3600000; // 1 hour
    this.workerTTL = options.workerTTL || parseInt(process.env.WORKER_TTL) || 120; // 2 minutes default
    
    this.isHealthy = true;
    this.lastProgressUpdate = Date.now();
    this.currentSession = null;
    this.sessionStartTime = null;
    this.heartbeatTimer = null;
    this.monitoringTimer = null;
    this.sessionEnded = false; // Track if endSession has been called
    
    // WebSocket connection tracking
    this.wsConnectionStatus = {
      public: false,
      private: false,
      lastPublicMessage: null,
      lastPrivateMessage: null
    };
    
    // Session progress tracking
    this.sessionProgress = {
      ordersPlaced: 0,
      ordersFilled: 0,
      lastOrderTime: null,
      lastActivityTime: Date.now()
    };
  }

  async initialize() {
    try {
      // Initialize Redis client
      if (this.redisUrl && this.redisToken) {
        this.redis = new RedisAdapter({
          url: this.redisUrl,
          token: this.redisToken
        });
        
        // Test connection
        const testKey = `test:worker-health:${Date.now()}`;
        await this.redis.set(testKey, 'test');
        await this.redis.del(testKey);
        
        logger.info(`Worker health monitor initialized for ${this.workerId}`);
        
        // Register worker
        await this.registerWorker();
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Start self-monitoring
        this.startSelfMonitoring();
      } else {
        logger.warn('Redis credentials not provided, health monitoring limited');
      }
    } catch (error) {
      logger.error('Failed to initialize health monitor:', error);
    }
  }

  async registerWorker() {
    const workerInfo = {
      id: this.workerId,
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      status: 'idle',
      activeSession: null,
      health: {
        isHealthy: true,
        lastCheck: Date.now(),
        wsConnections: this.wsConnectionStatus,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
    
    await this.redis.set(`worker:${this.workerId}`, JSON.stringify(workerInfo));
    await this.redis.expire(`worker:${this.workerId}`, this.workerTTL);
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      try {
        const memoryUsage = process.memoryUsage();
        const workerInfo = {
          id: this.workerId,
          lastHeartbeat: Date.now(),
          status: this.currentSession ? 'processing' : 'idle',
          activeSession: this.currentSession,
          health: {
            isHealthy: this.isHealthy,
            lastCheck: Date.now(),
            wsConnections: this.wsConnectionStatus,
            memoryUsage: {
              rss: memoryUsage.rss,
              heapTotal: memoryUsage.heapTotal,
              heapUsed: memoryUsage.heapUsed,
              external: memoryUsage.external
            },
            uptime: process.uptime(),
            sessionProgress: this.currentSession ? this.sessionProgress : null
          }
        };
        
        await this.redis.set(`worker:${this.workerId}`, JSON.stringify(workerInfo));
        await this.redis.expire(`worker:${this.workerId}`, this.workerTTL);
        
        // Also update session heartbeat if processing
        if (this.currentSession) {
          await this.redis.set(
            `session:${this.currentSession}:heartbeat`, 
            Date.now().toString()
          );
          await this.redis.expire(`session:${this.currentSession}:heartbeat`, 300); // 5 minutes
        }
      } catch (error) {
        logger.error('Heartbeat failed:', error);
      }
    }, this.heartbeatInterval);
  }

  startSelfMonitoring() {
    this.monitoringTimer = setInterval(() => {
      this.performHealthCheck();
    }, 60000); // Check every minute
  }

  performHealthCheck() {
    const now = Date.now();
    let isHealthy = true;
    const issues = [];

    // Check if we're stuck (no progress in session)
    if (this.currentSession) {
      const timeSinceProgress = now - this.sessionProgress.lastActivityTime;
      const sessionDuration = now - this.sessionStartTime;
      
      // Check for stuck session
      if (timeSinceProgress > this.stuckThreshold) {
        issues.push(`No progress for ${Math.round(timeSinceProgress / 1000)}s`);
        isHealthy = false;
      }
      
      // Check for session timeout
      if (sessionDuration > this.sessionTimeoutThreshold) {
        issues.push(`Session running for ${Math.round(sessionDuration / 60000)} minutes`);
        isHealthy = false;
      }
      
      // Check WebSocket connections
      // DISABLED: WebSocket status not properly updated by market maker, causing false positives
      // TODO: Implement proper WebSocket status tracking
      // if (!this.wsConnectionStatus.public || !this.wsConnectionStatus.private) {
      //   issues.push('WebSocket disconnected');
      //   isHealthy = false;
      // }
      
      // Check WebSocket message timestamps
      if (this.wsConnectionStatus.lastPublicMessage) {
        const wsSilence = now - this.wsConnectionStatus.lastPublicMessage;
        if (wsSilence > 120000) { // 2 minutes
          issues.push(`No WebSocket messages for ${Math.round(wsSilence / 1000)}s`);
          isHealthy = false;
        }
      }
    }
    
    // Check memory usage
    const memoryUsage = process.memoryUsage();
    const heapUsedPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    if (heapUsedPercent > 90) {
      issues.push(`High memory usage: ${heapUsedPercent.toFixed(1)}%`);
      isHealthy = false;
    }
    
    this.isHealthy = isHealthy;
    
    if (!isHealthy) {
      logger.error(`Health check failed for ${this.workerId}:`, issues);
      this.handleUnhealthy(issues);
    }
  }

  async handleUnhealthy(issues) {
    try {
      // Log the health issues
      logger.error(`Worker ${this.workerId} unhealthy:`, { issues, session: this.currentSession });
      
      // Update worker status
      await this.redis.set(`worker:${this.workerId}:unhealthy`, JSON.stringify({
        timestamp: Date.now(),
        issues,
        session: this.currentSession
      }));
      
      // If we have a stuck session, try to recover
      if (this.currentSession && issues.some(i => i.includes('No progress') || i.includes('WebSocket'))) {
        logger.warn(`Attempting to recover stuck session ${this.currentSession}`);
        
        // Return session to queue
        await this.returnSessionToQueue(this.currentSession);
        
        // Trigger graceful restart
        this.triggerRestart('Health check failed - worker stuck');
      }
    } catch (error) {
      logger.error('Failed to handle unhealthy state:', error);
      // Force restart if we can't handle it gracefully
      this.triggerRestart('Critical health check failure');
    }
  }

  async returnSessionToQueue(sessionId) {
    try {
      // Add session back to queue
      await this.redis.lpush('session:queue', sessionId);
      
      // Update session status
      const sessionKey = `session:${sessionId}`;
      const sessionData = await this.redis.get(sessionKey);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        session.status = 'queued';
        session.workerId = null;
        session.error = 'Worker health check failed - session returned to queue';
        await this.redis.set(sessionKey, JSON.stringify(session));
      }
      
      logger.info(`Session ${sessionId} returned to queue due to worker health issues`);
    } catch (error) {
      logger.error(`Failed to return session ${sessionId} to queue:`, error);
    }
  }

  triggerRestart(reason) {
    logger.error(`Triggering worker restart: ${reason}`);
    
    // In Azure Container Apps, exiting with non-zero code will trigger a restart
    setTimeout(() => {
      process.exit(1);
    }, 5000); // Give 5 seconds for cleanup
  }

  // Called when starting a new session
  startSession(sessionId) {
    this.currentSession = sessionId;
    this.sessionStartTime = Date.now();
    this.sessionEnded = false; // Reset the flag when starting a new session
    this.sessionProgress = {
      ordersPlaced: 0,
      ordersFilled: 0,
      lastOrderTime: null,
      lastActivityTime: Date.now()
    };
    logger.info(`Health monitor tracking session ${sessionId}`);
  }

  // Called when session ends
  endSession() {
    // Prevent redundant endSession calls
    if (this.sessionEnded) {
      logger.warn(`endSession() called multiple times for session ${this.currentSession} - ignoring`);
      return;
    }
    
    logger.info(`Health monitor stopped tracking session ${this.currentSession}`);
    this.sessionEnded = true; // Mark session as ended
    this.currentSession = null;
    this.sessionStartTime = null;
    this.sessionProgress = {
      ordersPlaced: 0,
      ordersFilled: 0,
      lastOrderTime: null,
      lastActivityTime: Date.now()
    };
  }

  // Check if session has already ended
  isSessionEnded() {
    return this.sessionEnded;
  }

  // Update WebSocket connection status
  updateWebSocketStatus(type, connected, lastMessageTime = null) {
    this.wsConnectionStatus[type] = connected;
    if (lastMessageTime) {
      this.wsConnectionStatus[`last${type.charAt(0).toUpperCase() + type.slice(1)}Message`] = lastMessageTime;
    }
    this.sessionProgress.lastActivityTime = Date.now();
  }

  // Update session progress
  updateProgress(event, data = {}) {
    this.sessionProgress.lastActivityTime = Date.now();
    
    switch (event) {
      case 'orderPlaced':
        this.sessionProgress.ordersPlaced++;
        this.sessionProgress.lastOrderTime = Date.now();
        break;
      case 'orderFilled':
        this.sessionProgress.ordersFilled++;
        break;
      case 'marketData':
        // Just update activity time
        break;
    }
    
    logger.debug(`Progress update: ${event}`, { session: this.currentSession, ...data });
  }

  // Cleanup
  async cleanup() {
    logger.info('Cleaning up health monitor');
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
    
    if (this.redis) {
      try {
        await this.redis.del(`worker:${this.workerId}`);
        // RedisAdapter doesn't need explicit disconnect
      } catch (error) {
        logger.error('Cleanup error:', error);
      }
    }
  }
}

// Export singleton instance
export const workerHealthMonitor = new WorkerHealthMonitor();