# TrueX FIX Exchange Adapter

A JavaScript implementation of the TrueX exchange FIX 5.0 SP2 protocol adapter for automated trading systems using the jspurefix library.

## Overview

The `TrueXFIXExchangeAdapter` provides a complete implementation of TrueX's FIX protocol using the mature jspurefix library. It manages separate connections for Order Entry and Market Data sessions, extends the `BaseExchangeAdapter` class, and provides all necessary functionality for trading on TrueX exchange with full type safety and protocol compliance.

## Features

- **jspurefix Library**: Built on the mature, battle-tested jspurefix FIX engine
- **Dual FIX Sessions**: Separate connections for Order Entry and Market Data
- **FIX 5.0 SP2 Protocol**: Full implementation with dictionary-based validation
- **Type Safety**: TypeScript interfaces for all FIX message types
- **Authentication**: HMAC-SHA-256 based authentication per TrueX specs
- **Order Management**: Create, cancel, and modify orders with type-safe APIs
- **Market Data**: Real-time order book and trade updates
- **Session Management**: Automatic session handling, heartbeats, and sequence numbers
- **Automatic Reconnection**: Built-in reconnection logic via jspurefix
- **Error Handling**: Comprehensive error handling and reporting

## Installation

```bash
# Run the setup script to install dependencies
./truex-fix-setup.sh

# Or manually install jspurefix
npm install jspurefix
cd node_modules/jspurefix && npm run unzip-repo
```

## Configuration

```javascript
const config = {
  // Connection settings
  orderEntryHost: 'fix-order.truex.co',
  orderEntryPort: 443,
  marketDataHost: 'fix-market.truex.co', 
  marketDataPort: 443,
  
  // Authentication
  apiKey: 'YOUR_API_KEY',
  apiSecret: 'YOUR_API_SECRET',
  senderCompID: 'CLIENT',
  targetCompID: 'TRUEX',
  
  // Trading configuration
  tradingPair: 'BTC/USD',
  tradingMode: 'paper', // or 'live'
  sessionId: 'unique-session-id',
  strategyName: 'my-strategy',
  
  // Session configuration
  heartbeatInterval: 30, // seconds
  
  // Reconnection settings
  maxReconnectAttempts: 5,
  initialReconnectDelayMs: 1000,
  maxReconnectDelayMs: 30000,
  
  // Dictionary path (optional - defaults to included FIX50SP2.xml)
  dictionaryPath: './fix-dictionaries/FIX50SP2.xml',
  
  // Logger
  logger: loggerInstance
};
```

## Usage

### Basic Example

```javascript
import { TrueXFIXExchangeAdapter } from './TrueXFIXExchangeAdapter.js';

// Create adapter instance
const adapter = new TrueXFIXExchangeAdapter(config);

// Set up event listeners
adapter.on('orderUpdate', (order) => {
  console.log('Order update:', order);
});

adapter.on('orderFilled', (fill) => {
  console.log('Order filled:', fill);
});

adapter.on('orderBookUpdate', (orderBook) => {
  console.log('Order book update:', orderBook);
});

// Connect to exchange
await adapter.connect();

// Subscribe to market data
await adapter.subscribeMarketData('BTC/USD');

// Place an order
const order = await adapter.createOrder({
  symbol: 'BTC/USD',
  side: 'buy',
  type: 'limit',
  price: 50000,
  amount: 0.001,
  params: {
    timeInForce: 'GTC', // Good Till Cancel
    execInst: 'ALO',    // Add Liquidity Only
    selfMatchPreventionId: 'account-123', // Optional: ID for self-match prevention
    selfMatchPreventionInstruction: 0      // Optional: 0=Cancel Resting, 1=Cancel Aggressing, 2=Decrement and Cancel
  }
});

// Cancel order
await adapter.cancelOrder(order.id);

// Disconnect
await adapter.disconnect();
```

## FIX Protocol Implementation

### Supported Message Types

#### Administrative Messages
- **Logon (35=A)**: Session authentication with HMAC-SHA-256 signature
- **Logout (35=5)**: Graceful session termination
- **Heartbeat (35=0)**: Keep-alive messages
- **Test Request (35=1)**: Connection testing
- **Resend Request (35=2)**: Message recovery
- **Reject (35=3)**: Message rejection handling
- **Sequence Reset (35=4)**: Sequence number synchronization
- **Business Reject (35=j)**: Business-level rejection

#### Order Entry Messages
- **New Order Single (35=D)**: Submit new orders
- **Order Cancel Request (35=F)**: Cancel existing orders
- **Order Cancel Replace Request (35=G)**: Modify orders
- **Execution Report (35=8)**: Order status updates and fills
- **Order Cancel Reject (35=9)**: Cancel rejection notifications

#### Market Data Messages
- **Security List Request (35=x)**: Request tradable instruments
- **Security List (35=y)**: List of available instruments
- **Market Data Request (35=V)**: Subscribe to market data
- **Market Data Snapshot (35=W)**: Full order book snapshot
- **Market Data Incremental (35=X)**: Order book updates

### Authentication

Authentication uses HMAC-SHA-256 with the following signature format:

```
Password = base64(HMAC-SHA-256(secret, message))
Message = SendingTime + MsgType + MsgSeqNum + SenderCompID + TargetCompID + Username
```

### Order Types

- **Market Orders (OrdType=1)**: Automatically converted to aggressively priced limit orders
- **Limit Orders (OrdType=2)**: Standard limit orders with specified price

### Time in Force

- **GTC (TimeInForce=1)**: Good Till Cancel (up to 30 days)
- **IOC (TimeInForce=3)**: Immediate Or Cancel

### Execution Instructions

- **ALO (ExecInst=6)**: Add Liquidity Only - Order only accepted if it doesn't match immediately

### Self-Match Prevention

TrueX supports self-match prevention using custom FIX fields:

- **SelfMatchPreventionID (Tag 2362)**: Identifier used to match orders from the same account/entity
- **SelfMatchPreventionInstruction (Tag 2964)**: Action to take when self-match is detected
  - `0`: Cancel Resting Order (cancel the existing order in the book)
  - `1`: Cancel Aggressing Order (cancel the incoming order)
  - `2`: Decrement and Cancel (reduce size and cancel remainder)

## Event Reference

### Order Events

- **`orderUpdate`**: Fired when order status changes
- **`orderFilled`**: Fired when order is partially or fully filled
- **`orderStatusChanged`**: Fired when order status is updated

### Market Data Events

- **`orderBookUpdate`**: Full order book snapshot
- **`tradeUpdate`**: Individual trade updates
- **`balancesUpdated`**: Balance changes (if supported)

### System Events

- **`error`**: Error notifications with type, message, and details
- **`connected`**: Successfully connected to exchange
- **`disconnected`**: Connection lost

## Error Handling

The adapter provides comprehensive error handling:

```javascript
adapter.on('error', (error) => {
  console.error(`Error type: ${error.type}`);
  console.error(`Message: ${error.message}`);
  
  switch(error.type) {
    case 'CONNECTION_ERROR':
      // Handle connection issues
      break;
    case 'ORDER_REJECTED':
      // Handle order rejections
      break;
    case 'MAX_RECONNECT_ATTEMPTS':
      // Handle max reconnection attempts reached
      break;
  }
});
```

## Implementation Details

### Session Handling

The adapter uses jspurefix's built-in session management:
- Automatic sequence number tracking
- Message persistence and recovery
- Gap fill and resend request handling
- Heartbeat monitoring

### Type Safety

All FIX messages are type-safe with TypeScript interfaces:
```javascript
const order = this.orderSession.factory.create(MsgType.NewOrderSingle);
order.ClOrdID = clOrdId;
order.Symbol = symbol;
order.Side = side === 'buy' ? Side.Buy : Side.Sell;
```

### Authentication

Custom HMAC-SHA-256 signature generation in the logon handler:
```javascript
const message = sendingTime + msgType + msgSeqNum + 
              senderCompID + targetCompID + apiKey;
const signature = crypto.createHmac('sha256', apiSecret)
  .update(message)
  .digest('base64');
```

## Best Practices

1. **Always handle errors**: Set up error event listeners before connecting
2. **Session management**: jspurefix handles sessions automatically
3. **Use unique ClOrdID**: The adapter generates unique client order IDs automatically
4. **Handle disconnections**: Implement proper cleanup in disconnect handlers
5. **Session configuration**: Use `CancelOnDisconnect=Y` for safety in production
6. **Dictionary validation**: Ensure FIX dictionary matches exchange specifications

## Testing

Use the included test file to verify functionality:

```bash
# First run setup
./truex-fix-setup.sh

# Then run tests
node TrueXFIXExchangeAdapter.test.js
```

Ensure you have set the required environment variables:
- `TRUEX_API_KEY`
- `TRUEX_API_SECRET`
- `TRUEX_ORDER_HOST` (optional)
- `TRUEX_MARKET_HOST` (optional)

## Dependencies

- **jspurefix**: Native TypeScript FIX engine
- **crypto**: For HMAC-SHA-256 authentication
- **BaseExchangeAdapter**: Your existing adapter base class

## Notes

- The adapter uses TLS for secure connections
- Sequence numbers reset on each logon (ResetSeqNumFlag=Y)
- All timestamps use microsecond precision (though JavaScript only supports milliseconds)
- Market orders are converted to aggressively priced limit orders by the exchange
- jspurefix handles all FIX protocol details including checksums, body length, etc.

## References

- [TrueX FIX API Documentation](https://docs.truemarkets.co/apis/cefi/fix)
- [jspurefix GitHub](https://github.com/TimelordUK/jspurefix)
- [FIX Protocol Specification](https://www.fixtrading.org/standards/)
- [QuickFIX Dictionary Files](https://github.com/quickfix/quickfix/tree/master/spec)