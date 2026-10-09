# Development phases

[← README](../README.md)

The working implementation is organized into five reviewable delivery phases. These branches describe the repository's packaging and review structure; they do not claim to reproduce the original chronological development history.

Each phase has a dedicated feature branch and PR targeting `main`. Phases are merged in order, keeping their branches and merge commits for reference.

| Phase | Feature branch | Scope | Pull request |
| --- | --- | --- | --- |
| 01 · Foundation | `feature/phase-01-foundation` | Cartridge identity, job step types, custom objects, attributes, preferences, jobs | [PR #1](https://github.com/Vedesh-reddy/sfcc-loyalty-program/pull/1) |
| 02 · Ledger and jobs | `feature/phase-02-ledger-jobs` | Ledger and lots, earning, redemption, refunds, tiers, bonuses, wrappers, job steps, unit tests | [PR #2](https://github.com/Vedesh-reddy/sfcc-loyalty-program/pull/2) |
| 03 · Storefront | `feature/phase-03-storefront` | My Points, checkout panel, confirmation note, login slot, templates, browser module | [PR #3](https://github.com/Vedesh-reddy/sfcc-loyalty-program/pull/3) |
| 04 · Tooling and quality | `feature/phase-04-tooling-quality` | npm dependencies, build, lint checks, metadata ZIP, GitHub Actions, PR template | [PR #4](https://github.com/Vedesh-reddy/sfcc-loyalty-program/pull/4) |
| 05 · Documentation | `feature/phase-05-documentation` | Per-feature README with highlighted screenshots, guides, contributing guide, attribution | [PR #5](https://github.com/Vedesh-reddy/sfcc-loyalty-program/pull/5) |

The same cartridge is integrated in [SFCC-RefArch](https://github.com/Vedesh-reddy/SFCC-RefArch) through PRs #29–#32.

## Review order

1. Start with the metadata.
2. Then read `loyaltyHelper.js`: `post`, `credit`, `debit`, `restore` and `usable` are the money rules.
3. Next, `loyaltyOrderHelper.js` for the order state machine.
4. Then the `basketCalculationHelpers` and `checkoutHelpers` wrappers.
5. Finish with the controllers and templates.

The final `main` branch contains all five phases. Build output is generated locally or downloaded from a successful GitHub Actions run; it is not committed.
