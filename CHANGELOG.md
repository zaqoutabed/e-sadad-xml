# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [semantic versioning](https://semver.org/).

## [0.4.0] - 2026-11-26

### Added

- **Authentication API** (`POST /authentication`), from the E-SADAD Authentication API document. Set `authentication: { user, secret }`:
  - verifies E-SADAD's signature (RSA SHA-256 PKCS#1 v1.5 over the UTF-8 `data` values joined with `|`; compact JSON is accepted too);
  - rejects a `tranTimestamp` more than 10 minutes from the server clock;
  - checks the shared credentials in constant time;
  - answers with a signed token (`SHA-256(user:tranTimestamp:UUID)`, 7 days).
    Errors are signed JSON (400, 401, 500).
- `esadad.authenticate(body)`, `esadad.verifyAccessToken(token)`, `esadad.authenticationEnabled`.
- `AccessTokenStore` interface and `InMemoryAccessTokenStore`. Stores receive only the SHA-256 hash of each token.
- Express: the `/authentication` route (only when configured) and the `requireAccessToken` option, which requires `Authorization: Bearer <token>` on the XML routes.
- `signData`/`verifyData` take an optional `encoding` (`'utf16le'` default, `'utf8'`); `CertificateSigner` has `signUtf8`/`verifyUtf8`; `MessageSigner` has optional `signUtf8`/`verifyUtf8`.
- `authSigningString()` and `hashAccessToken()` exports.
- Guide page `docs/13-authentication.md` and an Arabic section.

## [0.3.0] - 2026-11-15

### Fixed

- **Possible double payment:** when a payment was posted to the billing system but saving the "posted" flag failed, the library answered with an error, so E-SADAD retried and the payment could be posted twice. The flag write is now retried; if it still fails the library answers Success, logs an error, and remembers the payment for the life of the process.
- **UTF-16 request bodies** (with or without a BOM) are now decoded correctly. The Express router reads raw bytes and honours the Content-Type charset; an unknown charset still answers 415.

### Added

- `adapterTimeoutMs`: time limit for the read-only adapter calls (`getBills`, `validatePrepaid`). Never applied to `postPayment`.
- `decodeXmlBody()` and `UnsupportedCharsetError` exports.
- Dependabot configuration for weekly dependency and GitHub Actions updates.
- Tests: UTF-16 bodies, adapter timeouts, the availability client against misbehaving servers, and a new golden vector from the Python reference (processing instructions, redeclared namespaces).

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
