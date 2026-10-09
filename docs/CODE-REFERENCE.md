# Code reference

[← README](../README.md) · [Architecture](ARCHITECTURE.md) · [Testing](TESTING.md)

All paths are under `cartridges/plugin_loyalty/cartridge`.

## Controller routes

| Route | Method | Middleware | Behavior |
| --- | --- | --- | --- |
| `Loyalty-Show` | GET | HTTPS, program on | My Points for signed-in customers (opens the account and the welcome bonus); program rules and sign-in (`rurl=5`) otherwise |
| `Loyalty-Apply` | POST | HTTPS, AJAX CSRF, program on | Sets `loyaltyPointsRequested` and recalculates; JSON error if no points can be used |
| `Loyalty-Remove` | POST | HTTPS, AJAX CSRF, program on | Clears the requested points and recalculates |
| `Checkout-Begin` | append | — | `loyaltyCheckout` view data |
| `CheckoutServices-PlaceOrder` | prepend | — | Refuses with a message when the balance no longer covers the applied points |
| `Order-Confirm` | append | — | `loyaltyConfirmation` with pending and redeemed points |

## Script modules

### `scripts/helpers/loyaltyHelper.js`

| Export | Purpose |
| --- | --- |
| `pref(name)` / `enabled()` | Preferences with documented defaults; program switch |
| `earnPercent(tier)` / `tierFor(spend)` | Tier rate; tier from 12-month spend |
| `pointsFor(value, tier)` / `valueOf(points)` | Earn maths in integer cents; points to currency |
| `usable(requested, balance, merchandise)` | Minimum, balance and percentage cap |
| `getAccount` / `ensureAccount(customerNo)` | Account lookup; opens it with the welcome bonus |
| `post(account, entry)` | Ledger entry keyed `customerNo:sequence`; moves the balance (caller owns the transaction) |
| `credit` / `debit` / `restore` / `expire` | Lot operations (caller owns the transaction) |
| `spendFor` / `evaluateTier` | Rolling delivered spend and tier |
| `award(customerNo, key, source, points)` | Idempotent bonus in its own transaction |
| `query(...)` | Bounded custom object query; closes the iterator |

### `scripts/helpers/loyaltyOrderHelper.js`

| Export | Purpose |
| --- | --- |
| `syncBasket(basket)` | Applies the requested points as the `loyalty-points` order adjustment; returns whether it changed |
| `netProductValue(container)` | Sum of prorated product line prices |
| `reserve(order, points)` | Debits lots and creates `LoyaltyOrder` CREATED (caller owns the transaction) |
| `recordEarn(order)` | Pending points at the current tier; safe to call twice |
| `close(record, status)` / `refundFailed(order)` | Refund once, drop pending points |
| `evaluate(order, record, now)` | Pure decision: WAIT, RECORD, CLOSE, DELIVERED or RELEASE |
| `advance(record, now)` | Applies the decision (order job) |

### Wrappers

- `scripts/helpers/basketCalculationHelpers.js`: `calculateTotals` runs the base calculation, then `syncBasket`, and recalculates only when the discount changed.
- `scripts/checkout/checkoutHelpers.js`:
  - `createOrder` reserves points and fails the order if that fails;
  - `handlePayments` and `placeOrder` refund points on error;
  - `placeOrder` records the earn on success.
- `config/oAuthRenentryRedirectEndpoints.js`: login return slot `5` → `Loyalty-Show`.

## Job steps

| Step type | Module | Work per run |
| --- | --- | --- |
| `custom.Loyalty.ProcessOrders` | `scripts/jobs/processLoyaltyOrders.js` | Up to 500 CREATED or PENDING loyalty orders, oldest first |
| `custom.Loyalty.Maintain` | `scripts/jobs/maintainLoyalty.js` | Expire up to 2,000 lots; one reminder per customer; every account's tier, birthday and profile bonus; reviews approved in the last 2 days |

Both are `transactional: false` and return `ERROR` when any record failed.

## Templates

| Template | Rendered by |
| --- | --- |
| `loyalty/dashboard.isml` | `Loyalty-Show` |
| `loyalty/checkoutPanel.isml` | `orderTotalSummary.isml` at checkout |
| `loyalty/email/expiring.isml` | Expiry reminder |
| `checkout/orderTotalSummary.isml` | SFRA copy + panel (checkout) or note (confirmation) |

Text lives in `templates/resources/loyalty.properties`. `client/default/js/loyalty.js` posts the panel forms and reloads the checkout so every total is recalculated.
