# TrueX WebSocket API Documentation

## Overview

The TrueX WebSocket API 1.0.0 allows clients to interact with the **TrueX trading platform** for real-time instrument, market data, and exchange transactions.

## Servers

### UAT (User Acceptance Testing)
- **URL**: `wss://uat.truex.co/`
- **Description**: TrueX UAT websocket sandbox server

### Production
- **URL**: `wss://prod.truex.co/`
- **Description**: TrueX production websocket server

## Authentication

Certain API requests must be **authenticated** using **HMAC-SHA256 signature authentication**.

### Authentication Methods

#### 1. Unauthenticated Access (x-no-auth)
- **Name**: x-no-auth
- **In**: query
- Clients may subscribe to endpoints without an API key or computing an HMAC signature
- These endpoints are rate limited by the server, coalescing and only sending data at a predetermined rate
- Non-authenticated connections can be upgraded by supplying an API key and computed HMAC signature on the next request
- **Requirements**:
  - Unauthenticated requests must have the type: `SUBSCRIBE_NO_AUTH`
  - Must NOT include: `organization_id`, `key`, `signature`
  - Must include: `timestamp` (UTC Unix epoch in seconds)

#### 2. Authenticated Access (x-api-key)
- **Name**: x-api-key
- **In**: query
- Clients must compute and send an HMAC signature in the signature member of the request structure
- **HMAC Signature Payload**: `timestamp + TRUEXWS + key + path`
  - Note: path is everything after the domain name including the / (e.g. /api/v1)
- **Required members**:
  - `signature`: The signature generated from processing the payload with the HMAC key
  - `key`: The ID of the HMAC key being used
  - `timestamp`: A UTC Unix epoch in seconds

## Operations

### 1. SEND /api/v1 - Subscribe to Channel
- **Operation ID**: subscribeToChannel
- **Description**: Message sent to server indicating what channels and data the user would like to subscribe to

#### Request Message Structure
```json
{
  "type": "SUBSCRIBE" | "SUBSCRIBE_NO_AUTH" | "UNSUBSCRIBE",
  "item_names": ["string"],  // List of items to act upon
  "channels": ["string"],     // List of channels to interact with
  "timestamp": "string",      // Required: UTC Unix epoch in seconds (must be within 15 seconds of server time)
  "organization_id": "string", // Exchange designation ID (UUIDv4 format) - for authenticated only
  "key": "string",            // Exchange supplied API key (UUIDv4 format) - for authenticated only
  "signature": "string"       // The computed HMAC signature - for authenticated only
}
```

### 2. RECEIVE /api/v1 - Welcome Message
- **Operation ID**: welcomeFromServer
- **Description**: Message received when connecting to the server and establishing a websocket connection

#### Response Message Structure
```json
{
  "connections": "string",    // Current number of active connections from the source IP
  "channel": "WEBSOCKET" | "INSTRUMENT" | "TRADE" | "EBBO",
  "update": "WELCOME" | "SNAPSHOT" | "UPDATE",
  "message": "string",        // Message supplied when initiating a connection
  "version": "string",        // Current version of the websocket API
  "datetime": "string"        // Current datetime of when the server sent the message
}
```

### 3. RECEIVE /api/v1 - Confirmation Message
- **Operation ID**: confirmationFromServer
- **Description**: Message sent from server containing channels and items the user is currently subscribed to

#### Response Message Structure
```json
{
  "timestamp": "string",      // Server timestamp when confirmation was generated
  "channel": "WEBSOCKET" | "INSTRUMENT" | "TRADE" | "EBBO",
  "update": "WELCOME" | "SNAPSHOT" | "UPDATE",
  "status": "INVALID" | "ERROR" | "UNAUTHORIZED" | "UNAUTHENTICATED" | "AUTHENTICATED",
  "subscriptions": [
    {
      "channel": "string",
      "item_names": ["string"]
    }
  ]
}
```

### 4. RECEIVE /api/v1 - Instrument Data
- **Operation ID**: instrumentFromServer
- **Description**: Message sent from server with instrument data

#### Response Message Structure
```json
{
  "seqnum": "string",         // Current sequence number of the channel
  "channel": "WEBSOCKET" | "INSTRUMENT" | "TRADE" | "EBBO",
  "update": "WELCOME" | "SNAPSHOT" | "UPDATE",
  "status": "INVALID" | "ERROR" | "UNAUTHORIZED" | "UNAUTHENTICATED" | "AUTHENTICATED",
  "data": {
    "id": "string",           // Exchange assigned ID of the instrument
    "status": "DISABLED" | "OPENING" | "ACTIVE" | "HALTED",
    "info": {
      "symbol": "string",     // Human readable representation (max 31 chars)
      "reference_price": "string",
      "base_asset_id": "string",
      "quote_asset_id": "string",
      "price_limit_window_secs": "string",
      "price_limit_percent": "string",    // Percentage threshold for price movement
      "price_bands_percent": "string"     // Acceptable price range for order validation
    },
    "stats": {
      "last_24hr_notional": "string",    // Notional amount traded over last 24hr
      "last_24hr_quantity": "string"      // Quantity traded over last 24hr
    }
  }
}
```

### 5. RECEIVE /api/v1 - Trade Data
- **Operation ID**: tradeFromServer
- **Description**: Message sent from server containing the latest trade information for a subscribed instrument

#### Response Message Structure
```json
{
  "seqnum": "string",
  "channel": "WEBSOCKET" | "INSTRUMENT" | "TRADE" | "EBBO",
  "update": "WELCOME" | "SNAPSHOT" | "UPDATE",
  "status": "INVALID" | "ERROR" | "UNAUTHORIZED" | "UNAUTHENTICATED" | "AUTHENTICATED",
  "data": {
    "match_id": "string",     // Unique identifier for the trade match event
    "trade_price": "string",  // Price at which the trade was executed
    "trade_qty": "string",    // Quantity of the asset traded
    "liq_flag": "TAKER" | "MAKER"  // Whether trade was executed as taker or maker
  }
}
```

### 6. RECEIVE /api/v1 - EBBO (Exchange Best Bid and Offer)
- **Operation ID**: ebboFromServer
- **Description**: Message sent from server containing the latest exchange best bid and offer information for a subscribed instrument

#### Response Message Structure
```json
{
  "seqnum": "string",
  "channel": "WEBSOCKET" | "INSTRUMENT" | "TRADE" | "EBBO",
  "update": "WELCOME" | "SNAPSHOT" | "UPDATE",
  "status": "INVALID" | "ERROR" | "UNAUTHORIZED" | "UNAUTHENTICATED" | "AUTHENTICATED",
  "data": {
    "id": "string",           // Exchange assigned ID of the market data
    "status": "DISABLED" | "ENABLED",
    "info": {
      "last_trade": {
        "price": "string",
        "qty": "string"
      },
      "best_bid": {
        "price": "string",
        "qty": "string"
      },
      "best_ask": {
        "price": "string",
        "qty": "string"
      },
      "last_update": "string"  // UTC Unix epoch in nanoseconds
    }
  }
}
```

## Message Types Summary

1. **subscription** - Client request to subscribe/unsubscribe to channels
2. **welcome** - Initial server response upon connection
3. **confirmation** - Server confirmation of current subscriptions
4. **instrument** - Instrument data updates
5. **trade** - Trade execution data
6. **ebbo** - Exchange best bid/offer updates

## Schemas

### MarketQuote
```json
{
  "price": "string",
  "qty": "string"
}
```

## Important Notes

1. All timestamps must be within 15 seconds of the server's current time
2. UUIDs must be supplied in human-readable form (RFC 9562)
3. Path for HMAC signature includes everything after the domain name (e.g., /api/v1)
4. Additional properties are allowed in all message structures
5. Unauthenticated connections are rate-limited
6. Price fields use string type to preserve decimal precision

## Links

- 📖 **Full API Documentation**: https://docs.truex.co/
- 📧 **Support**: support@truex.co
- **Terms of Service**: https://truex.co/tos
- **Contact**: info@truex.co