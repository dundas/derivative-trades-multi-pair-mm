/**
 * Enhanced Comprehensive Balance Validator
 * 
 * This version forces REST API fallback when WebSocket shows 0 balance
 * to fix the issue where sessions fail due to WebSocket balance cache issues.
 */

import { createLogger } from './logger-factory.js';
import { KrakenRESTClient } from '../../../lib/exchanges/KrakenRESTClient.js';

export class ComprehensiveBalanceValidatorEnhanced {
  constructor(exchangeAdapter, config = {}) {
    this.exchangeAdapter = exchangeAdapter;
    this.logger = config.logger || createLogger('ComprehensiveBalanceValidatorEnhanced');
    
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
      forceAPIOnZeroBalance: true, // NEW: Always use API when WS shows 0
      ...config
    };
    
    // Balance cache to avoid excessive API calls
    this.balanceCache = new Map();
    
    // REST client for fallback
    this.restClient = null;
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
        if (balance) {
          // Handle different balance formats
          let amount = 0;
          if (typeof balance === 'object') {
            amount = parseFloat(balance.available || balance.total || 0);
          } else {
            amount = parseFloat(balance);
          }
          
          if (amount > this.config.minimumValidationThreshold) {
            totalAvailable += amount;
            foundVariants.push({ variant, amount });
          }
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
      let wsBalanceEmpty = true;

      // Try to get balances from exchange adapter first
      if (this.exchangeAdapter && typeof this.exchangeAdapter.getBalances === 'function') {
        try {
          this.logger.debug('Fetching balances from exchange adapter');
          const wsBalances = await this.exchangeAdapter.getBalances();
          
          // Check if WebSocket has any non-zero balances
          for (const [asset, data] of Object.entries(wsBalances)) {
            const amount = typeof data === 'object' 
              ? (parseFloat(data.available) || parseFloat(data.total) || 0)
              : parseFloat(data);
            
            if (amount > 0.000001) {
              wsBalanceEmpty = false;
              break;
            }
          }
          
          if (!wsBalanceEmpty) {
            balances = wsBalances;
            this.logger.info('Using WebSocket balance data');
          } else {
            this.logger.warn('WebSocket balance is empty, will use REST API fallback');
          }
        } catch (error) {
          this.logger.warn('Failed to get balances from exchange adapter:', error.message);
        }
      }

      // If WebSocket balance is empty or unavailable, use REST API
      if (wsBalanceEmpty && this.config.fallbackToAPI) {
        try {
          this.logger.info('Using REST API for balance data (WebSocket empty)');
          
          // Initialize REST client if not already done
          if (!this.restClient) {
            this.restClient = new KrakenRESTClient({
              baseUrl: process.env.KRAKEN_REST_URL || 'https://api.kraken.com',
              apiKey: process.env.KRAKEN_API_KEY,
              apiSecret: process.env.KRAKEN_API_SECRET,
              logger: this.logger
            });
          }

          const apiBalances = await this.restClient.getAccountBalance();
          
          // Convert to WebSocket format for compatibility
          const convertedBalances = {};
          for (const [asset, amount] of Object.entries(apiBalances)) {
            convertedBalances[asset] = {
              total: parseFloat(amount),
              available: parseFloat(amount),
              reserved: 0,
              source: 'rest-api'
            };
          }
          
          balances = convertedBalances;
          this.logger.info('Successfully fetched balances from REST API', {
            assetCount: Object.keys(balances).length,
            hasUSD: !!balances.USD || !!balances.ZUSD
          });
        } catch (error) {
          this.logger.error('Failed to get balances from REST API:', error.message);
          throw error;
        }
      }

      // Cache the results
      this.balanceCache.set(cacheKey, {
        data: balances,
        timestamp: Date.now()
      });

      return balances;

    } catch (error) {
      this.logger.error('Failed to get comprehensive balances:', error);
      throw error;
    }
  }

  /**
   * Clear the balance cache to force a refresh
   */
  clearCache() {
    this.balanceCache.clear();
    this.logger.info('Balance cache cleared');
  }

  /**
   * Get a summary of all available balances
   */
  async getBalanceSummary() {
    try {
      const balances = await this.getComprehensiveBalances();
      const summary = {
        assets: {},
        totalUSD: 0,
        source: 'unknown'
      };

      for (const [asset, data] of Object.entries(balances)) {
        const amount = typeof data === 'object'
          ? (parseFloat(data.available) || parseFloat(data.total) || 0)
          : parseFloat(data);

        if (amount > this.config.minimumValidationThreshold) {
          summary.assets[asset] = amount;
          
          // Track USD total
          if (asset === 'USD' || asset === 'ZUSD') {
            summary.totalUSD += amount;
          }
          
          // Track data source
          if (typeof data === 'object' && data.source) {
            summary.source = data.source;
          }
        }
      }

      return summary;
    } catch (error) {
      this.logger.error('Error getting balance summary:', error);
      return { assets: {}, totalUSD: 0, error: error.message };
    }
  }
}

export default ComprehensiveBalanceValidatorEnhanced;