# Troubleshooting

[← README](../README.md) · [Installation](INSTALLATION.md)

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Loyalty-Show` returns 404 | `LoyaltyEnabled` is off | Turn it on in the Loyalty Program preferences |
| `Type does not exist: LoyaltyAccount` | Metadata not imported | Import `dist/loyalty-program-metadata.zip` |
| No points panel at checkout | Another cartridge overrides `checkout/orderTotalSummary.isml` earlier in the path | Merge the panel include into that override |
| "Use points" does nothing | `loyalty.js` not built or not uploaded | `npm run build` and upload `cartridge/static` |
| Panel says to collect more points | Balance below `LoyaltyMinRedeemPoints` | Expected |
| Fewer points usable than the balance | `LoyaltyMaxRedeemPercent` cap on the merchandise total | Expected; raise the percentage if wanted |
| Points stay pending | `LoyaltyOrder.reviewReason`: `NOT_PAID`, `NOT_DELIVERED` or `RETURN_WINDOW` | Set Payment Status Paid and the shipment (or order) Shipped; wait the return window; run `Loyalty-ProcessOrders` |
| "Your points balance changed" at place order | Points were spent in another session after they were applied | Expected; the shopper re-applies points |
| Birthday bonus missing | Birthday not on the profile, or `Loyalty-Maintain` did not run that UTC day | Check the profile and the job schedule |
| Review bonus missing | Review not approved, approved more than 2 days before the job ran, or `plugin_productreviews` not installed | Run the job daily |
| Job ends with `ERROR` | A record failed; see the `loyalty-program` log | Fix the cause; the next run retries |
