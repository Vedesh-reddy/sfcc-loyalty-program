# Contributing

Start from `main` and create a focused `feature/`, `fix/`, or `docs/` branch. Keep behavior changes and documentation accurate together.

```sh
npm ci
npm run validate
npm run package:metadata
```

CI mocks cannot validate basket calculation, order placement, payment failures, mail delivery or metadata installation. For a platform behavior change, exercise the affected feature on a sandbox, following the sandbox checks in [docs/TESTING.md](docs/TESTING.md). In the PR, say which checks were automated and which were manual.

Preserve these rules:

- every balance change goes through `post`, so it is written to the ledger and serialized by the ledger key;
- every credit has a unique lot key (its source), so retries never double-credit;
- the balance equals the sum of open lots, and new tests assert it;
- redemption is enforced on the server in basket calculation, at place order and when points are reserved;
- every storefront post validates CSRF;
- custom object iterators are closed in `finally`.

Keep credentials and generated output out of Git. Add new attributes to both the metadata and the installation guide, and new text to `loyalty.properties`.

See [NOTICE.md](NOTICE.md) for attribution and terms.
