/**
 * BacktestClock
 *
 * Time abstraction that allows code to work in both real-time and simulation modes.
 * In real-time mode, returns system time. In simulation mode, returns simulated time
 * that can be advanced manually.
 *
 * Based on Hummingbot's clock.pyx implementation
 * Reference: hummingbot/core/clock.pyx
 */

const CLOCK_MODE_REALTIME = 'realtime';
const CLOCK_MODE_SIMULATION = 'simulation';

class BacktestClock {
  constructor(mode = CLOCK_MODE_REALTIME) {
    this.mode = mode;
    this.simulatedTime = null;
    this.listeners = [];
    this.tickInterval = 2000; // 2 seconds default (matches production)
    this.lastTickTime = null;
  }

  /**
   * Get current time in milliseconds
   * @returns {number} Current timestamp
   */
  now() {
    if (this.mode === CLOCK_MODE_SIMULATION) {
      return this.simulatedTime || Date.now();
    }
    return Date.now();
  }

  /**
   * Get current time as Date object
   * @returns {Date} Current date
   */
  getDate() {
    return new Date(this.now());
  }

  /**
   * Advance simulated time by milliseconds
   * @param {number} milliseconds - Milliseconds to advance
   */
  advance(milliseconds) {
    if (this.mode !== CLOCK_MODE_SIMULATION) {
      throw new Error('Cannot advance time in realtime mode');
    }

    if (this.simulatedTime === null) {
      this.simulatedTime = Date.now();
    }

    this.simulatedTime += milliseconds;

    // Trigger tick listeners if we've crossed a tick interval
    this.checkAndTriggerTick();
  }

  /**
   * Set simulated time to specific timestamp
   * @param {number} timestamp - Timestamp in milliseconds
   */
  setTime(timestamp) {
    if (this.mode !== CLOCK_MODE_SIMULATION) {
      throw new Error('Cannot set time in realtime mode');
    }

    this.simulatedTime = timestamp;
    this.lastTickTime = timestamp;
  }

  /**
   * Check if we should trigger a tick event
   */
  checkAndTriggerTick() {
    if (this.lastTickTime === null) {
      this.lastTickTime = this.now();
      return;
    }

    const currentTime = this.now();
    const elapsed = currentTime - this.lastTickTime;

    if (elapsed >= this.tickInterval) {
      this.triggerTick(currentTime);
      this.lastTickTime = currentTime;
    }
  }

  /**
   * Trigger tick event to all listeners
   * @param {number} timestamp - Current timestamp
   */
  triggerTick(timestamp) {
    for (const listener of this.listeners) {
      try {
        listener(timestamp);
      } catch (error) {
        console.error('Error in tick listener:', error);
      }
    }
  }

  /**
   * Register a tick listener
   * @param {Function} callback - Callback function to call on each tick
   * @returns {Function} Unsubscribe function
   */
  onTick(callback) {
    this.listeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Remove all tick listeners
   */
  clearListeners() {
    this.listeners = [];
  }

  /**
   * Set tick interval
   * @param {number} milliseconds - Tick interval in milliseconds
   */
  setTickInterval(milliseconds) {
    this.tickInterval = milliseconds;
  }

  /**
   * Get tick interval
   * @returns {number} Tick interval in milliseconds
   */
  getTickInterval() {
    return this.tickInterval;
  }

  /**
   * Check if clock is in simulation mode
   * @returns {boolean} True if in simulation mode
   */
  isSimulation() {
    return this.mode === CLOCK_MODE_SIMULATION;
  }

  /**
   * Check if clock is in realtime mode
   * @returns {boolean} True if in realtime mode
   */
  isRealtime() {
    return this.mode === CLOCK_MODE_REALTIME;
  }

  /**
   * Sleep for specified milliseconds
   * In simulation mode, advances time. In realtime mode, actually sleeps.
   * @param {number} milliseconds - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  async sleep(milliseconds) {
    if (this.mode === CLOCK_MODE_SIMULATION) {
      this.advance(milliseconds);
      return Promise.resolve();
    } else {
      return new Promise(resolve => setTimeout(resolve, milliseconds));
    }
  }

  /**
   * Create a timer that fires after specified milliseconds
   * @param {number} milliseconds - Milliseconds until timer fires
   * @param {Function} callback - Callback to execute
   * @returns {Object} Timer object with cancel method
   */
  setTimeout(milliseconds, callback) {
    if (this.mode === CLOCK_MODE_SIMULATION) {
      const targetTime = this.now() + milliseconds;

      const checkTimer = () => {
        if (this.now() >= targetTime) {
          callback();
          return true;
        }
        return false;
      };

      // Add to listeners temporarily
      const unsubscribe = this.onTick(() => {
        if (checkTimer()) {
          unsubscribe();
        }
      });

      return { cancel: unsubscribe };
    } else {
      const timerId = setTimeout(callback, milliseconds);
      return { cancel: () => clearTimeout(timerId) };
    }
  }

  /**
   * Create a repeating timer
   * @param {number} milliseconds - Interval in milliseconds
   * @param {Function} callback - Callback to execute
   * @returns {Object} Timer object with cancel method
   */
  setInterval(milliseconds, callback) {
    if (this.mode === CLOCK_MODE_SIMULATION) {
      let lastTrigger = this.now();

      const checkInterval = () => {
        const currentTime = this.now();
        if (currentTime - lastTrigger >= milliseconds) {
          callback();
          lastTrigger = currentTime;
        }
      };

      const unsubscribe = this.onTick(checkInterval);
      return { cancel: unsubscribe };
    } else {
      const intervalId = setInterval(callback, milliseconds);
      return { cancel: () => clearInterval(intervalId) };
    }
  }

  /**
   * Get elapsed time since timestamp
   * @param {number} timestamp - Starting timestamp
   * @returns {number} Elapsed time in milliseconds
   */
  elapsed(timestamp) {
    return this.now() - timestamp;
  }

  /**
   * Format current time as ISO string
   * @returns {string} ISO formatted time
   */
  toISOString() {
    return this.getDate().toISOString();
  }

  /**
   * Reset clock to initial state
   */
  reset() {
    this.simulatedTime = null;
    this.lastTickTime = null;
    this.clearListeners();
  }

  /**
   * Get clock statistics
   * @returns {Object} Clock statistics
   */
  getStats() {
    return {
      mode: this.mode,
      currentTime: this.now(),
      simulatedTime: this.simulatedTime,
      tickInterval: this.tickInterval,
      listenerCount: this.listeners.length,
      isSimulation: this.isSimulation()
    };
  }
}

/**
 * Global clock instance (singleton)
 */
let globalClock = null;

/**
 * Get or create global clock instance
 * @param {string} mode - Clock mode ('realtime' or 'simulation')
 * @returns {BacktestClock} Global clock instance
 */
function getGlobalClock(mode = CLOCK_MODE_REALTIME) {
  if (!globalClock) {
    globalClock = new BacktestClock(mode);
  }
  return globalClock;
}

/**
 * Reset global clock instance
 */
function resetGlobalClock() {
  if (globalClock) {
    globalClock.reset();
  }
  globalClock = null;
}

/**
 * Set global clock mode
 * @param {string} mode - Clock mode ('realtime' or 'simulation')
 */
function setGlobalClockMode(mode) {
  if (globalClock) {
    throw new Error('Cannot change mode of existing clock. Reset first.');
  }
  globalClock = new BacktestClock(mode);
  return globalClock;
}

export {
  BacktestClock,
  CLOCK_MODE_REALTIME,
  CLOCK_MODE_SIMULATION,
  getGlobalClock,
  resetGlobalClock,
  setGlobalClockMode
};
