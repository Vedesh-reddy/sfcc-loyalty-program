# Architecture

[← README](../README.md) · [Code reference](CODE-REFERENCE.md)

## Principles

- **Overlay only.** No SFRA file is edited.
  - Controllers extend base routes with `server.append` / `server.prepend`.
  - `basketCalculationHelpers`, `checkoutHelpers` and the login endpoint map wrap `module.superModule`.
  - One template, `checkout/orderTotalSummary.isml`, is an SFRA copy with one include.
- **Native discount.** Redeemed points are a custom order price adjustment (`loyalty-points`). Promotions, tax proration and order totals keep working unchanged.
- **Ledger, not a counter.** Every balance change is an immutable ledger entry, and the balance always equals the sum of open lots.
- **Bounded storefront work.** Storefront requests read by key; lists and jobs read bounded pages and close iterators in `finally`.

## Request flows

```text
Checkout-Begin (append) → loyaltyCheckout view data → orderTotalSummary.isml → points panel
Loyalty-Apply / -Remove (AJAX, CSRF) → basket.loyaltyPointsRequested → calculateTotals

basketCalculationHelpers.calculateTotals (wrapper)
  base.calculateTotals(basket)
  syncBasket: usable = min(requested, balance, 50% cap), 0 below the 100-point minimum
            → loyalty-points price adjustment = -usable / 10, basket.loyaltyPointsApplied
  base.calculateTotals(basket) again only when the adjustment changed

CheckoutServices-PlaceOrder (prepend) → refuse with a message if the balance fell below the applied points
checkoutHelpers.createOrder   → base.createOrder → reserve: debit lots FIFO + LoyaltyOrder CREATED
                                (debit fails → failOrder, no discounted order)
checkoutHelpers.handlePayments → on error: refund
checkoutHelpers.placeOrder     → on error: refund; on success: LoyaltyOrder PENDING with pending points
Order-Confirm (append)         → "You will earn N points" note
```

## Ledger and lots

```text
LoyaltyAccount (customerNo)          balance = Σ open lots, pending, tier, spend12m, sequence
 ├─ LoyaltyLedger (customerNo:000001…) EARN | BONUS | REDEEM | REFUND | EXPIRE, points, balanceAfter
 └─ LoyaltyLot (source key)           points, remaining, expiresAt
      ORDER:<orderNo> · WELCOME:<customer> · BIRTHDAY:<customer>:<year> · PROFILE:<customer> · REVIEW:<review>
```

- **Credit:** creates a lot keyed by its source and posts EARN or BONUS. The same source can only be credited once.
- **Debit:** consumes open lots by `expiresAt` ascending and posts REDEEM, keeping the consumed lots on the order.
- **Refund:** puts the consumed points back into the same lots (their expiry unchanged) and posts REFUND.
- **Expire:** zeroes a lot's remainder and posts EXPIRE.

## Concurrency

Each post increments `LoyaltyAccount.sequence` and creates the ledger entry `customerNo:<next sequence>` in the same transaction. Two requests that read the same balance both try to create the same ledger key, and the second transaction fails and rolls back. The balance is therefore never lost or spent twice:

- **Checkout:** the order is failed instead of discounted.
- **Jobs:** the record is retried on the next run.

Bonus keys and order lot keys make job retries idempotent.

## Order state machine

```text
LoyaltyOrder CREATED (points reserved)
  ├─ payment or placement failed ──→ FAILED, points refunded
  └─ placed ───────────────────────→ PENDING (pendingPoints at the tier rate)

LoyaltyOrder PENDING
  ├─ order cancelled or failed ────→ CANCELLED/FAILED, redeemed points refunded, pending dropped
  ├─ not paid / not shipped ───────→ waits, reviewReason NOT_PAID / NOT_DELIVERED
  ├─ first seen shipped ───────────→ deliveredAt recorded
  ├─ inside the return window ─────→ waits, RETURN_WINDOW
  └─ otherwise ────────────────────→ AVAILABLE: lot ORDER:<no> credited (less returned items), tier re-evaluated
```

"Shipped" means the order status, or every shipment's status, is Shipped. Business Manager usually sets it per shipment.

## Security and privacy

- Every POST validates CSRF. Points are only read from and written to the authenticated customer's own account, which the server derives from the session, never from the request.
- Redemption is re-checked on the server three times: in basket calculation, in the `PlaceOrder` prepend, and when points are reserved at order creation.
- Logs use `Logger.getLogger('loyalty-program', <category>)` and record order numbers and customer numbers, never emails or payment data.
