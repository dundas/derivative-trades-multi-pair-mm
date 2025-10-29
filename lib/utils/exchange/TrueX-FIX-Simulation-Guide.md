# TrueX FIX Simulation Integration Guide

This guide explains how to run the TrueX FIX trading simulation and integrate it with our TrueXFIXExchangeAdapter for testing.

## Overview

TrueX provides an official FIX protocol trading simulation tool that allows you to test your FIX implementation against their UAT (User Acceptance Testing) environment. The simulation runs in Docker and simulates realistic trading scenarios between two clients.

## Prerequisites

1. **Docker and Docker Compose** installed
2. **Python 3.7+** (for running the simulation)
3. **Git** with submodule support
4. **TrueX UAT Credentials**:
   - Client API Key ID
   - Client API Key Secret
   - Client Mnemonics (identifiers)

## Setting Up the Simulation

### 1. Clone the TrueX Tools Repository

```bash
# Clone the repository
git clone https://github.com/true-markets/tools.git
cd tools

# Initialize and update submodules (for FIX dictionaries)
git submodule init
git submodule update
```

### 2. Navigate to FIX Simulation Directory

```bash
cd fix_simulation
```

### 3. Create Environment Configuration

Create a `.env` file in the `fix_simulation` directory:

```bash
# .env
TRUEX_CLIENT_MNEMONICS=client1,client2
TRUEX_CLIENT_API_KEY_ID=your_api_key_id
TRUEX_CLIENT_API_KEY_SECRET=your_api_key_secret
```

### 4. Review Configuration

The simulation uses these connection settings (from `client.cfg`):

```ini
[DEFAULT]
ConnectionType=initiator
HeartBtInt=10
StartTime=00:00:00
EndTime=23:59:59
UseDataDictionary=Y
TransportDataDictionary=specification/TrueX_FIXT11.xml
AppDataDictionary=specification/TrueX_FIX50SP2.xml
ResetOnLogon=Y
ReconnectInterval=60

[SESSION]
BeginString=FIXT.1.1
DefaultApplVerID=FIX.5.0SP2
TargetCompID=TRUEX_UAT_GW
SocketConnectHost=uat1.truex.co
SocketConnectPort=19484
```

## Running the Simulation

### 1. Start the Simulation

```bash
# Build and run the Docker containers
docker-compose up --build
```

This will:
- Build the Docker image with Python and FIX dependencies
- Start the trading simulation
- Connect two simulated clients to the TrueX UAT FIX gateway
- Begin executing trading scenarios

### 2. Monitor the Simulation

The simulation will output logs showing:
- FIX message exchanges
- Order placements
- Order modifications
- Order cancellations
- Market data updates

### 3. Stop the Simulation

```bash
# Stop the Docker container
docker stop truex_fix_trade_simulation

# Or press Ctrl+C in the terminal
```

## Integrating with Our TrueXFIXExchangeAdapter

### 1. Update Adapter Configuration for UAT

```javascript
const uatConfig = {
  // UAT Connection settings
  orderEntryHost: 'uat1.truex.co',
  orderEntryPort: 19484,
  marketDataHost: 'uat1.truex.co',
  marketDataPort: 19484,
  
  // Authentication
  apiKey: process.env.TRUEX_CLIENT_API_KEY_ID,
  apiSecret: process.env.TRUEX_CLIENT_API_KEY_SECRET,
  senderCompID: 'CLIENT1', // Your assigned CompID
  targetCompID: 'TRUEX_UAT_GW',
  
  // Trading configuration
  tradingPair: 'BTC/USD',
  tradingMode: 'paper',
  sessionId: `uat-test-${Date.now()}`,
  
  // Use the official FIX dictionaries
  transportDictionaryPath: './specification/TrueX_FIXT11.xml',
  appDictionaryPath: './specification/TrueX_FIX50SP2.xml',
  
  logger: logger
};
```

### 2. Run Adapter Against UAT

Create a test script `test-truex-uat.js`:

```javascript
import { TrueXFIXExchangeAdapter } from './TrueXFIXExchangeAdapter.js';
import { LoggerFactory } from '../logger-factory.js';

async function testAgainstUAT() {
  const logger = LoggerFactory.createLogger('TrueX-UAT-Test');
  
  const adapter = new TrueXFIXExchangeAdapter(uatConfig);
  
  // Set up event handlers
  adapter.on('orderUpdate', (order) => {
    logger.info('UAT Order Update:', order);
  });
  
  adapter.on('orderBookUpdate', (book) => {
    logger.info('UAT Market Data:', {
      symbol: book.symbol,
      bestBid: book.bids[0],
      bestAsk: book.asks[0]
    });
  });
  
  try {
    // Connect to UAT
    await adapter.connect();
    
    // Subscribe to market data
    await adapter.subscribeMarketData('BTC/USD');
    
    // Place a test order
    const order = await adapter.createOrder({
      symbol: 'BTC/USD',
      side: 'buy',
      type: 'limit',
      price: 40000, // Below market
      amount: 0.001,
      params: {
        selfMatchPreventionId: 'uat-test',
        selfMatchPreventionInstruction: 0
      }
    });
    
    logger.info('Test order placed:', order);
    
    // Let it run for a while
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Cancel the order
    await adapter.cancelOrder(order.id);
    
  } catch (error) {
    logger.error('UAT test failed:', error);
  } finally {
    await adapter.disconnect();
  }
}

// Run the test
testAgainstUAT().catch(console.error);
```

### 3. Download FIX Dictionaries

```bash
# Get the official TrueX FIX dictionaries
mkdir -p specification
cd specification
wget https://raw.githubusercontent.com/true-markets/specification/develop/TrueX_FIXT11.xml
wget https://raw.githubusercontent.com/true-markets/specification/develop/TrueX_FIX50SP2.xml
cd ..
```

## Understanding the Simulation

### What the Simulation Does

1. **Client Initialization**: Creates two FIX clients with separate sessions
2. **Order Flow**:
   - Places limit orders at various price levels
   - Modifies order quantities and prices
   - Cancels orders
   - Simulates partial fills
3. **Market Data**: Subscribes to market data feeds
4. **Session Management**: Handles logon/logout sequences

### Key Files in the Simulation

- `trade_simulation.py`: Main orchestration logic
- `client.py`: FIX client implementation
- `client.cfg`: Connection configuration
- `docker-compose.yml`: Container orchestration

## Troubleshooting

### Common Issues

1. **Connection Refused**
   - Ensure you're using the correct UAT host and port
   - Check firewall settings
   - Verify your API credentials

2. **Authentication Failed**
   - Double-check API key and secret
   - Ensure HMAC signature calculation matches TrueX specification
   - Verify timestamp synchronization

3. **Message Rejection**
   - Check FIX dictionary versions match
   - Ensure all required fields are present
   - Verify message sequence numbers

### Debug Mode

Enable detailed FIX logging:

```javascript
const debugConfig = {
  ...uatConfig,
  fixDebugLogging: true,
  logAllMessages: true
};
```

## Best Practices

1. **Test in UAT First**: Always test against UAT before production
2. **Monitor Rate Limits**: UAT may have different rate limits
3. **Use Official Dictionaries**: Always use TrueX's official FIX dictionaries
4. **Handle Reconnections**: UAT may have maintenance windows
5. **Log Everything**: Keep detailed logs for debugging

## Production Migration

When ready for production:

1. Update connection settings:
   ```javascript
   orderEntryHost: 'fix-order.truex.co',
   orderEntryPort: 443,
   targetCompID: 'TRUEX',
   ```

2. Use production API credentials
3. Remove debug logging
4. Implement proper error handling and monitoring

## Additional Resources

- [TrueX FIX Documentation](https://docs.truemarkets.co/apis/cefi/fix)
- [TrueX Tools Repository](https://github.com/true-markets/tools)
- [FIX Protocol Specification](https://www.fixtrading.org/)
- [jspurefix Documentation](https://github.com/TimelordUK/jspurefix)