# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [semantic versioning](https://semver.org/).

## [0.2.0] - 2026-11-14

### Added

- **Config tables and config file:** `configFromTables()` and `loadConfigFile()` build `biller`, `services` and `certificates` from the Biller, Services and Certificates tables described in the integration document. They use the document's column names (case- and underscore-insensitive), convert database string values, resolve `env:NAME` secrets, and resolve relative certificate paths.
- **Hooks:** `hooks.onPaymentPosted` (for example SMS or e-mail after a payment, never for retries) and `hooks.onRequestCompleted` (metrics and alerts). Both run in the background and never delay or change the response.
- `canonicalMsgBody()` accepts an XML string.
- User guide in `docs/` and many new examples: post-paid, multiple services, Fastify, ESM JavaScript, custom signer, PostgreSQL store, E-SADAD simulator, adapter tests, config from file and database, hooks.
- Tooling: ESLint, Prettier, EditorConfig, a coverage script, and CI steps for lint and format.

### Changed

- Transaction and payment logs record the service currency when the request does not include `<Currency>`, so the `Currency` column is always filled.
- `examples/dev-keys.sh` ships with the package.
- The Express router is tested against both Express 4 and Express 5.

### Fixed

- A literal byte-order-mark character in the XML parser source was replaced with its `﻿` escape. Behaviour is unchanged.

## [0.1.0] - 2026-11-12

### Added

- First release: BillPull, PrepaidValidation, ReceivePaymentNotification and Availability Check.
- `MsgBody` signing and verification compatible with the E-SADAD reference implementation.
- Request/response and payment logs, payment posting that is idempotent on `JOEBPPSTrx`, Express router, in-memory and SQL Server stores, and CommonJS + ESM builds with types.
