# Installation

[← README](../README.md) · [Merchant guide](MERCHANT-GUIDE.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Requirements

- An SFRA storefront (`app_storefront_base`) on Salesforce B2C Commerce.
- Node.js 22 or later to build and test.

## 1. Build

```sh
npm ci
npm run validate          # lint, 18 unit tests, builds cartridge/static/default/js/loyalty.js
npm run package:metadata  # dist/loyalty-program-metadata.zip
```

## 2. Deploy the cartridge

Upload `cartridges/plugin_loyalty`, including the generated `cartridge/static`:

```sh
npx sgmf-scripts --uploadCartridge plugin_loyalty
```

`dw.example.json` shows the expected `dw.json` fields. Keep `dw.json` out of Git.

## 3. Cartridge path

Put the cartridge first:

```text
plugin_loyalty:app_storefront_base
```

With other overlays, keep `plugin_loyalty` leftmost. These chain to the next cartridge through `module.superModule`:

- `Checkout`, `CheckoutServices` and `Order` controllers;
- `basketCalculationHelpers` and `checkoutHelpers`;
- `config/oAuthRenentryRedirectEndpoints` (login slot `5`).

`checkout/orderTotalSummary.isml` is an SFRA copy with one include. If another cartridge overrides it, merge the include into that copy.

## 4. Import metadata

| File | Contents |
| --- | --- |
| `meta/custom-objecttype-definitions.xml` | `LoyaltyAccount`, `LoyaltyLedger`, `LoyaltyLot`, `LoyaltyOrder` |
| `meta/system-objecttype-extensions.xml` | Basket `loyaltyPointsRequested`, `loyaltyPointsApplied`; Order `loyaltyPointsRedeemed`; the **Loyalty Program** site preferences |
| `jobs.xml` | `Loyalty-ProcessOrders`, `Loyalty-Maintain` |
| `sites/RefArch/preferences.xml` | `LoyaltyEnabled = true` |

1. Rename `sites/RefArch` to your site ID and set `site-id` in `jobs.xml`.
2. `npm run package:metadata`.
3. **Administration → Site Development → Site Import & Export**: import `dist/loyalty-program-metadata.zip`.

## 5. Footer link

Add to the `footer-account` content asset:

```html
<li><a href="$url('Loyalty-Show')$">My Points</a></li>
```

## 6. Jobs

| Job | Schedule |
| --- | --- |
| `Loyalty-ProcessOrders` | Every 30 minutes |
| `Loyalty-Maintain` | Daily, early morning (birthday bonuses use the UTC date) |

## 7. Check

1. Sign in and open My Points: 100 welcome points.
2. Check out: the panel offers up to 100 points; apply them, and the Order Discount shows −10.
3. Mark the order Paid and its shipment Shipped. Run `Loyalty-ProcessOrders` twice, after `LoyaltyReturnWindowDays`: the earned points appear.
