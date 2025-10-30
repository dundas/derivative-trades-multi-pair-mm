/**
 * Comprehensive Balance Validator
 * 
 * Provides robust balance validation that checks all possible asset variants
 * including futures (.F), prefixed (X/Z), and other exchange-specific formats.
 * 
 * This addresses the "insufficient funds" issue where take-profit orders fail
 * because the system only checks standard asset names (SOL) but the actual
 * balance is in futures format (SOL.F).
 */

import { LoggerFactory } from '../../../../utils/logger-factory.js';

// Helper to maintain backwards compatibility with createLogger function
const createLogger = (component) => LoggerFactory.createLogger({ component });

export class ComprehensiveBalanceValidator {
  constructor(exchangeAdapter, config = {}) {
    this.exchangeAdapter = exchangeAdapter;
    this.logger = config.logger || createLogger('ComprehensiveBalanceValidator');
    
    // Asset variant mapping for comprehensive balance checking
    this.assetVariants = {
      'SOL': ['SOL', 'SOL.F', 'SOLM22', 'SOLUSD', 'XSOL'],
      'ETH': ['ETH', 'XETH', 'ETH.F', 'ETHM22', 'ETHEREUM'],
      'BTC': ['BTC', 'XXBT', 'BTC.F', 'BTCM22', 'BITCOIN'],
      'USD': ['USD', 'ZUSD', 'USD.F', 'USDM22', 'USDT', 'USDC'],
      'EUR': ['EUR', 'ZEUR', 'EUR.F', 'EURM22'],
      'XRP': ['XRP', 'XXRP', 'XRP.F', 'XRPM22'],
      'ADA': ['ADA', 'ADA.F', 'ADAM22'],
      'DOT': ['DOT', 'DOT.F', 'DOTM22'],
      'UNI': ['UNI', 'UNI.F', 'UNIM22'],
      'LINK': ['LINK', 'LINK.F', 'LINKM22'],
      'AVAX': ['AVAX', 'AVAX.F', 'AVAXM22'],
      'ATOM': ['ATOM', 'ATOM.F', 'ATOMM22'],
      'DOGE': ['DOGE', 'XXDG', 'XDG', 'DOGE.F', 'DOGEM22'],
      'MATIC': ['MATIC', 'MATIC.F', 'MATICM22'],
      'LTC': ['LTC', 'XLTC', 'LTC.F', 'LTCM22'],
      'BCH': ['BCH', 'BCH.F', 'BCHM22'],
      'ALGO': ['ALGO', 'ALGO.F', 'ALGOM22'],
      'XLM': ['XLM', 'XXLM', 'XLM.F', 'XLMM22']
    };
    
    this.config = {
      minimumValidationThreshold: config.minimumValidationThreshold || 0.000001,
      cacheTTL: config.cacheTTL || 30000, // 30 seconds
      fallbackToAPI: config.fallbackToAPI !== false,
      ...config
    };
    
    // Balance cache to avoid excessive API calls
    this.balanceCache = new Map();
  }

  /**
   * Validate balance for a specific order
   */
  async validateOrderBalance(orderDetails) {
    const { symbol, side, amount, price } = orderDetails;
    
    try {
      // Parse trading pair
      const [baseAsset, quoteAsset] = symbol.split('/');
      
      if (side === 'buy') {
        // For buy orders, check quote currency (USD) balance
        const requiredAmount = amount * price;
        return await this.validateAssetBalance(quoteAsset, requiredAmount, 'quote');
      } else if (side === 'sell') {
        // For sell orders, check base currency (SOL) balance
        return await this.validateAssetBalance(baseAsset, amount, 'base');
      } else {
        throw new Error(`Unknown order side: ${side}`);
      }
    } catch (error) {
      this.logger.error('Error validating order balance:', {
        error: error.message,
        orderDetails
      });
      return { valid: false, error: error.message };
    }
  }

  /**
   * Validate balance for a specific asset across all variants
   */
  async validateAssetBalance(asset, requiredAmount, context = 'unknown') {
    try {
      // Get all possible variants for this asset
      const variants = this.assetVariants[asset.toUpperCase()] || [asset.toUpperCase(), asset.toLowerCase()];
      
      this.logger.debug(`Validating ${asset} balance`, {
        requiredAmount,
        context,
        variants
      });

      // Get comprehensive balance data
      const balances = await this.getComprehensiveBalances();
      
      // Check each variant
      let totalAvailable = 0;
      const foundVariants = [];
      
      for (const variant of variants) {
        const balance = balances[variant];
        if (balance && parseFloat(balance) > this.config.minimumValidationThreshold) {
          const amount = parseFloat(balance);
          totalAvailable += amount;
          foundVariants.push({ variant, amount });
        }
      }

      const hasSufficient = totalAvailable >= requiredAmount;

      this.logger.info(`Balance validation for ${asset}:`, {
        asset,
        context,
        requiredAmount,
        totalAvailable,
        foundVariants,
        hasSufficient,
        variantsChecked: variants.length
      });

      return {
        valid: hasSufficient,
        asset,
        requiredAmount,
        totalAvailable,
        foundVariants,
        variantsChecked: variants,
        deficit: hasSufficient ? 0 : requiredAmount - totalAvailable
      };

    } catch (error) {
      this.logger.error(`Error validating ${asset} balance:`, {
        error: error.message,
        stack: error.stack,
        asset,
        requiredAmount
      });
      
      return {
        valid: false,
        error: error.message,
        asset,
        requiredAmount
      };
    }
  }

  /**
   * Get comprehensive balance data from all available sources
   */
  async getComprehensiveBalances() {
    const cacheKey = 'comprehensive_balances';
    const cached = this.balanceCache.get(cacheKey);
    
    // Return cached data if still valid
    if (cached && (Date.now() - cached.timestamp) < this.config.cacheTTL) {
      this.logger.debug('Using cached balance data');
      return cached.data;
    }

    try {
      let balances = {};

      // Try to get balances from exchange adapter
      if (this.exchangeAdapter && typeof this.exchangeAdapter.getBalances === 'function') {
        try {
          this.logger.debug('Fetching balances from exchange adapter');
          balances = await this.exchangeAdapter.getBalances();
        } catch (error) {
          this.logger.warn('Failed to get balances from exchange adapter:', error.message);
        }
      }

      // If we don't have sufficient data and fallback is enabled, try direct API
      if (Object.keys(balances).length === 0 && this.config.fallbackToAPI) {
        try {
          this.logger.debug('Falling back to direct Kraken API');
          const { KrakenRESTClient } = await import('../../../lib/exchanges/KrakenRESTClient.js');
          
          const krakenClient = new KrakenRESTClient({
            baseUrl: process.env.KRAKEN_REST_URL || 'https://api.kraken.com',
            apiKey: process.env.KRAKEN_API_KEY,
            apiSecret: process.env.KRAKEN_API_SECRET
          });

          balances = await krakenClient.getAccountBalance();
          this.logger.debug('Successfully fetched balances from Kraken API');
        } catch (error) {
          this.logger.error('Failed to get balances from Kraken API:', error.message);
        }
      }

      // Cache the results
      this.balanceCache.set(cacheKey, {
        data: balances,
        timestamp: Date.now()
      });

      this.logger.debug('Comprehensive balance fetch completed', {
        assetsFound: Object.keys(balances).length,
        nonZeroAssets: Object.keys(balances).filter(k => parseFloat(balances[k] || 0) > 0).length
      });

      return balances;
      
    } catch (error) {
      this.logger.error('Error getting comprehensive balances:', {
        error: error.message,
        stack: error.stack
      });
      
      // Return empty balances rather than throwing
      return {};
    }
  }

  /**
   * Get available balance for a specific asset (checks all variants)
   */
  async getAvailableBalance(asset) {
    const validation = await this.validateAssetBalance(asset, 0);
    return validation.totalAvailable || 0;
  }

  /**
   * Clear balance cache (useful for forced refresh)
   */
  clearCache() {
    this.balanceCache.clear();
    this.logger.debug('Balance cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const entries = Array.from(this.balanceCache.entries());
    return {
      entryCount: entries.length,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(([, v]) => v.timestamp)) : null,
      newestEntry: entries.length > 0 ? Math.max(...entries.map(([, v]) => v.timestamp)) : null
    };
  }
}

export default ComprehensiveBalanceValidator;