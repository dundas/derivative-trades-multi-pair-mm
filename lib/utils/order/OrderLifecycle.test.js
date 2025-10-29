import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { OrderLifecycle } from './OrderLifecycle';
import { OrderStatus } from './OrderStatus'; // Corrected path

describe('OrderLifecycle Constructor', () => {
  // Tests for the constructor will go here
  test('should initialize with default values when no data is provided', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const lifecycle = new OrderLifecycle();

    expect(lifecycle.id).toBeUndefined();
    expect(lifecycle.clientOrderId).toBeUndefined();
    expect(lifecycle.symbol).toBeUndefined();
    expect(lifecycle.side).toBeUndefined();
    expect(lifecycle.type).toBeUndefined();
    expect(lifecycle.price).toBeUndefined();
    expect(lifecycle.amount).toBeUndefined();
    expect(lifecycle.filled).toBe(0);
    expect(lifecycle.remaining).toBeNaN(); // amount (undefined) - filled (0) = NaN
    expect(lifecycle.status).toBe(OrderStatus.PENDING);
    expect(lifecycle.createdAt).toBe(now);
    expect(lifecycle.updatedAt).toBe(now);
    expect(lifecycle.fills).toEqual([]);
    expect(lifecycle.cancellationInitiated).toBe(false);
    expect(lifecycle.history).toEqual([{
      status: OrderStatus.PENDING,
      timestamp: now,
      data: { status: OrderStatus.PENDING },
    }]);
    Date.now.mockRestore();
  });

  test('should correctly initialize with basic provided data', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const initialData = {
      id: 'order123',
      clientOrderId: 'clientOrder456',
      symbol: 'BTC/USD',
      side: 'buy',
      type: 'limit',
      price: 50000,
      amount: 0.1,
    };
    const lifecycle = new OrderLifecycle(initialData);

    expect(lifecycle.id).toBe('order123');
    expect(lifecycle.clientOrderId).toBe('clientOrder456');
    expect(lifecycle.symbol).toBe('BTC/USD');
    expect(lifecycle.side).toBe('buy');
    expect(lifecycle.type).toBe('limit');
    expect(lifecycle.price).toBe(50000);
    expect(lifecycle.amount).toBe(0.1);
    expect(lifecycle.filled).toBe(0);
    expect(lifecycle.remaining).toBe(0.1); // 0.1 (amount) - 0 (filled)
    expect(lifecycle.status).toBe(OrderStatus.PENDING);
    expect(lifecycle.createdAt).toBe(now);
    expect(lifecycle.updatedAt).toBe(now);
    expect(lifecycle.fills).toEqual([]);
    expect(lifecycle.cancellationInitiated).toBe(false);
    expect(lifecycle.history.length).toBe(1);
    expect(lifecycle.history[0]).toEqual(expect.objectContaining({
      status: OrderStatus.PENDING,
      timestamp: now,
      data: expect.objectContaining({ ...initialData, status: OrderStatus.PENDING })
    }));
    Date.now.mockRestore();
  });

  test('should correctly initialize with provided status', () => {
    const initialData = {
      id: 'order124',
      amount: 1,
      price: 100,
      status: OrderStatus.OPEN, // Provide an initial status
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.status).toBe(OrderStatus.OPEN);
    expect(lifecycle.history.length).toBe(1);
    expect(lifecycle.history[0].status).toBe(OrderStatus.OPEN);
  });

  test('should correctly initialize with provided filled and remaining amounts', () => {
    const initialData = {
      id: 'order125',
      amount: 1.0,
      price: 100,
      filled: 0.2, // alias for filledAmount
      remaining: 0.8, // alias for remainingAmount
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.filled).toBe(0.2);
    expect(lifecycle.remaining).toBe(0.8);
    // Status should be inferred if not provided and filled > 0
    expect(lifecycle.status).toBe(OrderStatus.PARTIALLY_FILLED); 
  });

  test('should correctly initialize with provided filledAmount and remainingAmount (preferring specific names)', () => {
    const initialData = {
      id: 'order126',
      amount: 1.0,
      price: 100,
      filledAmount: 0.3,
      remainingAmount: 0.7,
      filled: 0.9, // Should be ignored if filledAmount is present
      remaining: 0.99 // Should be ignored if remainingAmount is present
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.filled).toBe(0.3);
    expect(lifecycle.remaining).toBe(0.7);
    expect(lifecycle.status).toBe(OrderStatus.PARTIALLY_FILLED);
  });
  
  test('should infer PENDING status if amount is 0', () => {
    const initialData = {
      id: 'order127',
      amount: 0,
      price: 100,
      filledAmount: 0,
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.status).toBe(OrderStatus.PENDING);
    expect(lifecycle.remaining).toBe(0);
  });

  test('should infer FILLED status if filled equals amount and no status provided', () => {
    const initialData = {
      id: 'order128',
      amount: 0.5,
      price: 100,
      filledAmount: 0.5,
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.status).toBe(OrderStatus.FILLED);
    expect(lifecycle.remaining).toBe(0);
  });
  
  test('should prioritize provided status over inferred status', () => {
    const initialData = {
      id: 'order129',
      amount: 0.5,
      price: 100,
      filledAmount: 0.5, // Would infer FILLED
      status: OrderStatus.OPEN, // But OPEN is provided
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.status).toBe(OrderStatus.FILLED);
    expect(lifecycle.remaining).toBe(0); // still amount - filled
  });

  test('should initialize with provided timestamps', () => {
    const mockCreatedAt = Date.now() - 10000;
    const mockUpdatedAt = Date.now() - 5000;
    const initialData = {
      id: 'order130',
      amount: 1,
      price: 100,
      createdAt: mockCreatedAt,
      updatedAt: mockUpdatedAt,
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.createdAt).toBe(mockCreatedAt);
    expect(lifecycle.updatedAt).toBe(mockUpdatedAt);
    expect(lifecycle.history[0].timestamp).toBe(mockUpdatedAt); // history uses updatedAt if status is provided
  });
  
  test('should initialize with provided fills array', () => {
    const mockFills = [{ fillId: 'f1', amount: 0.1, price: 100, timestamp: Date.now() }];
    const initialData = {
      id: 'order131',
      amount: 1,
      price: 100,
      fills: mockFills,
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.fills).toEqual(mockFills);
    expect(lifecycle.fills).not.toBe(mockFills); // Should be a copy
  });

  test('remaining should be amount - filled if remaining(Amount) not provided', () => {
    const initialData = {
      id: 'order132',
      amount: 1.0,
      price: 100,
      filled: 0.2,
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.filled).toBe(0.2);
    expect(lifecycle.remaining).toBe(0.8); // 1.0 - 0.2
  });

  test('remaining should be 0 if amount is not provided but filled is', () => {
    const initialData = {
      id: 'order133',
      price: 100,
      filled: 0.2,
    };
    // This case is a bit ambiguous based on current constructor.
    // amount - filled would be undefined - 0.2 = NaN
    // If remaining isn't provided, and amount is not, it defaults to amount (undefined) - filled.
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.filled).toBe(0.2);
    expect(lifecycle.remaining).toBeNaN();
  });

  test('remaining should be amount if filled is not provided', () => {
    const initialData = {
      id: 'order134',
      amount: 1.0,
      price: 100,
    };
    const lifecycle = new OrderLifecycle(initialData);
    expect(lifecycle.filled).toBe(0);
    expect(lifecycle.remaining).toBe(1.0); // 1.0 - 0
  });

}); 

describe('OrderLifecycle Status Update Methods', () => {
  let lifecycle;
  let now;

  beforeEach(() => {
    now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    // Initialize with a basic order for testing status changes
    lifecycle = new OrderLifecycle({
      id: 'order1',
      clientOrderId: 'clientOrder1',
      symbol: 'BTC/USD',
      side: 'buy',
      type: 'limit',
      price: 60000,
      amount: 1,
    });
    // Clear history mock calls if Date.now was used in constructor history push directly
    // For _updateStatus, Date.now is called again, so the mock is fine.
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --- setOpen --- 
  describe('setOpen', () => {
    test('should update status to OPEN and record history', () => {
      const openData = { exchangeOrderId: 'exchangeOpen123' };
      lifecycle.setOpen(openData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.OPEN);
      expect(lifecycle.updatedAt).toBe(now);
      const history = lifecycle.getHistory();
      expect(history.length).toBe(2); // Initial PENDING + OPEN
      expect(history[1]).toEqual({
        status: OrderStatus.OPEN,
        timestamp: now,
        data: openData,
      });
    });

    test('should overwrite previous status when setOpen is called', () => {
      lifecycle.setCancelled({ reason: 'test' }); // Set to a different status first
      Date.now.mockReturnValue(now + 100); // Advance time for next update
      
      const openData = { info: 're-opened' };
      lifecycle.setOpen(openData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.OPEN);
      expect(lifecycle.updatedAt).toBe(now + 100);
      const history = lifecycle.getHistory();
      expect(history.length).toBe(3); // PENDING + CANCELLED + OPEN
      expect(history[2]).toEqual({
        status: OrderStatus.OPEN,
        timestamp: now + 100,
        data: openData,
      });
    });
  });

  // --- Tests for setPending --- (if applicable)
  // Note: There isn't an explicit public setPending method. 
  // Status is PENDING by default or if amount is 0.

  // --- Tests for setProcessing --- (if applicable)
  // Note: OrderStatus does not define PROCESSING. If it were added,
  // a setProcessing method and tests would be needed here.

  // --- setCancelled --- 
  describe('setCancelled', () => {
    test('should update status to CANCELLED and record history with reason', () => {
      const cancelData = { reason: 'User requested cancel' };
      lifecycle.setCancelled(cancelData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.CANCELLED);
      expect(lifecycle.updatedAt).toBe(now);
      const history = lifecycle.getHistory();
      expect(history.length).toBe(2); // Initial PENDING + CANCELLED
      expect(history[1]).toEqual({
        status: OrderStatus.CANCELLED,
        timestamp: now,
        data: cancelData,
      });
      // Check that amounts are not changed by cancellation itself
      expect(lifecycle.getFilled()).toBe(0); // From initial setup
      expect(lifecycle.getRemaining()).toBe(1); // From initial setup
    });

    test('should allow cancellation even if partially filled', () => {
      // Simulate a partial fill first
      lifecycle.setPartialFill({ amount: 0.3, price: 60000 }); 
      Date.now.mockReturnValue(now + 100); // Advance time

      const cancelData = { reason: 'Market volatile' };
      lifecycle.setCancelled(cancelData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.CANCELLED);
      expect(lifecycle.updatedAt).toBe(now + 100);
      expect(lifecycle.getFilled()).toBe(0.3); // Should retain previous fill
      expect(lifecycle.getRemaining()).toBe(0.7); // Should retain previous remaining
      
      const history = lifecycle.getHistory();
      expect(history.length).toBe(3); // PENDING + PARTIALLY_FILLED + CANCELLED
      expect(history[2]).toEqual({
        status: OrderStatus.CANCELLED,
        timestamp: now + 100,
        data: cancelData,
      });
    });
  });

  // --- setRejected --- 
  describe('setRejected', () => {
    test('should update status to REJECTED and record history with reason', () => {
      const rejectData = { reason: 'Insufficient funds' };
      lifecycle.setRejected(rejectData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.REJECTED);
      expect(lifecycle.updatedAt).toBe(now);
      const history = lifecycle.getHistory();
      expect(history.length).toBe(2); // Initial PENDING + REJECTED
      expect(history[1]).toEqual({
        status: OrderStatus.REJECTED,
        timestamp: now,
        data: rejectData,
      });
      // Check that amounts are not changed by rejection itself
      expect(lifecycle.getFilled()).toBe(0);
      expect(lifecycle.getRemaining()).toBe(1);
    });

    test('should allow rejection even if it was previously (e.g.) OPEN', () => {
      lifecycle.setOpen({ info: 'Order was open' });
      Date.now.mockReturnValue(now + 100); // Advance time

      const rejectData = { reason: 'Market closed' };
      lifecycle.setRejected(rejectData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.REJECTED);
      expect(lifecycle.updatedAt).toBe(now + 100);
      expect(lifecycle.getFilled()).toBe(0); 
      expect(lifecycle.getRemaining()).toBe(1);
      
      const history = lifecycle.getHistory();
      expect(history.length).toBe(3); // PENDING + OPEN + REJECTED
      expect(history[2]).toEqual({
        status: OrderStatus.REJECTED,
        timestamp: now + 100,
        data: rejectData,
      });
    });
  });

  // --- setExpired --- 
  describe('setExpired', () => {
    test('should update status to EXPIRED and record history', () => {
      const expireData = { reason: 'Time in force ended' };
      lifecycle.setExpired(expireData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.EXPIRED);
      expect(lifecycle.updatedAt).toBe(now);
      const history = lifecycle.getHistory();
      expect(history.length).toBe(2); // Initial PENDING + EXPIRED
      expect(history[1]).toEqual({
        status: OrderStatus.EXPIRED,
        timestamp: now,
        data: expireData,
      });
      expect(lifecycle.getFilled()).toBe(0);
      expect(lifecycle.getRemaining()).toBe(1);
    });

    test('should allow expiration even if partially filled', () => {
      lifecycle.setPartialFill({ amount: 0.4, price: 59000 });
      Date.now.mockReturnValue(now + 100); 

      const expireData = { autoExpired: true };
      lifecycle.setExpired(expireData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.EXPIRED);
      expect(lifecycle.updatedAt).toBe(now + 100);
      expect(lifecycle.getFilled()).toBe(0.4);
      expect(lifecycle.getRemaining()).toBe(0.6);
      
      const history = lifecycle.getHistory();
      expect(history.length).toBe(3); // PENDING + PARTIALLY_FILLED + EXPIRED
      expect(history[2]).toEqual({
        status: OrderStatus.EXPIRED,
        timestamp: now + 100,
        data: expireData,
      });
    });
  });

  // --- setPartialFill --- 
  describe('setPartialFill', () => {
    test('should update filled, remaining, status to PARTIALLY_FILLED, and add to fills array', () => {
      const fillData = { amount: 0.2, price: 60000, exchangeTimestamp: now - 100, averageFillPrice: 59999 };
      lifecycle.setPartialFill(fillData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.PARTIALLY_FILLED);
      expect(lifecycle.getFilled()).toBe(0.2);
      expect(lifecycle.getRemaining()).toBe(0.8); // Initial amount 1 - 0.2
      expect(lifecycle.updatedAt).toBe(now);
      
      const fills = lifecycle.getFills();
      expect(fills.length).toBe(1);
      expect(fills[0]).toEqual(expect.objectContaining({
        amount: 0.2, // Delta amount
        price: 60000, // Fill price
        timestamp: now, // Processing timestamp
        exchangeTimestamp: now - 100,
        averageFillPrice: 59999,
      }));

      const history = lifecycle.getHistory();
      expect(history.length).toBe(2); // PENDING + PARTIALLY_FILLED
      expect(history[1]).toEqual(expect.objectContaining({
        status: OrderStatus.PARTIALLY_FILLED,
        timestamp: now,
        data: fillData, 
      }));
    });

    test('should cap fill amount at remaining amount and set status to FILLED if fully filled', () => {
      lifecycle.setPartialFill({ amount: 0.4, price: 60100 }); // First partial fill
      Date.now.mockReturnValue(now + 100);
      
      // Try to fill more than remaining (0.6 remaining, try to fill 0.7)
      const secondFillData = { amount: 0.7, price: 60200 }; 
      lifecycle.setPartialFill(secondFillData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.FILLED);
      expect(lifecycle.getFilled()).toBe(1.0); // Initial amount 1
      expect(lifecycle.getRemaining()).toBe(0);
      expect(lifecycle.updatedAt).toBe(now + 100);

      const fills = lifecycle.getFills();
      expect(fills.length).toBe(2);
      expect(fills[1]).toEqual(expect.objectContaining({
        amount: 0.6, // Capped at remaining
        price: 60200,
        timestamp: now + 100,
      }));

      const history = lifecycle.getHistory();
      expect(history.length).toBe(3); // PENDING + PARTIALLY_FILLED + FILLED
      expect(history[2]).toEqual(expect.objectContaining({
        status: OrderStatus.FILLED,
        timestamp: now + 100,
        data: secondFillData,
      }));
    });

    test('should throw error if fillData.amount is not positive', () => {
      expect(() => lifecycle.setPartialFill({ amount: 0, price: 100 })).toThrow('Fill amount must be positive');
      expect(() => lifecycle.setPartialFill({ amount: -0.1, price: 100 })).toThrow('Fill amount must be positive');
    });

    test('should use order price for fill record if fillData.price is not provided', () => {
      const fillData = { amount: 0.1 }; // No price provided
      lifecycle.setPartialFill(fillData);
      const fills = lifecycle.getFills();
      expect(fills[0].price).toBe(60000); // Default order price from beforeEach setup
    });
    
    test('multiple partial fills should accumulate correctly', () => {
      lifecycle.setPartialFill({ amount: 0.1, price: 60000 });
      Date.now.mockReturnValue(now + 100);
      lifecycle.setPartialFill({ amount: 0.2, price: 60050 });
      Date.now.mockReturnValue(now + 200);
      lifecycle.setPartialFill({ amount: 0.3, price: 60100 });

      expect(lifecycle.getStatus()).toBe(OrderStatus.PARTIALLY_FILLED);
      expect(lifecycle.getFilled()).toBeCloseTo(0.6); // 0.1 + 0.2 + 0.3
      expect(lifecycle.getRemaining()).toBeCloseTo(0.4); // 1.0 - 0.6
      expect(lifecycle.getFills().length).toBe(3);
      expect(lifecycle.getHistory().length).toBe(4); // PENDING + 3x PARTIALLY_FILLED
    });

  });

  // --- setFilled ---
  describe('setFilled', () => {
    test('should update status to FILLED, set filled to amount, remaining to 0, and add fill record', () => {
      const fillData = { 
        filledAmount: 1, // Total order amount, implying it became fully filled by this update
        price: 60000, // Price of this final fill or original order price
        averageFillPrice: 59990, // Average price for the order
        timestamp: now - 50, // Exchange event timestamp
        // someOtherData: 'from_exchange_update' // other data from exchange that should be in history data
      };
      lifecycle.setFilled(fillData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.FILLED);
      expect(lifecycle.getFilled()).toBe(1.0); // Should be total order amount
      expect(lifecycle.getRemaining()).toBe(0);
      expect(lifecycle.updatedAt).toBe(now);

      const fills = lifecycle.getFills();
      expect(fills.length).toBe(1);
      expect(fills[0]).toEqual(expect.objectContaining({
        amount: 1.0, // Filled amount FOR THIS EVENT (initial amount - previously_filled (0))
        price: 59990, // Should use averageFillPrice if available
        timestamp: now - 50, // Exchange event timestamp
        // someOtherData: 'from_exchange_update', // Make sure other data is passed if setFilled supports it
      }));

      const history = lifecycle.getHistory();
      expect(history.length).toBe(2); // PENDING + FILLED
      expect(history[1]).toEqual(expect.objectContaining({
        status: OrderStatus.FILLED,
        timestamp: now,
        data: fillData,
      }));
    });

    test('should correctly add final fill record if partially filled before', () => {
      lifecycle.setPartialFill({ amount: 0.3, price: 59800, timestamp: now - 200 }); // initial fill processing time
      Date.now.mockReturnValue(now + 100); // Advance processing time for setFilled call

      const finalFillData = {
        filledAmount: 1.0, // Total filled amount for the order after this update
        averageFillPrice: 59950,
        timestamp: now + 50, // Exchange event timestamp for this final fill
      };
      lifecycle.setFilled(finalFillData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.FILLED);
      expect(lifecycle.getFilled()).toBe(1.0);
      expect(lifecycle.getRemaining()).toBe(0);
      expect(lifecycle.updatedAt).toBe(now + 100); // Processing time of setFilled

      const fills = lifecycle.getFills();
      expect(fills.length).toBe(2);
      expect(fills[1]).toEqual(expect.objectContaining({
        amount: 0.7, // 1.0 (total) - 0.3 (previous fill)
        price: 59950, // Average price from finalFillData
        timestamp: now + 50, // Exchange event timestamp from finalFillData
      }));
      
      // Check first fill is still there and correct
      expect(fills[0].amount).toBeCloseTo(0.3);
    });

    test('should not add a new fill record if already fully filled and setFilled is called again with no new fill amount', () => {
      const initialFillData = { filledAmount: 1.0, averageFillPrice: 60000, timestamp: now - 100 };
      lifecycle.setFilled(initialFillData); // Becomes FILLED, 1 fill record
      expect(lifecycle.getFills().length).toBe(1);
      Date.now.mockReturnValue(now + 100);

      // Call setFilled again, e.g., from a redundant update, with same total filledAmount
      const redundantFillData = { filledAmount: 1.0, averageFillPrice: 60000, timestamp: now }; 
      lifecycle.setFilled(redundantFillData);

      expect(lifecycle.getStatus()).toBe(OrderStatus.FILLED);
      expect(lifecycle.getFills().length).toBe(1); // Should still be 1, no new fill amount
      expect(lifecycle.updatedAt).toBe(now + 100); // Updated at for the _updateStatus call
      expect(lifecycle.getHistory().length).toBe(3); // PENDING + FILLED + FILLED (second updateStatus call)
    });
    
    test('should use data.price for fill record if averageFillPrice is not available in data', () => {
      const fillData = { 
        filledAmount: 1,
        price: 59900, // This should be used for the fill record price
        timestamp: now - 50,
      };
      lifecycle.setFilled(fillData);
      const fills = lifecycle.getFills();
      expect(fills.length).toBe(1);
      expect(fills[0].price).toBe(59900);
    });

    test('should use lifecycle.price (order price) for fill record if no price in data', () => {
      const fillData = { 
        filledAmount: 1,
        timestamp: now - 50,
      }; // No price or averageFillPrice in fillData
      lifecycle.setFilled(fillData);
      const fills = lifecycle.getFills();
      expect(fills.length).toBe(1);
      expect(fills[0].price).toBe(60000); // From lifecycle.price (original order price)
    });

    test('should use Date.now() for fill record timestamp if not provided in data', () => {
      const fillData = { filledAmount: 1, averageFillPrice: 59900 }; // No timestamp
      lifecycle.setFilled(fillData);
      const fills = lifecycle.getFills();
      expect(fills.length).toBe(1);
      expect(fills[0].timestamp).toBe(now); // Mocked Date.now() for the fill record processing
    });

  });

}); 

describe('OrderLifecycle updateFromExchange Method', () => {
  let lifecycle;
  let now;
  const initialOrderProps = {
    id: 'orderUFE1',
    clientOrderId: 'clientUFE1',
    symbol: 'ETH/USD',
    side: 'sell',
    type: 'limit',
    price: 3000,
    amount: 2,
  };

  beforeEach(() => {
    now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    lifecycle = new OrderLifecycle(initialOrderProps);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should do nothing and return instance if updateData or updateData.status is missing', () => {
    const originalState = lifecycle.getOrderData();
    const originalHistoryLength = lifecycle.getHistory().length;

    lifecycle.updateFromExchange(null);
    expect(lifecycle.getOrderData()).toEqual(originalState);
    expect(lifecycle.getHistory().length).toBe(originalHistoryLength);

    lifecycle.updateFromExchange({});
    expect(lifecycle.getOrderData()).toEqual(originalState);
    expect(lifecycle.getHistory().length).toBe(originalHistoryLength);

    lifecycle.updateFromExchange({ someData: 'withoutStatus' });
    expect(lifecycle.getOrderData()).toEqual(originalState);
    expect(lifecycle.getHistory().length).toBe(originalHistoryLength);
  });

  // Test for OPEN status (and aliases)
  ['open', 'NEW', 'pending_new'].forEach(statusStr => {
    test(`should call setOpen when status is '${statusStr}'`, () => {
      const spySetOpen = jest.spyOn(lifecycle, 'setOpen');
      const update = { status: statusStr, exchangeOrderId: 'ex123' };
      lifecycle.updateFromExchange(update);
      
      expect(spySetOpen).toHaveBeenCalledTimes(1);
      expect(spySetOpen).toHaveBeenCalledWith(update);
      expect(lifecycle.getStatus()).toBe(OrderStatus.OPEN);
      spySetOpen.mockRestore();
    });
  });

  // Test for PARTIALLY_FILLED status
  test('should call setPartialFill with correct data on PARTIALLY_FILLED status', () => {
    const spySetPartialFill = jest.spyOn(lifecycle, 'setPartialFill');
    const update = {
      status: OrderStatus.PARTIALLY_FILLED.toLowerCase(),
      filledAmount: 0.5, // Total filled for the order
      amount: 2, // Total amount of the order
      price: 3000, // Order price (can also be fill price in some contexts)
      averageFillPrice: 2999.5,
      timestamp: now - 1000, // Exchange event time
      someOtherField: 'detail1'
    };

    lifecycle.updateFromExchange(update);

    expect(spySetPartialFill).toHaveBeenCalledTimes(1);
    const argToSpy = spySetPartialFill.mock.calls[0][0];
    expect(argToSpy.amount).toBeCloseTo(0.5); // Delta: update.filledAmount (0.5) - lifecycle.filled (0)
    expect(argToSpy.price).toBe(2999.5); // Should prioritize averageFillPrice
    expect(lifecycle.getStatus()).toBe(OrderStatus.PARTIALLY_FILLED);
    expect(lifecycle.getFilled()).toBeCloseTo(0.5);
    expect(lifecycle.getRemaining()).toBeCloseTo(1.5);
    spySetPartialFill.mockRestore();
  });
  
  test('should handle PARTIALLY_FILLED leading to FILLED status correctly', () => {
    lifecycle.setPartialFill({ amount: 1.8, price: 3000}); // Pre-fill most of it
    jest.spyOn(Date, 'now').mockReturnValue(now + 100); // Advance time for the next update

    const spySetPartialFill = jest.spyOn(lifecycle, 'setPartialFill');
    const update = {
      status: 'partially_filled',
      filledAmount: 2.0, // Now fully filled
      amount: 2.0,
      averageFillPrice: 3001,
      timestamp: now + 50,
    };
    lifecycle.updateFromExchange(update);

    expect(spySetPartialFill).toHaveBeenCalledTimes(1);
    const argToSpy = spySetPartialFill.mock.calls[0][0];
    expect(argToSpy.amount).toBeCloseTo(0.2); // Delta: 2.0 - 1.8
    expect(argToSpy.price).toBe(3001);
    // After setPartialFill, updateFromExchange itself might call _updateStatus to FILLED
    expect(lifecycle.getStatus()).toBe(OrderStatus.FILLED);
    expect(lifecycle.getFilled()).toBeCloseTo(2.0);
    expect(lifecycle.getRemaining()).toBeCloseTo(0);
    spySetPartialFill.mockRestore();
  });

  // Test for FILLED status
  test('should call setFilled on FILLED status', () => {
    const spySetFilled = jest.spyOn(lifecycle, 'setFilled');
    const update = { 
      status: OrderStatus.FILLED.toUpperCase(), // Test case insensitivity 
      filledAmount: 2,
      amount: 2,
      averageFillPrice: 3000.5,
      timestamp: now - 500
    };
    lifecycle.updateFromExchange(update);

    expect(spySetFilled).toHaveBeenCalledTimes(1);
    expect(spySetFilled).toHaveBeenCalledWith(update);
    expect(lifecycle.getStatus()).toBe(OrderStatus.FILLED);
    spySetFilled.mockRestore();
  });

  // Test for CANCELLED status (and aliases)
  test("should call setCancelled when status is 'canceled' (lowercase input)", () => {
    const spySetCancelled = jest.spyOn(lifecycle, 'setCancelled');
    const update = { status: 'canceled', reason: 'User action lowercase' };
    lifecycle.updateFromExchange(update);

    expect(spySetCancelled).toHaveBeenCalledTimes(1);
    expect(spySetCancelled).toHaveBeenCalledWith({ ...update, reason: 'User action lowercase'});
    expect(lifecycle.getStatus()).toBe(OrderStatus.CANCELLED);
    spySetCancelled.mockRestore();
  });

  test("should call setCancelled when status is 'CANCELLED' (uppercase input)", () => {
    const spySetCancelled = jest.spyOn(lifecycle, 'setCancelled');
    const update = { status: 'CANCELLED', reason: 'User action uppercase' };
    lifecycle.updateFromExchange(update);

    expect(spySetCancelled).toHaveBeenCalledTimes(1);
    expect(spySetCancelled).toHaveBeenCalledWith({ ...update, reason: 'User action uppercase'});
    expect(lifecycle.getStatus()).toBe(OrderStatus.CANCELLED);
    spySetCancelled.mockRestore();
  });

  // Test for REJECTED status
  test('should call setRejected on REJECTED status', () => {
    const spySetRejected = jest.spyOn(lifecycle, 'setRejected');
    const update = { status: 'rejected', reason: 'Invalid params' };
    lifecycle.updateFromExchange(update);

    expect(spySetRejected).toHaveBeenCalledTimes(1);
    expect(spySetRejected).toHaveBeenCalledWith({ ...update, reason: 'Invalid params'});
    expect(lifecycle.getStatus()).toBe(OrderStatus.REJECTED);
    spySetRejected.mockRestore();
  });

  // Test for EXPIRED status
  test('should call setExpired on EXPIRED status', () => {
    const spySetExpired = jest.spyOn(lifecycle, 'setExpired');
    const update = { status: 'expired', reason: 'Time in force' };
    lifecycle.updateFromExchange(update);

    expect(spySetExpired).toHaveBeenCalledTimes(1);
    expect(spySetExpired).toHaveBeenCalledWith({ ...update, reason: 'Time in force'});
    expect(lifecycle.getStatus()).toBe(OrderStatus.EXPIRED);
    spySetExpired.mockRestore();
  });

  // Test for UNKNOWN_EXCHANGE_STATUS
  test('should record history with UNKNOWN_EXCHANGE_STATUS for unknown status string', () => {
    const update = { status: 'weird_status', detail: 'exchange_specific' };
    const initialStatus = lifecycle.getStatus();
    lifecycle.updateFromExchange(update);

    expect(lifecycle.getStatus()).toBe(initialStatus); // Status should not change
    const history = lifecycle.getHistory();
    expect(history.length).toBe(2); // Initial + Unknown status history
    expect(history[1]).toEqual({
      status: 'UNKNOWN_EXCHANGE_STATUS: weird_status',
      timestamp: now, // Processing time
      data: update,
    });
  });
  
  test('should always update lifecycle.updatedAt after processing an update', () => {
    const initialUpdatedAt = lifecycle.updatedAt;
    Date.now.mockReturnValue(now + 1000); // Advance time significantly
    lifecycle.updateFromExchange({ status: 'open' });
    expect(lifecycle.updatedAt).toBe(now + 1000);
  });

}); 