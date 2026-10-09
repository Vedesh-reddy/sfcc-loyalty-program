# Testing and validation

[← README](../README.md) · [Code reference](CODE-REFERENCE.md)

## Repeatable local checks

```sh
npm ci
npm run validate          # lint (JS, ISML, docs links) + tests + build
npm run package:metadata  # dist/loyalty-program-metadata.zip
```

CI runs the same on Node 22 and 24 for every push and pull request.

## Unit tests (18)

`test/unit/plugin_loyalty/harness.js` is an in-memory Script API double. It provides:

- unique custom object keys and transaction rollback;
- `AND`/`OR`/`NULL` queries with sorting;
- baskets with order price adjustments;
- orders with shipments and return items;
- mail capture.

Scenarios that change points assert that the balance equals the sum of open lots.

| Area | Covers |
| --- | --- |
| Earning rules | 5% → points at 10 per unit, tier thresholds, minimum / balance / 50% cap |
| Ledger | Welcome bonus once, idempotent credits, soonest-expiry-first redemption, insufficient balance rolls back, ledger-key collision, expiry |
| Checkout | Discount within the cap and stable on recalculation, guests, reservation and a single refund |
| Orders | Pending at placement, payment and per-shipment delivery waits, return window, release, cancellation refund, returns (cancelled returns ignored), tier upgrade and the higher rate |
| Maintenance | Expiry, one reminder, birthday and profile bonuses |

## Sandbox checks behind the screenshots

Performed on sandbox `zyeu-002`, site `RefArch_Practice`, October 9, 2026.

The demo preferences were:

- return window 0 days;
- Gold from 40 delivered spend;
- Platinum from 500.

A headless browser drove every storefront step.

| Check | Result |
| --- | --- |
| Signed-out My Points, sign in via `rurl=5`, register | Returned to My Points with 100 welcome points |
| Guest checkout | "Sign in to earn about 20 points" |
| Checkout with 100 points | Panel offered 100; order 00000307 placed without points, 20 pending |
| Apply 100 points | −$10.00 Order Discount; earn preview dropped to 15; order 00000308 placed |
| New basket at 0 points | "Collect 100 more points" |
| 00000307 Paid, shipment Shipped; 00000308 cancelled; `Loyalty-ProcessOrders` twice | +20 earned, +100 refunded, pending 0, tier Gold |
| Birthday today, review approved; `Loyalty-Maintain` | +200 birthday, +50 profile, +50 review; balance 420 |
| Checkout at 420 points on $40.99 | Cap 204 points; Gold earn preview 28 |
| Order 00000311 | Confirmation: "You will earn 28 points" |

Not exercised live: expiry and the reminder email (unit tests cover both), and the concurrent-redemption failure path.

## Defects found on the sandbox and fixed

| Symptom | Cause | Fix |
| --- | --- | --- |
| My Points failed with `Cannot read property "currency"` | `request.session` is not available in that scope | Currency read from `req.session` |
| Ledger rows out of order | Bonuses created in the same second tie on creation date | Sorted by the zero-padded sequence key |
| "Up to 100 points (50% of your order)" read as if 100 were half the order | Message mixed the balance limit and the cap | Two clear sentences |
