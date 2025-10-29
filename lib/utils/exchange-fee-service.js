/**
 * Exchange Fee Service
 * 
 * Standardized module for fetching and formatting fee-related information
 * across multiple exchanges. Provides consistent interface for:
 * - Current fee tier and rates
 * - 30-day trading volume
 * - Progress to next fee tier
 * - Account balances by currency
 */

import { KrakenRESTClient } from '../../../lib/exchanges/KrakenRESTClient.js';

class ExchangeFeeService {
  constructor() {
    this.exchanges = {
      kraken: new KrakenFeeProvider(),
      // Future: binance: new BinanceFeeProvider(),
      // Future: coinbase: new CoinbaseFeeProvider(),
    };
  }

  /**
   * Get fee information for specified exchange
   * @param {string} exchange - Exchange name (e.g., 'kraken', 'binance')
   * @param {Object} credentials - API credentials for the exchange
   * @returns {Promise<FeeInfo>} Standardized fee information
   */
  async getFeeInfo(exchange, credentials) {
    const provider = this.exchanges[exchange.toLowerCase()];
    if (!provider) {
      throw new Error(`Exchange ${exchange} not supported`);
    }
    
    return await provider.getFeeInfo(credentials);
  }

  /**
   * Get list of supported exchanges
   */
  getSupportedExchanges() {
    return Object.keys(this.exchanges);
  }
}

/**
 * Base class for exchange-specific fee providers
 */
class BaseFeeProvider {
  /**
   * Get fee information from exchange
   * @param {Object} credentials - API credentials
   * @returns {Promise<FeeInfo>} Standardized fee information
   */
  async getFeeInfo(credentials) {
    throw new Error('getFeeInfo must be implemented by subclass');
  }

  /**
   * Standard fee info structure
   */
  createFeeInfo() {
    return {
      exchange: null,
      timestamp: new Date().toISOString(),
      currentTier: {
        name: null,
        level: null,
        makerFee: null,
        takerFee: null,
        requirements: {
          volume30d: null,
          balance: null
        }
      },
      actualVolume: {
        volume30d: null,
        volumeUSD: null,
        lastUpdated: null
      },
      nextTier: {
        name: null,
        level: null,
        makerFee: null,
        takerFee: null,
        requirements: {
          volume30d: null,
          balance: null
        },
        progress: {
          volumeNeeded: null,
          percentComplete: null,
          daysRemaining: null
        }
      },
      balances: {
        USD: null,
        EUR: null,
        BTC: null,
        ETH: null,
        // Add more as needed
      },
      accountInfo: {
        accountId: null,
        accountType: null,
        verified: null,
        created: null
      }
    };
  }
}

/**
 * Kraken-specific fee provider
 */
class KrakenFeeProvider extends BaseFeeProvider {
  constructor() {
    super();
    // We'll use KrakenRESTClient's fee tiers and getCurrentFees method
  }

  async getFeeInfo(credentials) {
    const feeInfo = this.createFeeInfo();
    feeInfo.exchange = 'kraken';

    try {
      // Initialize Kraken client
      const client = new KrakenRESTClient({
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        otp: credentials.otp
      });

      // Get account balance
      const balances = await this.getAccountBalances(client);
      feeInfo.balances = balances;

      // Use KrakenRESTClient's getCurrentFees method which returns all fee data
      const currentFeesData = await client.getCurrentFees();
      
      // Map the getCurrentFees response to our standard format
      // Find the tier index from the tiers array
      const feeTiers = KrakenRESTClient.KRAKEN_FEE_TIERS;
      const currentTierIndex = feeTiers.findIndex(tier => 
        tier.volume === currentFeesData.currentTier.volume
      );
      
      feeInfo.currentTier = {
        name: currentFeesData.currentTier.description || `Volume ${currentFeesData.currentTier.volume}+`,
        level: currentTierIndex >= 0 ? currentTierIndex : 0,
        makerFee: currentFeesData.maker,
        takerFee: currentFeesData.taker,
        requirements: {
          volume30d: currentFeesData.currentTier.volume,
          balance: null // Kraken doesn't have balance requirements
        }
      };

      feeInfo.actualVolume = {
        volume30d: currentFeesData.volume,
        volumeUSD: currentFeesData.volume, // Kraken returns in USD
        lastUpdated: new Date().toISOString()
      };

      if (currentFeesData.nextTier) {
        const nextTierIndex = currentTierIndex + 1;
        const volumeToNextTier = currentFeesData.nextTier.volumeToReach || 0;
        const percentComplete = currentFeesData.volume > 0 ? 
          (currentFeesData.volume / currentFeesData.nextTier.volume) * 100 : 0;
        
        feeInfo.nextTier = {
          name: currentFeesData.nextTier.description || `Volume ${currentFeesData.nextTier.volume}+`,
          level: nextTierIndex,
          makerFee: currentFeesData.nextTier.maker,
          takerFee: currentFeesData.nextTier.taker,
          requirements: {
            volume30d: currentFeesData.nextTier.volume,
            balance: null
          },
          progress: {
            volumeNeeded: Math.max(0, volumeToNextTier),
            percentComplete: Math.min(100, percentComplete),
            daysRemaining: 30 // Rolling 30-day window
          }
        };
      }

      // Get account info if available
      const accountInfo = await this.getAccountInfo(client);
      feeInfo.accountInfo = accountInfo;

      return feeInfo;

    } catch (error) {
      console.error('Failed to fetch Kraken fee info:', error);
      throw new Error(`Kraken fee fetch failed: ${error.message}`);
    }
  }

  async getAccountBalances(client) {
    try {
      const balance = await client.getAccountBalance();
      
      // Extract common currencies
      return {
        USD: parseFloat(balance.ZUSD || balance.USD || 0),
        EUR: parseFloat(balance.ZEUR || balance.EUR || 0),
        BTC: parseFloat(balance.XXBT || balance.XBT || 0),
        ETH: parseFloat(balance.XETH || balance.ETH || 0),
        // Add more as needed, preserving full balance object
        _raw: balance
      };
    } catch (error) {
      console.error('Failed to fetch balances:', error);
      return this.createFeeInfo().balances;
    }
  }

  async getAccountInfo(client) {
    try {
      // This would need to be implemented in KrakenRestClient
      // For now, return basic info
      return {
        accountId: 'kraken_account',
        accountType: 'individual',
        verified: true,
        created: null
      };
    } catch (error) {
      return null;
    }
  }
}

/**
 * Example Binance fee provider (for future implementation)
 */
class BinanceFeeProvider extends BaseFeeProvider {
  constructor() {
    super();
    // Binance fee tiers would go here
    this.feeTiers = [
      { level: 0, name: 'Regular', volume: 0, maker: 0.0010, taker: 0.0010 },
      // Add more tiers...
    ];
  }

  async getFeeInfo(credentials) {
    // Implement Binance-specific logic
    throw new Error('Binance fee provider not yet implemented');
  }
}

// Create singleton instance
const exchangeFeeService = new ExchangeFeeService();

// Export both the service and the class for testing
export { exchangeFeeService, ExchangeFeeService };

/**
 * TypeScript-style type definitions for reference
 * 
 * @typedef {Object} FeeInfo
 * @property {string} exchange - Exchange name
 * @property {string} timestamp - ISO timestamp
 * @property {TierInfo} currentTier - Current fee tier information
 * @property {VolumeInfo} actualVolume - Actual trading volume
 * @property {TierInfo|null} nextTier - Next tier information (null if at highest)
 * @property {Object.<string, number>} balances - Account balances by currency
 * @property {AccountInfo|null} accountInfo - Additional account information
 * 
 * @typedef {Object} TierInfo
 * @property {string} name - Tier name
 * @property {number} level - Tier level (0-based)
 * @property {number} makerFee - Maker fee rate (decimal)
 * @property {number} takerFee - Taker fee rate (decimal)
 * @property {TierRequirements} requirements - Requirements for this tier
 * @property {TierProgress} [progress] - Progress to this tier (only for nextTier)
 * 
 * @typedef {Object} TierRequirements
 * @property {number} volume30d - Required 30-day volume in USD
 * @property {number|null} balance - Required balance (if applicable)
 * 
 * @typedef {Object} TierProgress
 * @property {number} volumeNeeded - Additional volume needed
 * @property {number} percentComplete - Percentage complete (0-100)
 * @property {number} daysRemaining - Days remaining in period
 * 
 * @typedef {Object} VolumeInfo
 * @property {number} volume30d - 30-day trading volume
 * @property {number} volumeUSD - Volume in USD
 * @property {string} lastUpdated - ISO timestamp of last update
 * 
 * @typedef {Object} AccountInfo
 * @property {string} accountId - Account identifier
 * @property {string} accountType - Account type
 * @property {boolean} verified - Verification status
 * @property {string|null} created - Account creation date
 */