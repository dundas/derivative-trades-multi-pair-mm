import { KrakenMarketDataProvider } from './KrakenMarketDataProvider.js';
import { TestMarketDataProvider } from './TestMarketDataProvider.js';
import { MockMarketDataProvider } from '../testing/MockMarketDataProvider.js';

/**
 * Factory for creating MarketDataProvider instances
 */
export class MarketDataProviderFactory {
  /**
   * Create a market data provider
   * @param {Object} options Configuration options
   * @param {string} options.type Type of provider ('kraken', 'test', etc.)
   * @param {Object} [options.providerOptions] Provider-specific options
   * @returns {BaseMarketDataProvider} Market data provider instance
   */
  static create(options = {}) {
    const type = options.type?.toLowerCase() || 'test';
    const providerOptions = options.providerOptions || {};
    
    switch (type) {
      case 'kraken':
        return new KrakenMarketDataProvider(providerOptions);
      case 'test':
        return new TestMarketDataProvider(providerOptions);
      case 'mock':
        return new MockMarketDataProvider(providerOptions);
      default:
        throw new Error(`Unsupported market data provider type: ${type}`);
    }
  }
}

export default MarketDataProviderFactory;
