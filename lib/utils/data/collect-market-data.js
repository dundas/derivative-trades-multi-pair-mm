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

/**
 * Collect market data for a specific symbol and market condition
 */
async function collectMarketData(symbol, condition) {
  try {
    console.log(`Starting market data collection for ${symbol} under ${condition} condition...`);
    
    // Set up client and provider
    const client = new KrakenRESTClient({
      baseUrl: 'https://api.kraken.com'
    });

    const provider = new KrakenMarketDataProvider({
      client,
      symbol
    });

    const collector = new MarketDataCollector({
      provider
    });
    
    // Collect and save data
    await collector.collectData(condition);
    
    console.log(`Data collection complete for ${symbol} under ${condition} condition`);
  } catch (error) {
    console.error('Error collecting market data:', error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const symbol = args[0] || 'BTC/USD';
const condition = args[1] || MarketConditions.HIGH_LIQUIDITY_NORMAL_VOLATILITY;

// Check if condition is valid
if (!Object.values(MarketConditions).includes(condition)) {
  console.error(`Invalid market condition: ${condition}`);
  console.log('Available conditions:');
  Object.entries(MarketConditions).forEach(([key, value]) => {
    console.log(`- ${key}: ${value}`);
  });
  process.exit(1);
}

// Run the collection
collectMarketData(symbol, condition);
