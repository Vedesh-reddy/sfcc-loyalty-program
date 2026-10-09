# Attribution and terms

This repository contains the `plugin_loyalty` extension developed by Vedesh Reddy for
Salesforce Storefront Reference Architecture (SFRA) storefronts, plus one template overlay
derived from SFRA. It is an SFRA extension, not an official Salesforce product.

`checkout/orderTotalSummary.isml` is adapted from the SFRA template, adding one include.

The cartridge also wraps SFRA's `basketCalculationHelpers`, `checkoutHelpers` and
`oAuthRenentryRedirectEndpoints` through `module.superModule`, and uses SFRA's `server`
module, middleware and helpers. The applicable Salesforce terms are preserved in
[SFRA-TERMS.txt](licenses/SFRA-TERMS.txt).

No MIT, Apache, or other open-source license is granted by this repository.
The npm package is marked private and `UNLICENSED`; it is not intended for npm publication.

Screenshots were captured on the author's sandbox on October 9, 2026.
Salesforce and Commerce Cloud names belong to their respective owners.
