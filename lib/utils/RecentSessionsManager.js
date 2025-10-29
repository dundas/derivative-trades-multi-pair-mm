/**
 * RecentSessionsManager - Efficient session tracking using Redis sorted sets
 * 
 * This utility replaces expensive Redis KEYS operations with efficient sorted set lookups
 * for active session discovery in the settlement service.
 */

export class RecentSessionsManager {
  constructor(redis, logger = null) {
    this.redis = redis;
    this.logger = logger;
    this.activeSessionsKey = 'recent_sessions:active';
    this.ttlSeconds = 7200; // 2 hours
  }

  /**
   * Add a session to the active sessions tracking
   * @param {string} sessionId - Session ID to add
   * @param {Object} sessionMetadata - Session metadata (strategy, exchange, symbol, etc.)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async addSession(sessionId, sessionMetadata = {}) {
    try {
      // Use current timestamp as the score for chronological ordering
      const score = Date.now();
      
      // Create session object with required metadata
      const sessionData = {
        sessionId,
        startTimestamp: score,
        status: 'active',
        ...sessionMetadata,
        lastUpdated: score
      };
      
      // Store the full session object as JSON string in the sorted set
      const sessionDataStr = JSON.stringify(sessionData);
      const result = await this.redis.zadd(this.activeSessionsKey, score, sessionDataStr);
      
      // Set expiry on the sorted set
      await this.redis.expire(this.activeSessionsKey, this.ttlSeconds);
      
      this.logger?.info(`Added session ${sessionId} to active sessions`);
      
      return { success: true };
    } catch (error) {
      this.logger?.error(`Failed to add session ${sessionId} to active sessions:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove a session from active sessions tracking
   * @param {string} sessionId - Session ID to remove
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async removeSession(sessionId) {
    try {
      // We need to find and remove the session object by sessionId
      const allSessions = await this.redis.zrange(this.activeSessionsKey, 0, -1);
      
      let removedCount = 0;
      for (const sessionDataStr of allSessions) {
        try {
          const sessionData = JSON.parse(sessionDataStr);
          if (sessionData.sessionId === sessionId) {
            await this.redis.zrem(this.activeSessionsKey, sessionDataStr);
            removedCount++;
          }
        } catch (parseError) {
          this.logger?.warn(`Failed to parse session data during removal: ${parseError.message}`);
        }
      }
      
      this.logger?.info(`Removed session ${sessionId} from active sessions (removed: ${removedCount})`);
      
      return { success: true, removed: removedCount > 0 };
    } catch (error) {
      this.logger?.error(`Failed to remove session ${sessionId} from active sessions:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get active session IDs efficiently
   * @returns {Promise<{success: boolean, sessionIds?: Array<string>, count?: number, error?: string}>}
   */
  async getActiveSessionIds() {
    try {
      // Get all session data and extract IDs
      const sessionDataList = await this.redis.zrevrange(this.activeSessionsKey, 0, -1);
      const sessionIds = [];
      
      for (const sessionDataStr of sessionDataList) {
        try {
          const sessionData = JSON.parse(sessionDataStr);
          sessionIds.push(sessionData.sessionId);
        } catch (parseError) {
          this.logger?.warn(`Failed to parse session data: ${parseError.message}`);
        }
      }
      
      return {
        success: true,
        sessionIds,
        count: sessionIds.length
      };
    } catch (error) {
      this.logger?.error(`Failed to get active session IDs:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all active sessions (with optional time window filtering for backward compatibility)
   * @param {number} [minutesBack] - Optional: How many minutes back to look for active sessions (for backward compatibility)
   * @returns {Promise<{success: boolean, sessions?: Array, count?: number, error?: string}>}
   */
  async getActiveSessions(minutesBack = null) {
    try {
      let sessionDataList;
      
      if (minutesBack !== null) {
        // Filter by time window for backward compatibility
        const cutoffTime = Date.now() - (minutesBack * 60 * 1000);
        sessionDataList = await this.redis.zrangebyscore(this.activeSessionsKey, cutoffTime, '+inf');
      } else {
        // Get all session data from the sorted set
        sessionDataList = await this.redis.zrevrange(this.activeSessionsKey, 0, -1);
      }

      const sessions = [];
      
      if (Array.isArray(sessionDataList)) {
        for (const sessionDataStr of sessionDataList) {
          try {
            const sessionData = JSON.parse(sessionDataStr);
            sessions.push(sessionData);
          } catch (parseError) {
            this.logger?.warn(`Failed to parse session data: ${parseError.message}`);
          }
        }
      }

      return {
        success: true,
        sessions,
        count: sessions.length
      };
    } catch (error) {
      this.logger?.error(`Failed to get active sessions:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update session metadata (for status changes, etc.)
   * @param {string} sessionId - Session ID to update
   * @param {Object} updates - Updates to apply to session metadata
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateSession(sessionId, updates) {
    try {
      // Get all sessions and find the one to update
      const allSessions = await this.redis.zrange(this.activeSessionsKey, 0, -1, true);
      
      for (let i = 0; i < allSessions.length; i += 2) {
        const sessionDataStr = allSessions[i];
        const score = allSessions[i + 1];
        
        try {
          const sessionData = JSON.parse(sessionDataStr);
          if (sessionData.sessionId === sessionId) {
            // Update the session data
            const updatedSessionData = {
              ...sessionData,
              ...updates,
              lastUpdated: Date.now()
            };

            // Remove old entry and add updated one
            await this.redis.zrem(this.activeSessionsKey, sessionDataStr);
            await this.redis.zadd(this.activeSessionsKey, score, JSON.stringify(updatedSessionData));
            
            this.logger?.info(`Updated session ${sessionId} with updates:`, updates);
            return { success: true };
          }
        } catch (parseError) {
          this.logger?.warn(`Failed to parse session data during update: ${parseError.message}`);
        }
      }

      this.logger?.warn(`Session ${sessionId} not found for update`);
      return { success: false, error: 'Session not found' };
    } catch (error) {
      this.logger?.error(`Failed to update session ${sessionId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Convenience method to set the settleSession flag for a session
   * @param {string} sessionId - Session ID to update
   * @param {boolean} needsSettlement - Whether session needs settlement
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async setSettlementFlag(sessionId, needsSettlement = true) {
    return this.updateSession(sessionId, { settleSession: needsSettlement });
  }

  /**
   * Mark a session as completed and remove it from active sessions
   * @param {string} sessionId - Session ID to mark as completed
   * @param {string} endReason - Reason for completion
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async markSessionCompleted(sessionId, endReason = 'completed') {
    try {
      // Update session status first, then remove after a delay
      const updateResult = await this.updateSession(sessionId, {
        status: 'complete',
        endReason,
        completedAt: Date.now()
      });

      if (updateResult.success) {
        this.logger?.info(`Session ${sessionId} marked as completed with reason: ${endReason}`);
        
        // Remove from active sessions after a short delay to allow settlement processing
        setTimeout(async () => {
          await this.removeSession(sessionId);
        }, 5000); // 5 second delay
      }
      
      return updateResult;
    } catch (error) {
      this.logger?.error(`Failed to mark session ${sessionId} as completed:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark a session as failed and remove it from active sessions
   * @param {string} sessionId - Session ID to mark as failed
   * @param {string} failureReason - Reason for failure
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async markSessionFailed(sessionId, failureReason = 'unknown_error') {
    try {
      // Update session status first, then remove after a delay
      const updateResult = await this.updateSession(sessionId, {
        status: 'failed',
        failureReason,
        failedAt: Date.now()
      });

      if (updateResult.success) {
        this.logger?.info(`Session ${sessionId} marked as failed with reason: ${failureReason}`);
        
        // Remove from active sessions after a short delay to allow error processing
        setTimeout(async () => {
          await this.removeSession(sessionId);
        }, 10000); // 10 second delay for failures
      }
      
      return updateResult;
    } catch (error) {
      this.logger?.error(`Failed to mark session ${sessionId} as failed:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up old sessions from the active tracking (for maintenance)
   * @param {number} maxAgeHours - Maximum age in hours for sessions to keep
   * @returns {Promise<{success: boolean, removedCount?: number, error?: string}>}
   */
  async cleanupOldSessions(maxAgeHours = 24) {
    try {
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      
      // Remove sessions older than cutoff time
      const removedCount = await this.redis.zremrangebyscore(this.activeSessionsKey, 0, cutoffTime);
      
      this.logger?.info(`Cleaned up ${removedCount} old sessions from active tracking`);
      
      return { success: true, removedCount };
    } catch (error) {
      this.logger?.error(`Failed to cleanup old sessions:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get statistics about active sessions
   * @returns {Promise<{success: boolean, stats?: Object, error?: string}>}
   */
  async getStats() {
    try {
      const totalCount = await this.redis.zcard(this.activeSessionsKey);
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      
      // Get recent sessions count (last hour)
      const recentSessionData = await this.redis.zrangebyscore(this.activeSessionsKey, oneHourAgo, '+inf');
      const recentCount = Array.isArray(recentSessionData) ? recentSessionData.length : 0;

      return {
        success: true,
        stats: {
          totalActiveSessions: totalCount,
          recentSessions: recentCount,
          lastUpdated: Date.now()
        }
      };
    } catch (error) {
      this.logger?.error(`Failed to get stats:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear all active sessions (for testing/maintenance)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async clearAll() {
    try {
      const result = await this.redis.del(this.activeSessionsKey);
      
      this.logger?.info(`Cleared all active sessions from tracking`);
      
      return { success: true, cleared: result > 0 };
    } catch (error) {
      this.logger?.error(`Failed to clear all active sessions:`, error);
      return { success: false, error: error.message };
    }
  }
} 