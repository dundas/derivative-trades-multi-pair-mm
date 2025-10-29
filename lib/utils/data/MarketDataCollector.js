import fs from 'fs/promises';
import path from 'path';

/**
 * Market Data Collector
 * 
 * Utility for collecting and storing market data for different market conditions.
 * Can be used with any exchange-specific provider.
 */
export class MarketDataCollector {
  /**
   * Create a new MarketDataCollector
   * @param {Object} options Configuration options
   * @param {BaseMarketDataProvider} options.provider Market data provider instance
   * @param {string} [options.outputDir] Output directory for collected data
   * @param {Object} [options.logger] Logger instance
   */
  constructor(options = {}) {
    if (!options.provider) {
      throw new Error('Market data provider is required');
    }
    
    this.provider = options.provider;
    this.outputDir = options.outputDir || 
      `${process.cwd()}/src/services/market-maker/test-data/market-conditions`;
    this.logger = options.logger || console;
  }

  /**
   * Collect market data for a specific market condition
   * @param {string} condition Market condition identifier
   * @returns {Promise<Object>} Collected market data
   */
  async collectData(condition) {
    try {
      this.logger.info(`Collecting data for condition: ${condition}`, {
        symbol: this.provider.symbol
      });
      
      // Collect data using the provider
      const orderBook = await this.provider.getOrderBook(100);
      const trades = await this.provider.getTrades(100);
      const ohlc = await this.provider.getOHLC('1h', 24);
      const ticker = await this.provider.getTicker();
      
      // Create metadata
      const metadata = {
        condition,
        symbol: this.provider.symbol,
        collectedAt: Date.now(),
        exchange: this.provider.constructor.name
      };
      
      // Prepare the collected data
      const data = {
        orderBook,
        trades,
        ohlc,
        ticker,
        metadata
      };
      
      // Save the collected data
      await this.saveData(condition, data);
      
      return data;
    } catch (error) {
      this.logger.error('Error collecting market data:', error);
      throw error;
    }
  }

  /**
   * Save collected market data to files
   * @param {string} condition Market condition identifier
   * @param {Object} data Collected market data
   * @returns {Promise<void>}
   */
  async saveData(condition, data) {
    try {
      // Create the condition directory if it doesn't exist
      const conditionDir = path.join(this.outputDir, condition);
      await fs.mkdir(conditionDir, { recursive: true });
      
      // Save each data type to a separate file
      await fs.writeFile(
        path.join(conditionDir, 'orderbook.json'),
        JSON.stringify(data.orderBook, null, 2)
      );
      
      await fs.writeFile(
        path.join(conditionDir, 'trades.json'),
        JSON.stringify(data.trades, null, 2)
      );
      
      await fs.writeFile(
        path.join(conditionDir, 'ohlc.json'),
        JSON.stringify(data.ohlc, null, 2)
      );
      
      await fs.writeFile(
        path.join(conditionDir, 'ticker.json'),
        JSON.stringify(data.ticker, null, 2)
      );
      
      await fs.writeFile(
        path.join(conditionDir, 'metadata.json'),
        JSON.stringify(data.metadata, null, 2)
      );
      
      this.logger.info(`Data saved to ${conditionDir}`);
    } catch (error) {
      this.logger.error('Error saving market data:', error);
      throw error;
    }
  }
  
  /**
   * Create a data collection script
   * @param {string} outputPath Path to save the script
   * @returns {Promise<string>} Path to the created script
   */
  async createCollectionScript(outputPath) {
    const scriptContent = `
/**
 * Market Data Collection Script
 * 
 * Used to collect and store market data for different market conditions.
 * This is a utility script, not part of the application runtime.
 */
import { KrakenRESTClient } from '../../../../lib/exchanges/KrakenRESTClient.js';
import { KrakenMarketDataProvider } from './KrakenMarketDataProvider.js';
import { MarketDataCollector } from './MarketDataCollector.js';
import { MarketConditions } from './MarketConditionTypes.js';

// Set up client and provider
const client = new KrakenRESTClient({
  baseUrl: 'https://api.kraken.com'
});

const provider = new KrakenMarketDataProvider({
  client,
  symbol: 'BTC/USD'
});

const collector = new MarketDataCollector({
  provider
});

// Collect data for different market conditions
async function collectAllMarketConditions() {
  try {
    console.log('Starting market data collection...');
    
    // Collect data for high liquidity normal volatility
    await collector.collectData(MarketConditions.HIGH_LIQUIDITY_NORMAL_VOLATILITY);
    console.log('Collected data for high liquidity normal volatility');
    
    // Add more conditions as needed
    
    console.log('Data collection complete');
  } catch (error) {
    console.error('Error collecting market data:', error);
  }
}

// Run the collection
collectAllMarketConditions();
`;

    try {
      await fs.writeFile(outputPath, scriptContent);
      return outputPath;
    } catch (error) {
      this.logger.error('Error creating collection script:', error);
      throw error;
    }
  }
}

export default MarketDataCollector;
