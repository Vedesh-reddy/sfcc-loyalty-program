# Merchant guide

[← README](../README.md) · [Installation](INSTALLATION.md)

## Site preferences

**Merchant Tools → Site Preferences → Custom Preferences → Loyalty Program**

| Preference | Default | Effect |
| --- | --- | --- |
| `LoyaltyEnabled` | false | Switches the page, checkout panel, earning and redemption |
| `LoyaltyPointsPerCurrencyUnit` | 10 | Points worth 1 in the order currency |
| `LoyaltyMinRedeemPoints` | 100 | Balance needed before points can be used |
| `LoyaltyMaxRedeemPercent` | 50 | Largest share of the merchandise total points can pay |
| `LoyaltyEarnPercentSilver` | 5 | Value earned as points, % of the net product price |
| `LoyaltyEarnPercentGold` | 7 | Gold rate |
| `LoyaltyEarnPercentPlatinum` | 10 | Platinum rate |
| `LoyaltyGoldThreshold` | 1000 | Delivered spend in 12 months for Gold |
| `LoyaltyPlatinumThreshold` | 2500 | Delivered spend in 12 months for Platinum |
| `LoyaltyReturnWindowDays` | 7 | Days after delivery before points become available |
| `LoyaltyExpiryMonths` | 12 | Lifetime of credited points |
| `LoyaltyExpiryReminderDays` | 30 | Reminder lead time |
| `LoyaltyWelcomeBonus` | 100 | On opening the account |
| `LoyaltyBirthdayBonus` | 200 | On the profile birthday, once a year |
| `LoyaltyProfileBonus` | 50 | When name, phone, birthday and an address are present |
| `LoyaltyReviewBonus` | 50 | Per approved `plugin_productreviews` review |

Set a bonus to 0 to switch it off. Changing an earn rate affects orders placed afterwards; pending orders keep the rate they were placed at.

## Worked example

A Silver member buys a $100 product with a $10 promotion:

- **Net product price:** $90.
- **Points earned:** $90 × 5% × 10 = 45 points, worth $4.50.

With 300 points on a $40 order:

- **Usable:** min(300, 50% of $40 = 200 points) = 200 points, a $20 discount.
- **Points earned on the rest:** $20 × 5% × 10 = 10 points.

## Jobs

| Job | What to expect |
| --- | --- |
| `Loyalty-ProcessOrders` | Records delivery on the first run that sees the order shipped, and releases points on a later run after the return window. Refunds cancelled or failed orders. |
| `Loyalty-Maintain` | Expires points, sends reminders, re-evaluates every tier (downgrades included), awards birthday, profile and review bonuses. |

Status `ERROR` means at least one record failed; the reason is in the `loyalty-program` log, and the record is retried on the next run.

## Custom objects

**Merchant Tools → Custom Objects → Custom Object Editor**

| Type | Use it to |
| --- | --- |
| `LoyaltyAccount` | See a member's balance, pending points, tier and 12-month spend |
| `LoyaltyLedger` | Audit every movement with the balance after it |
| `LoyaltyLot` | See which points expire when |
| `LoyaltyOrder` | See an order's redeemed and earned points, `status` and `reviewReason` (`NOT_PAID`, `NOT_DELIVERED`, `RETURN_WINDOW`, `NOT_PLACED`) |

Do not edit balances, ledgers or lots by hand. The balance must equal the sum of open lots.

## Orders

| Order state | Points |
| --- | --- |
| Payment or placement failed | Redeemed points returned immediately |
| Cancelled | Redeemed points returned; nothing earned |
| Paid, and the order or every shipment Shipped | Points released after the return window |
| Items returned before release | Points earned only on the items kept |
