/**
 * Order ID Generator - Creates compact order IDs that fit within exchange limits
 * 
 * Kraken's cl_ord_id field supports:
 * - Long UUID format: 32 hex chars with 4 dashes
 * - Short UUID format: 32 hex chars no dashes  
 * - Free text format: Up to 18 characters (ASCII)
 * 
 * We use the free text format for maximum flexibility.
 */

export class OrderIdGenerator {
  constructor() {
    // Use a counter to ensure uniqueness within the same millisecond
    this.counter = 0;
    this.lastTimestamp = 0;
  }

  /**
   * Generate a compact order ID for Kraken (max 18 chars)
   * Format: {shortSessionId}-{compactTimestamp}
   * 
   * @param {string} sessionId - Full session UUID
   * @returns {string} - Compact order ID (max 18 chars)
   */
  generateOrderId(sessionId) {
    // Take first 5 chars of session ID
    const shortSessionId = sessionId.substring(0, 5);
    
    // Get current timestamp
    const now = Date.now();
    
    // Convert timestamp to base36 for compactness (13 digits -> ~8 chars)
    const compactTimestamp = now.toString(36);
    
    // Handle counter for same millisecond orders
    if (now === this.lastTimestamp) {
      this.counter++;
    } else {
      this.counter = 0;
      this.lastTimestamp = now;
    }
    
    // Format: {5}-{8}{counter} = max 15 chars (well under 18 limit)
    const orderId = `${shortSessionId}-${compactTimestamp}${this.counter > 0 ? this.counter.toString(36) : ''}`;
    
    // Ensure we don't exceed 18 chars
    if (orderId.length > 18) {
      throw new Error(`Generated order ID exceeds 18 char limit: ${orderId} (${orderId.length} chars)`);
    }
    
    return orderId;
  }

  /**
   * Generate a take-profit order ID for Kraken (max 18 chars)
   * Format: tp{shortSessionId}{timestamp}
   * 
   * @param {string} parentOrderId - Parent order ID
   * @returns {string} - Compact TP order ID (max 18 chars)
   */
  generateTakeProfitOrderId(parentOrderId) {
    // Extract the short session ID from parent order
    const parts = parentOrderId.split('-');
    const shortSessionId = parts[0] || parentOrderId.substring(0, 5);
    
    // Get current timestamp in base36
    const now = Date.now();
    const compactTimestamp = now.toString(36);
    
    // Handle counter
    if (now === this.lastTimestamp) {
      this.counter++;
    } else {
      this.counter = 0;
      this.lastTimestamp = now;
    }
    
    // Format: tp{5}{8}{counter} = max 15 chars (well under 18 limit)
    const orderId = `tp${shortSessionId}${compactTimestamp}${this.counter > 0 ? this.counter.toString(36) : ''}`;
    
    // Ensure we don't exceed 18 chars
    if (orderId.length > 18) {
      throw new Error(`Generated TP order ID exceeds 18 char limit: ${orderId} (${orderId.length} chars)`);
    }
    
    return orderId;
  }

  /**
   * Generate a stop-loss order ID for Kraken (max 18 chars)
   * Format: sl{shortSessionId}{timestamp}
   * 
   * @param {string} parentOrderId - Parent order ID
   * @returns {string} - Compact stop-loss order ID (max 18 chars)
   */
  generateStopLossOrderId(parentOrderId) {
    // Extract the short session ID from parent order
    const parts = parentOrderId.split('-');
    const shortSessionId = parts[0] || parentOrderId.substring(0, 5);
    
    // Get current timestamp in base36
    const now = Date.now();
    const compactTimestamp = now.toString(36);
    
    // Handle counter
    if (now === this.lastTimestamp) {
      this.counter++;
    } else {
      this.counter = 0;
      this.lastTimestamp = now;
    }
    
    // Format: sl{5}{8}{counter} = max 15 chars (well under 18 limit)
    const orderId = `sl${shortSessionId}${compactTimestamp}${this.counter > 0 ? this.counter.toString(36) : ''}`;
    
    // Ensure we don't exceed 18 chars
    if (orderId.length > 18) {
      throw new Error(`Generated stop-loss order ID exceeds 18 char limit: ${orderId} (${orderId.length} chars)`);
    }
    
    return orderId;
  }

  /**
   * Generate a settlement order ID for Kraken (max 18 chars)
   * Format: st{shortSessionId}{timestamp}{positionSuffix}
   * 
   * @param {string} sessionId - Full session UUID
   * @param {string} positionId - Position ID to include as suffix
   * @returns {string} - Compact settlement order ID (max 18 chars)
   */
  generateSettlementOrderId(sessionId, positionId = '') {
    // Take first 5 chars of session ID
    const shortSessionId = sessionId.substring(0, 5);
    
    // Get current timestamp in base36
    const now = Date.now();
    const compactTimestamp = now.toString(36);
    
    // Handle counter
    if (now === this.lastTimestamp) {
      this.counter++;
    } else {
      this.counter = 0;
      this.lastTimestamp = now;
    }
    
    // Get position suffix (last 4 chars of position ID)
    const positionSuffix = positionId ? positionId.slice(-4) : '';
    
    // Format: st{5}{8}{counter}{4} = max 18 chars
    const baseId = `st${shortSessionId}${compactTimestamp}${this.counter > 0 ? this.counter.toString(36) : ''}`;
    const orderId = positionSuffix ? `${baseId}${positionSuffix}` : baseId;
    
    // Ensure we don't exceed 18 chars - truncate position suffix if needed
    if (orderId.length > 18) {
      const maxSuffixLength = 18 - baseId.length;
      const truncatedSuffix = positionSuffix.substring(0, maxSuffixLength);
      return `${baseId}${truncatedSuffix}`;
    }
    
    return orderId;
  }

  /**
   * Validate that an order ID fits within the limit
   * @param {string} orderId - Order ID to validate
   * @param {number} maxLength - Maximum allowed length (default 18 for Kraken free text)
   * @returns {boolean} - True if valid
   */
  validateOrderIdLength(orderId, maxLength = 18) {
    return orderId && orderId.length <= maxLength;
  }
  
  /**
   * Extract session prefix from order ID
   * @param {string} orderId - Order ID
   * @returns {string|null} - Session prefix or null
   */
  extractSessionPrefix(orderId) {
    if (!orderId) return null;
    
    // Handle take-profit orders
    if (orderId.startsWith('tp')) {
      return orderId.substring(2, 7); // Skip 'tp' prefix
    }
    
    // Handle regular orders
    const parts = orderId.split('-');
    return parts[0] || null;
  }
}

// Singleton instance
export const orderIdGenerator = new OrderIdGenerator();