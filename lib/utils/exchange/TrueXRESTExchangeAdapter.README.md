# TrueX REST Exchange Adapter

A JavaScript implementation of the TrueX exchange REST API v1 adapter with optional WebSocket support for real-time market data.

## Overview

The `TrueXRESTExchangeAdapter` provides a complete implementation of TrueX's REST API v1, extending the `BaseExchangeAdapter` class. It includes both REST API functionality and optional WebSocket connections for real-time market data, with automatic fallback to REST polling when WebSocket is unavailable.

## Features

- **Complete REST API v1 Implementation**: All endpoints including orders, balances, market data, and transfers
- **HMAC-SHA256 Authentication**: Secure request signing per TrueX specifications
- **WebSocket Support**: Real-time market data with automatic reconnection
- **REST Polling Fallback**: Automatic fallback when WebSocket is unavailable
- **Order Management**: Full lifecycle management with status polling
- **Market Data**: Real-time order book and trade updates
- **Balance Monitoring**: Automatic balance polling and updates
- **Instrument Caching**: Efficient caching of instrument data
- **Error Handling**: Comprehensive error handling with typed errors
- **Event-Driven Architecture**: EventEmitter-based notifications

## Installation

```bash
npm install axios ws
```

## Configuration

```javascript
const config = {
  // REST API settings
  baseURL: 'https://prod.truex.co/api/v1',
  apiKey: 'YOUR_API_KEY',
  apiSecret: 'YOUR_API_SECRET',
  userId: 'YOUR_USER_ID', // Often same as API key
  
  // WebSocket settings (optional)
  wsUrl: 'wss://ws.truex.co',
  
  // Trading configuration
  tradingPair: 'BTC/USD',
  tradingMode: 'paper', // or 'live'
  sessionId: 'unique-session-id',
  strategyName: 'my-strategy',
  
  // Polling intervals (milliseconds)
  orderStatusPollIntervalMs: 1000,    // Order status updates
  orderBookPollIntervalMs: 500,       // Market data updates
  balancePollIntervalMs: 5000,        // Balance updates
  
  // Connection settings
  timeout: 30000,                     // Request timeout
  maxReconnectAttempts: 5,           // WebSocket reconnection attempts
  initialReconnectDelayMs: 1000,     // Initial reconnection delay
  
  // Logger
  logger: loggerInstance
};
```

## Usage

### Basic Example

```javascript
import { TrueXRESTExchangeAdapter } from './TrueXRESTExchangeAdapter.js';

// Create adapter instance
const adapter = new TrueXRESTExchangeAdapter(config);

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

adapter.on('balancesUpdated', (balances) => {
  console.log('Balances updated:', balances);
});

// Connect to exchange
await adapter.connect();

// Get account balances
const balances = await adapter.fetchBalances();

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
    timeInForce: 'GTC',  // Good Till Cancel
    postOnly: true       // Maker-only order
  }
});

// Cancel order
await adapter.cancelOrder(order.id);

// Disconnect
await adapter.disconnect();
```

### Advanced Trading Strategy Example

```javascript
class TradingStrategy {
  constructor(config) {
    this.adapter = new TrueXRESTExchangeAdapter(config);
    this.position = 0;
    this.pendingOrders = new Map();
  }
  
  async start() {
    await this.adapter.connect();
    
    // Subscribe to events
    this.adapter.on('orderBookUpdate', this.onOrderBook.bind(this));
    this.adapter.on('orderFilled', this.onFill.bind(this));
    
    // Subscribe to market data
    await this.adapter.subscribeMarketData('BTC/USD');
  }
  
  async onOrderBook(orderBook) {
    const bestBid = orderBook.bids[0];
    const bestAsk = orderBook.asks[0];
    
    if (!bestBid || !bestAsk) return;
    
    // Simple market making logic
    const spread = bestAsk[0] - bestBid[0];
    const midPrice = (bestBid[0] + bestAsk[0]) / 2;
    
    if (spread > midPrice * 0.002) { // 0.2% spread
      await this.placeOrders(bestBid[0], bestAsk[0]);
    }
  }
  
  async placeOrders(bestBid, bestAsk) {
    // Cancel existing orders
    for (const orderId of this.pendingOrders.keys()) {
      await this.adapter.cancelOrder(orderId);
    }
    this.pendingOrders.clear();
    
    // Place new orders
    const buyOrder = await this.adapter.createOrder({
      side: 'buy',
      type: 'limit',
      price: bestBid + 0.01,
      amount: 0.001,
      params: { postOnly: true }
    });
    
    const sellOrder = await this.adapter.createOrder({
      side: 'sell',
      type: 'limit',
      price: bestAsk - 0.01,
      amount: 0.001,
      params: { postOnly: true }
    });
    
    this.pendingOrders.set(buyOrder.id, buyOrder);
    this.pendingOrders.set(sellOrder.id, sellOrder);
  }
  
  onFill(fill) {
    // Update position
    this.position += fill.side === 'buy' ? fill.amount : -fill.amount;
    this.pendingOrders.delete(fill.orderId);
  }
}
```

## API Reference

### Connection Methods

#### `connect()`
Establishes connection to TrueX REST API and optionally WebSocket.
- Tests REST connectivity with ping
- Loads instrument data
- Connects WebSocket for market data (if configured)
- Starts polling for order and balance updates

#### `disconnect()`
Cleanly disconnects from all services.
- Stops all polling intervals
- Closes WebSocket connection
- Cleans up resources

### Trading Methods

#### `createOrder(params)`
Creates a new order on the exchange.

Parameters:
- `symbol` (string): Trading pair (e.g., 'BTC/USD')
- `type` (string): Order type ('market' or 'limit')
- `side` (string): Order side ('buy' or 'sell')
- `price` (number): Limit price (required for limit orders)
- `amount` (number): Order quantity
- `clientId` (string): Optional client order ID
- `params` (object): Additional parameters
  - `timeInForce` (string): 'GTC', 'IOC', etc.
  - `postOnly` (boolean): Maker-only order
  - `clientId` (string): Reference client ID

Returns: Order object with id, status, etc.

#### `cancelOrder(orderId, params)`
Cancels an existing order.

Parameters:
- `orderId` (string): Order ID to cancel
- `params` (object): Optional parameters

Returns: Cancellation result

#### `getOrderStatus(orderId)`
Gets current status of an order.

Parameters:
- `orderId` (string): Order ID to check

Returns: Order object with current status

#### `cancelAllManagedOrders(reason)`
Cancels all open orders managed by this adapter.

Parameters:
- `reason` (string): Reason for cancellation

Returns: Array of cancellation results

### Market Data Methods

#### `subscribeMarketData(symbol)`
Subscribes to real-time market data for a symbol.
- Uses WebSocket if available
- Falls back to REST polling if WebSocket unavailable

Parameters:
- `symbol` (string): Trading pair to subscribe to

#### `unsubscribeMarketData(symbol)`
Unsubscribes from market data for a symbol.

Parameters:
- `symbol` (string): Trading pair to unsubscribe from

#### `getTradablePairs()`
Gets list of all tradable pairs on the exchange.

Returns: Array of trading pair symbols

#### `getPairDetails(pair)`
Gets detailed information about a trading pair.

Parameters:
- `pair` (string): Trading pair symbol

Returns: Object with pair details including:
- `symbol`: Trading pair symbol
- `base`: Base asset name
- `quote`: Quote asset name
- `minOrderSize`: Minimum order size
- `minPriceIncrement`: Price tick size
- `precision`: Amount and price precision
- `fees`: Maker and taker fees

### Account Methods

#### `fetchBalances()`
Fetches current account balances.

Returns: Object with asset balances:
```javascript
{
  "BTC": { "free": 0.5, "used": 0.1, "total": 0.6 },
  "USD": { "free": 10000, "used": 5000, "total": 15000 }
}
```

#### `fetchPositions()`
Fetches open positions (returns empty object for spot trading).

Returns: Empty object `{}`

## Event Reference

### Order Events

- **`orderUpdate`**: Fired when order status changes
  ```javascript
  {
    id: 'order-123',
    status: 'open',
    filled: 0.0005,
    remaining: 0.0005
  }
  ```

- **`orderFilled`**: Fired when order is partially or fully filled
  ```javascript
  {
    orderId: 'order-123',
    fillId: 'fill-456',
    price: 50000,
    amount: 0.0005,
    side: 'buy',
    timestamp: 1234567890,
    fee: 0.1
  }
  ```

- **`orderStatusChanged`**: Fired when order status is updated
  ```javascript
  {
    orderId: 'order-123',
    oldStatus: 'open',
    newStatus: 'filled',
    details: { filled: 0.001 }
  }
  ```

### Market Data Events

- **`orderBookUpdate`**: Order book snapshot
  ```javascript
  {
    symbol: 'BTC/USD',
    bids: [[49900, 0.5], [49890, 1.0]],
    asks: [[50000, 0.5], [50010, 1.0]],
    timestamp: 1234567890
  }
  ```

- **`tradeUpdate`**: Individual trade updates
  ```javascript
  {
    symbol: 'BTC/USD',
    price: 50000,
    amount: 0.1,
    side: 'buy',
    timestamp: 1234567890
  }
  ```

### Account Events

- **`balancesUpdated`**: Balance changes
  ```javascript
  {
    "BTC": { "free": 0.5, "used": 0.1, "total": 0.6 },
    "USD": { "free": 10000, "used": 5000, "total": 15000 }
  }
  ```

### System Events

- **`error`**: Error notifications
  ```javascript
  {
    type: 'CONNECTION_ERROR',
    message: 'Failed to connect',
    details: { ... }
  }
  ```

## Implementation Details

### Authentication

The adapter uses HMAC-SHA256 authentication for all REST requests:

```javascript
const timestamp = Date.now().toString();
const method = 'POST';
const path = '/api/v1/order/trade';
const body = JSON.stringify(orderData);

const message = timestamp + method + path + body;
const signature = crypto.createHmac('sha256', apiSecret)
  .update(message)
  .digest('hex');

headers = {
  'x-truex-auth-userid': userId,
  'x-truex-auth-timestamp': timestamp,
  'x-truex-auth-token': apiKey,
  'x-truex-auth-signature': signature
};
```

### WebSocket Integration

The adapter includes optional WebSocket support for real-time data:

1. **Connection**: Establishes WebSocket connection on adapter connect
2. **Authentication**: Authenticates using HMAC-SHA256 signature
3. **Subscriptions**: Manages orderbook and trade subscriptions
4. **Reconnection**: Automatic reconnection with exponential backoff
5. **Fallback**: Automatic fallback to REST polling on failure

### REST Polling

When WebSocket is unavailable, the adapter uses REST polling:

1. **Order Status**: Polls active orders every `orderStatusPollIntervalMs`
2. **Market Data**: Polls order book every `orderBookPollIntervalMs`
3. **Balances**: Polls balances every `balancePollIntervalMs`

### Order Management

The adapter provides comprehensive order management:

1. **Order Creation**: Validates and formats orders for API submission
2. **Status Tracking**: Polls for status updates and detects changes
3. **Fill Detection**: Monitors for new fills and emits events
4. **Local Cache**: Maintains local order cache for efficiency

### Instrument Caching

Instruments are cached to reduce API calls:
- Cache duration: 1 hour
- Automatic refresh on cache miss
- Used for symbol to instrument ID mapping

## Error Handling

The adapter provides detailed error information:

```javascript
adapter.on('error', (error) => {
  switch(error.type) {
    case 'CONNECTION_ERROR':
      // Handle connection issues
      break;
    case 'AUTHENTICATION_ERROR':
      // Handle auth failures
      break;
    case 'ORDER_REJECTED':
      // Handle order rejections
      break;
    case 'RATE_LIMIT':
      // Handle rate limiting
      break;
    case 'INVALID_REQUEST':
      // Handle invalid requests
      break;
  }
});
```

## Best Practices

1. **Always handle errors**: Set up error event listeners before connecting
2. **Monitor rate limits**: TrueX has rate limits on API requests
3. **Use WebSocket when available**: More efficient than REST polling
4. **Implement reconnection logic**: Handle network interruptions gracefully
5. **Cache instrument data**: Reduces unnecessary API calls
6. **Use post-only orders**: For market making to ensure maker fees
7. **Handle partial fills**: Monitor fill events for order completion

## Testing

Use the included test file to verify functionality:

```bash
# Set environment variables
export TRUEX_API_KEY=your_api_key
export TRUEX_API_SECRET=your_api_secret
export TRUEX_USER_ID=your_user_id

# Run tests
node TrueXRESTExchangeAdapter.test.js
```

## Performance Considerations

1. **Polling Intervals**: Balance between data freshness and API load
2. **WebSocket vs REST**: WebSocket more efficient for real-time data
3. **Instrument Caching**: Reduces API calls significantly
4. **Batch Operations**: Use cancelAllOrders when possible
5. **Event Throttling**: Consider throttling high-frequency events

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify API credentials are correct
   - Check timestamp synchronization
   - Ensure signature calculation matches spec

2. **WebSocket Connection Issues**
   - Check firewall/proxy settings
   - Verify WebSocket URL is correct
   - Monitor reconnection attempts

3. **Order Rejections**
   - Check minimum order sizes
   - Verify price tick sizes
   - Ensure sufficient balance

4. **Missing Market Data**
   - Confirm symbol is valid
   - Check WebSocket subscription status
   - Verify REST polling is active

### Debug Mode

Enable detailed logging:

```javascript
const adapter = new TrueXRESTExchangeAdapter({
  ...config,
  logger: {
    debug: (...args) => console.log('[DEBUG]', ...args),
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args)
  }
});
```

## References

- [TrueX REST API Documentation](https://docs.truemarkets.co/apis/cefi/rest/v1)
- [TrueX OpenAPI Specification](https://docs.truemarkets.co/openapi/exchange.json)
- [BaseExchangeAdapter Documentation](../BaseExchangeAdapter.js)