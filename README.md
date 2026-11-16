# e-sadad-xml

Node.js library for **E-SADAD biller integration**. It implements the endpoints E-SADAD calls on a biller:

| API                            | Purpose                                               | Request → Response type               |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------- |
| **BillPull**                   | Return the bills of a post-paid account               | `BILPULRQ` → `BILPULRS`               |
| **PrepaidValidation**          | Validate a pre-paid account and amount before payment | `BILRPREPADVALRQ` → `BILRPREPADVALRS` |
| **ReceivePaymentNotification** | Receive a payment and post it to your billing system  | `BLRPMTNTFRQ` → `BLRPMTNTFRS`         |
| **Availability**               | Health check (`GET /availability?token=…`, JSON)      | —                                     |

It takes care of the E-SADAD protocol: XML parsing and building, `MsgBody` signature verification and signing (RSA-SHA256, compatible byte-for-byte with the E-SADAD reference implementation), request and response logging, idempotent payment posting, currency decimals and error responses. You write only the part that talks to your billing system.

Written in TypeScript and shipped as **CommonJS and ES modules with type definitions**, so it works the same from JavaScript and TypeScript.

> 📘 **New to the library? Start with the step-by-step guide: [`docs/README.md`](docs/README.md)** (quick start in 10 minutes, then one topic per page).
> 🌍 **بالعربية:** [`docs/ar/README.md`](docs/ar/README.md)
> 🧩 **Runnable examples** for every feature: [`examples/README.md`](examples/README.md)

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start (TypeScript)](#quick-start-typescript)
- [Quick start (JavaScript)](#quick-start-javascript)
- [Configuration](#configuration)
- [Adapter: connecting your billing system](#adapter-connecting-your-billing-system)
- [Store: transaction and payment logs](#store-transaction-and-payment-logs)
- [Endpoints and routes](#endpoints-and-routes)
- [Result codes](#result-codes)
- [Request handling flow](#request-handling-flow)
- [Signatures](#signatures)
- [Availability API](#availability-api)
- [Using without Express](#using-without-express)
- [Utilities](#utilities)
- [Security](#security)
- [To confirm with E-SADAD](#to-confirm-with-e-sadad)
- [Developer guide](#developer-guide)

---

## Requirements

Node.js versions that still receive security updates:

| Node.js | Status                             | Minimum |
| ------- | ---------------------------------- | ------- |
| 22      | Maintenance LTS (until April 2027) | 22.23.5 |
| 24      | LTS                                | 24.22.3 |
| 26      | LTS                                | 26.13.1 |

`engines`: `^22.23.5 || ^24.22.3 || >=26.13.1`. Each minimum is the latest security release of that line. Older lines (18, 20) are end-of-life and not supported.

Express 4 or 5 is needed only if you use the Express router (`e-sadad-xml/express`).

## Installation

From GitHub (the `prepare` script builds the package on install):

```bash
npm install github:zaqoutabed/e-sadad-xml
```

Or from a packed tarball:

```bash
npm pack            # in this repository → e-sadad-xml-<version>.tgz
npm install ./e-sadad-xml-0.1.0.tgz
```

## Quick start (TypeScript)

```ts
import express from 'express';
import { EsadadService, normalizeMobileNumber, type BillerAdapter } from 'e-sadad-xml';
import { createEsadadRouter } from 'e-sadad-xml/express';

const adapter: BillerAdapter = {
  async validatePrepaid(request) {
    const exists = await customers.existsByMobile(request.billingNo); // your code
    return exists ? { valid: true } : { valid: false, result: 'INVALID_BILLING_NUMBER' };
  },
  async postPayment(trx) {
    await topUps.create({ mobile: trx.billingNo, amount: trx.paidAmount, reference: trx.joebppsTrx }); // your code
  },
};

const esadad = new EsadadService({
  biller: { code: 344, name: 'HatCard' },
  services: [
    {
      serviceType: 'TELC_Recharge',
      nameEn: 'HatCard TopUp - ILS',
      nameAr: 'رصيد هات كارد - بالشيكل',
      paymentType: 'PrePaid',
      currency: 'ILS',
      bankCode: 8,
      iban: 'PS49PALS045431072990993100000',
    },
  ],
  certificates: {
    esadadCertificate: { path: process.env.ESADAD_CERT! }, // E-SADAD public .cer
    billerPfx: { path: process.env.BILLER_PFX!, password: process.env.BILLER_PFX_PASSWORD! }, // your .pfx
  },
  normalizeBillingNo: (billingNo) => normalizeMobileNumber(billingNo), // billing number = mobile number
  adapter,
  store: mySqlStore, // see "Store"
  availabilityToken: process.env.AVAILABILITY_TOKEN,
  logger: console,
});

const app = express();
app.use('/api/v1/esadad', createEsadadRouter(esadad));
app.listen(3000);
```

Runnable versions: [`examples/hatcard-typescript.ts`](examples/hatcard-typescript.ts) and [`examples/hatcard-javascript.cjs`](examples/hatcard-javascript.cjs).

## Quick start (JavaScript)

```js
const express = require('express'); // or: import express from 'express'
const { EsadadService, normalizeMobileNumber } = require('e-sadad-xml');
const { createEsadadRouter } = require('e-sadad-xml/express');

const esadad = new EsadadService({
  biller: { code: 344 },
  services: [
    { serviceType: 'TELC_Recharge', paymentType: 'PrePaid', currency: 'ILS', bankCode: 8, iban: 'PS49PALS045431072990993100000' },
  ],
  certificates: {
    esadadCertificate: { path: './certs/ESADAD.cer' },
    billerPfx: { path: './certs/biller.pfx', password: process.env.BILLER_PFX_PASSWORD },
  },
  normalizeBillingNo: normalizeMobileNumber,
  adapter: {
    validatePrepaid: async (req) => ({ valid: await customerExists(req.billingNo) }),
    postPayment: async (trx) => {
      await topUp(trx.billingNo, trx.paidAmount, trx.joebppsTrx);
    },
  },
  store: mySqlStore,
});

const app = express();
app.use('/api/v1/esadad', createEsadadRouter(esadad));
app.listen(3000);
```

## Configuration

`new EsadadService(config)` validates the configuration and throws `EsadadConfigError` straight away if anything is wrong (missing key, duplicate service, bad currency, and so on).

| Option               | Required    | Description                                                                                                                                                             |
| -------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `biller`             | ✓           | `{ code, name? }`. `code` is sent as `SdrCode` and `BillerCode`.                                                                                                        |
| `services`           | ✓           | List of services (below).                                                                                                                                               |
| `certificates`       | ✓*          | `esadadCertificate` (E-SADAD `.cer`/`.crt`, PEM or DER) plus either `billerPfx: { path \| data, password }` or `billerPrivateKey: { path \| data, passphrase? }` (PEM). |
| `signer`             | ✓*          | Custom `MessageSigner` (for example an HSM) instead of `certificates`.                                                                                                  |
| `adapter`            | ✓           | Your billing system. See [Adapter](#adapter-connecting-your-billing-system).                                                                                            |
| `store`              | recommended | Log storage. Defaults to `InMemoryStore`, which is **not for production**.                                                                                              |
| `normalizeBillingNo` |             | `(billingNo, serviceType) => string \| null`. Return `null`/`''` to answer INVALID_BILLING_NUMBER. Default: trim.                                                       |
| `credentials`        |             | `{ username, password }`. When set, the `username`/`password` query parameters must match.                                                                              |
| `availabilityToken`  |             | Shared token for `/availability`. Without it, the endpoint answers 503.                                                                                                 |
| `healthCheck`        |             | `() => boolean \| Promise<boolean>`, used by `/availability` (for example, ping your database).                                                                         |
| `resultCodes`        |             | Override result codes, for example `{ INVALID_AMOUNT: { code: 13, desc: 'Invalid Amount', severity: 'Error' } }`.                                                       |
| `maxBodyBytes`       |             | Maximum request size. Default 512 KB.                                                                                                                                   |
| `adapterTimeoutMs`   |             | Time limit (ms) for the read-only adapter calls `getBills` and `validatePrepaid`. Default: no limit. Never applied to `postPayment`.                                    |
| `verifySignature`    |             | Default `true`. Set `false` only for local development.                                                                                                                 |
| `hooks`              |             | Background callbacks: `onPaymentPosted` (SMS, e-mail after a payment) and `onRequestCompleted` (metrics). They never delay or change the response.                      |
| `timestamp`          |             | Custom `TmStp` generator. Default: local time `YYYY-MM-DDTHH:mm:ss`.                                                                                                    |
| `logger`             |             | Any object with optional `debug/info/warn/error` (for example `console`, pino, winston).                                                                                |

\* One of `certificates` or `signer`.

**Service** (the "eSadad Services Configurations" table):

| Field                      | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `serviceType`              | E-SADAD `ServiceType` code, for example `TELC_Recharge`.     |
| `nameAr`, `nameEn`         | Display names (optional).                                    |
| `paymentType`              | `'PrePaid'` (PrepaidValidation) or `'PostPaid'` (BillPull).  |
| `currency`                 | `JOD` (3 decimals), `USD`, `ILS`, `EUR`/`EURO` (2 decimals). |
| `bankCode`                 | Settlement bank code, sent as `SetBnkCode`.                  |
| `iban`                     | Settlement IBAN, sent as `AcctNo`.                           |
| `partialPayment`           | BillPull `AllowPart` (default `false`).                      |
| `lowerValue`, `upperValue` | Inclusive amount limits.                                     |

### Config tables or a config file

The integration document describes Biller, Services and Certificates **config tables**. Load them straight from your database or from a JSON file, using the document's column names (`BillerCode`, `ServiceTypeCode`, `CertificatePath`, ...):

```ts
import { EsadadService, configFromTables, loadConfigFile } from 'e-sadad-xml';

new EsadadService({ ...loadConfigFile('./esadad.config.json'), adapter, store });
new EsadadService({ ...configFromTables({ biller, services, certificates }), adapter, store }); // database rows
```

Column names ignore case and underscores, string values from databases are converted, and `"env:NAME"` keeps passwords out of files. Details: [docs/03-configuration.md](docs/03-configuration.md#config-tables-or-a-config-file).

### Hooks

```ts
hooks: {
  onPaymentPosted: async (trx) => sms.send(trx.billingNo, `Paid ${trx.paidAmount} ${trx.currency}`), // not called for retries
  onRequestCompleted: (e) => metrics.timing('esadad', e.durationMs, { api: e.api, code: e.result.code }),
}
```

Hooks run in the background after the response is ready; their errors are logged only.

## Adapter: connecting your billing system

Implement only the methods for the APIs you use. Every method may be `async`.

```ts
interface BillerAdapter {
  getBills?(request: BillPullRequest, ctx): BillPullResult; // BillPull
  validatePrepaid?(request: PrepaidValidationRequest, ctx): PrepaidValidationResult; // PrepaidValidation
  postPayment?(transaction: PaymentTransaction, ctx): PostPaymentResult | void; // ReceivePaymentNotification
}
```

| Method            | Return                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getBills`        | `{ found: false }` → INVALID_BILLING_NUMBER<br>`{ found: true, bills: [{ dueAmount: 12.5, billNo, dueDate, ... }] }` → bill(s) with an amount due<br>`{ found: true, bills: [{ dueAmount: 0 }] }` → bill with nothing due |
| `validatePrepaid` | `{ valid: true }`, optionally overriding `dueAmount`, `validationCode` or `subPayments`<br>`{ valid: false, result?: 'INVALID_BILLING_NUMBER' }`                                                                          |
| `postPayment`     | Nothing (success), or `{ success: false, result? }`. Throw on failure.                                                                                                                                                    |

The `request` and `transaction` objects contain parsed values: `billingNo` (normalised), `originalBillingNo`, amounts as numbers, the matching `service` config, `guid`, and `rawXml`.

**Errors.** Throw `new EsadadError('INVALID_BILLING_NUMBER')`, or `new EsadadError({ code: 410, desc: 'Account Suspended', severity: 'Error' })`, to answer with a specific code. Any other thrown error becomes `GENERAL_ERROR`. Its message is logged but **never sent to E-SADAD**.

**Payment posting.** `postPayment` is called only for payments not yet posted. If it throws or returns `{ success: false }`, the payment stays unposted, so the next E-SADAD retry tries again. Use `trx.joebppsTrx` as your reference so your own system can also reject duplicates.

## Store: transaction and payment logs

The store implements the two log tables from the integration document:

```ts
interface EsadadStore {
  logTransaction(entry: TransactionLogEntry): void | Promise<void>; // EsadadTransactionsLogs
  logPayment(entry: PaymentLogEntry): void | Promise<void>; // EsadadPaymentsLogs (IsPaymentPosted = false)
  isPaymentPosted(joebppsTrx: string, guid: string): boolean | Promise<boolean>;
  markPaymentPosted(joebppsTrx: string, guid: string): void | Promise<void>; // most recent row → true
}
```

- [`examples/sql/schema.sqlserver.sql`](examples/sql/schema.sqlserver.sql): table definitions (SQL Server).
- [`examples/sql/sqlServerStore.ts`](examples/sql/sqlServerStore.ts): a complete store using the `mssql` package.
- `InMemoryStore`: for tests and local development only.

> **Why `JOEBPPSTrx` and not the GUID?** The GUID arrives in the query string, which is **not signed**. Anyone who captured a signed request could replay it with a new GUID. `JOEBPPSTrx` is inside the signed `MsgBody`, so keying idempotency on it makes replays harmless. The GUID is still stored in every row.

Failures writing the transaction log are logged and do not change the response. Failures in the payment-log methods produce `GENERAL_ERROR`, so E-SADAD retries.

## Endpoints and routes

`createEsadadRouter(service, options?)` registers these routes (relative to where you mount it):

| Method | Default path                          | Query                            |
| ------ | ------------------------------------- | -------------------------------- |
| POST   | `/BillPull`                           | `guid`, `username`?, `password`? |
| POST   | `/prepaid/PrepaidValidation`          | same                             |
| POST   | `/Payment/ReceivePaymentNotification` | same                             |
| GET    | `/availability`                       | `token`                          |

Mount it under a versioned prefix, as the integration document recommends: `app.use('/api/v1/esadad', router)`.

Options: `paths` (rename a route, or set it to `false` to disable it) and `bodyLimit` (default `512kb`).

The XML endpoints always answer **HTTP 200** with `Content-Type: application/xml`. Errors are reported inside the signed XML. The only exceptions are 413 (body too large) and 500 (response could not be signed); both have a plain-text body with no details.

## Result codes

| Key                      | Code | Source              |
| ------------------------ | ---- | ------------------- |
| `SUCCESS`                | 0    | E-SADAD reference ✔ |
| `INVALID_SIGNATURE`      | 2    | E-SADAD reference ✔ |
| `INVALID_BILLING_NUMBER` | 408  | E-SADAD reference ✔ |
| `INVALID_REQUEST`        | 1    | library default     |
| `AUTHENTICATION_FAILED`  | 3    | library default     |
| `INVALID_BILLER_CODE`    | 4    | library default     |
| `INVALID_SERVICE_TYPE`   | 5    | library default     |
| `INVALID_CURRENCY`       | 6    | library default     |
| `INVALID_AMOUNT`         | 7    | library default     |
| `GENERAL_ERROR`          | 500  | library default     |

Override any of them with `config.resultCodes`.

**Where an error is reported**, following the E-SADAD reference:

- **Header and body**: problems with the message itself. These are malformed XML, a missing or invalid GUID, wrong credentials, an invalid signature and unexpected errors.
- **Body only** (the header stays `0 Success`): business results, for example an unknown billing number, an amount out of range or a wrong service type. For payments, every `TrxInf` gets its own `Result`.

## Request handling flow

Every XML request goes through the same steps (`src/core/pipeline.ts`), in the order the integration document specifies:

```
1. Read inputs        guid / username / password from the query, XML from the body
2. Log request        → EsadadTransactionsLogs (Request)
3. Pre-verify step    payments only → EsadadPaymentsLogs (IsPaymentPosted = false)
4. Validate           size limit, XML well-formed, GUID, credentials, signature
5. Process            API handler → your adapter
6. Sign               signature of MsgBody → MsgFooter/Security/Signature
7. Log response       → EsadadTransactionsLogs (Response)
```

ReceivePaymentNotification, step 5:

```
for each TrxInf:
  validate (JOEBPPSTrx, ServiceType, Currency, PaidAmt > 0, BillingNo)
  already posted (store.isPaymentPosted)?  → Success, no posting (a retry)
  else adapter.postPayment → store.markPaymentPosted → Success
```

## Signatures

The library uses the same algorithm as the E-SADAD reference implementation:

1. Take `<MsgBody>…</MsgBody>` in canonical XML (C14N 1.0).
2. Remove whitespace between tags inside it and trim.
3. Encode as **UTF-16LE**.
4. Sign or verify with **RSA PKCS#1 v1.5 + SHA-256**. The value is base64, in `MsgFooter/Security/Signature`.

Requests are verified with the E-SADAD certificate, and responses are signed with your private key. Compatibility is covered by golden test vectors produced by the Python reference code (`test/signature.test.ts`).

To sign or verify messages yourself (for example in a test that plays E-SADAD):

```ts
import { CertificateSigner, signMessage, verifyMessage } from 'e-sadad-xml';
const signer = new CertificateSigner({ esadadCertificate: { path: 'ESADAD.cer' }, billerPfx: { path: 'biller.pfx', password } });
const signedXml = await signMessage(xml, signer);
const { valid } = await verifyMessage(signedXml, signer);
```

## Availability API

**Server side**, as E-SADAD calls you: enabled by the router at `GET /availability?token=…` when `availabilityToken` is set.

```json
{ "status": "success", "availability": { "response_time": 3, "status_code": 200, "status_message": "OK" }, "checked_at": "2026-11-12T10:00:00.000Z" }
{ "status": "error", "message": "Authentication failed", "error_code": 401, "checked_at": "..." }
```

**Client side**, to check an E-SADAD endpoint:

```ts
import { requestAvailability } from 'e-sadad-xml';
const result = await requestAvailability({ baseUrl: 'https://esadad.example.com', token: process.env.ESADAD_TOKEN! });
// never throws: network errors and timeouts come back as { status: 'error', ... }
```

## Using without Express

`EsadadService` does not depend on any framework. Pass it the raw body and query values, and send back `xml` with status 200:

```ts
const { xml } = await esadad.handle('PrepaidValidation', { body: rawBody, guid, username, password });
// or: esadad.billPull(...), esadad.prepaidValidation(...), esadad.receivePaymentNotification(...)
const { statusCode, body } = await esadad.availability(token);
```

`handle` never throws, except `EsadadSigningError` when the response cannot be signed; answer 500 in that case. A complete `node:http` example is in [`examples/without-express.ts`](examples/without-express.ts). The same approach works for Fastify, NestJS and Koa.

## Utilities

```ts
normalizeMobileNumber('970599123456'); // '0599123456' ('' when invalid)
toInternationalMobile('0599123456'); // '970599123456'
formatAmount(10, 'JOD'); // '10.000'
formatAmount(5.5, 'ILS'); // '5.50'
```

## Security

What the library does:

- **XML:** DOCTYPE is rejected, so there is no entity expansion or XXE. Requests have a size limit. Every output value is escaped, so request data can never inject XML.
- **Signatures:** every request is verified before any business logic runs, and every response is signed.
- **Secret comparison:** tokens and passwords are compared in constant time.
- **Replays:** idempotency is keyed on the signed `JOEBPPSTrx`, so a replay cannot post a payment twice. A per-process lock also serialises concurrent retries.
- **GUIDs:** only `[A-Za-z0-9{}._-]` (up to 100 characters) is accepted. A query GUID must match `MsgHeader/GUID` when both are present.
- **Error details:** internal error messages and stack traces never reach the response; they go to `logger` only.

What you should do:

- Use HTTPS only. Restrict the endpoints to E-SADAD IP addresses if you can.
- Keep the `.pfx`, its password and tokens in a secret manager or environment variables. Never commit them; `.gitignore` excludes `*.pfx`, `*.p12` and `*.key`.
- `username`, `password` and `token` travel in the query string, as the E-SADAD specification requires. Make sure your reverse proxy and access logs don't record query strings for these routes.
- Use a database store. With several app instances, keep the unique index from `schema.sqlserver.sql`.
- Add rate limiting in front of the endpoints (for example at the reverse proxy).

## To confirm with E-SADAD

The reference material did not include these, so they follow standard MFEP conventions and are easy to change (see the [developer guide](#how-to)):

- The BillPull request and response layout and `BILPULRS`: `src/messages/billPull.ts`.
- The result codes marked "library default" above: `src/constants.ts`, or `config.resultCodes`.
- The request types (`ReqTyp`) are not enforced, so a different value does not break anything.

---

## Developer guide

### Setup

```bash
git clone https://github.com/zaqoutabed/e-sadad-xml.git
cd e-sadad-xml
nvm use            # Node version from .nvmrc
npm install        # also builds dist/
```

### Scripts

| Command                           | What it does                                                              |
| --------------------------------- | ------------------------------------------------------------------------- |
| `npm run build`                   | Builds `dist/` (CJS `.js`, ESM `.mjs`, types `.d.ts`/`.d.mts`) with tsup. |
| `npm run typecheck`               | `tsc --noEmit` over `src` and `test`.                                     |
| `npm test`                        | Runs the test suite (vitest).                                             |
| `npm run test:watch`              | Tests in watch mode.                                                      |
| `npm run smoke`                   | Loads the built package with `require` and `import`.                      |
| `npm run test:coverage`           | Tests with a coverage report.                                             |
| `npm run lint` / `lint:fix`       | ESLint (bugs and consistency).                                            |
| `npm run format` / `format:check` | Prettier (formatting).                                                    |

CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests, build, smoke and audit on Node 22, 24 and 26. The Express tests run against both Express 4 and 5.

### Project structure

```
src/
├── index.ts                  Public exports (the only file users import from)
├── service.ts                EsadadService: validates config, wires everything, one method per API
├── constants.ts              Message types (ReqTyp/ResTyp), result codes, currency decimals
├── types.ts                  Public types: config, adapter, store, requests, outputs
├── errors.ts                 EsadadError (answer with a code), EsadadConfigError
│
├── core/                     Shared machinery, no API-specific logic
│   ├── pipeline.ts           The 7-step flow every XML request goes through
│   ├── services.ts           ServiceRegistry: service lookup, billing-number normalisation
│   ├── results.ts            ResultResolver: key/object/error → ResultCode
│   ├── lock.ts               KeyedLock: one-at-a-time per payment
│   ├── background.ts         runInBackground: hooks that never delay the response
│   └── security.ts           Constant-time comparison
│
├── config/tables.ts          configFromTables / loadConfigFile (integration-document config tables)
│
├── handlers/                 One file per API: validation + business flow
│   ├── types.ts              ApiHandler interface, HandlerDeps, RequestContext
│   ├── billPullHandler.ts
│   ├── prepaidValidationHandler.ts
│   ├── paymentNotificationHandler.ts
│   └── availabilityHandler.ts
│
├── messages/                 XML layout only: parse a request, build a response body
│   ├── envelope.ts           MFEP / MsgHeader / Result / MsgFooter
│   ├── billPull.ts
│   ├── prepaidValidation.ts
│   ├── paymentNotification.ts
│   └── common.ts             SubPmts
│
├── crypto/                   Keys and signatures
│   ├── keys.ts               Load .cer/.pem public keys, .pfx/.pem private keys
│   ├── signature.ts          RSA-SHA256 over UTF-16LE, CertificateSigner
│   └── message.ts            signMessage / verifyMessage for whole XML messages
│
├── xml/                      Generic XML tools
│   ├── parser.ts             Safe parsing (no DOCTYPE), findFirst/findAll/text helpers
│   ├── builder.ts            el()/leaf()/optLeaf() → escaped XML string
│   └── c14n.ts               Canonical XML + MsgBody string to sign
│
├── storage/memory.ts         InMemoryStore
├── client/availabilityClient.ts
├── adapters/express.ts       Express router (separate entry: e-sadad-xml/express)
└── utils/                    currency.ts, phone.ts, datetime.ts

test/                         One test file per area; helpers.ts creates keys and signed requests
docs/                         User guide (one topic per page, start at docs/README.md)
examples/                     Runnable examples: servers, frameworks, databases, testing, advanced
scripts/smoke.*               Load the built package from CJS and ESM
```

**Layer rules** (keep these and the code stays easy to change):

- `messages/` only knows XML layout. It has no validation and no adapter calls.
- `handlers/` contains the per-API flow. It uses `messages/` to read and write XML and `deps` for everything else.
- `core/pipeline.ts` contains the steps shared by every API. Don't put API-specific code there.
- `service.ts` only wires things together.
- Everything users may import is exported from `src/index.ts`. Anything not exported there is internal.

### How to

**Add or change a service (for example a new top-up product).** No code change is needed: add an entry to `services` in the app's configuration.

**Change a result code** (for example once E-SADAD confirms the numbers): edit `DefaultResultCodes` in `src/constants.ts`, or set `config.resultCodes` in the app. Add a new key there if you need a new error type, then `throw new EsadadError('NEW_KEY')`.

**Add a field to a response**, for example `<PrepaidCat>`:

1. Add it to the builder in `src/messages/<api>.ts`. Use `leaf()` for a required element, or `optLeaf()` for one omitted when empty. Element order matters.
2. If the value comes from the adapter, add it to the result type in `src/types.ts` and pass it through in `src/handlers/<api>Handler.ts`.
3. Update the expected XML in `test/<api>.test.ts`.

**Read a new field from a request:** add it to the `Raw…Request` type and parser in `src/messages/<api>.ts` (`text(body, 'FieldName')`), then to the public request type in `src/types.ts` and to `buildRequest` in the handler.

**Add a new API:**

1. Add the message types to `MessageTypes` and the name to `ApiNames` in `src/constants.ts`.
2. Create `src/messages/<newApi>.ts` with the request parser and response body builder.
3. Create `src/handlers/<newApi>Handler.ts` implementing `ApiHandler` (`describe`, `process`, `errorBody`; `beforeVerify` if needed). Copy `prepaidValidationHandler.ts` as a starting point.
4. Register it in the `handlers` map in `src/service.ts` and add a convenience method.
5. Add a route in `src/adapters/express.ts`.
6. Add the adapter method to `BillerAdapter` in `src/types.ts`.
7. Write `test/<newApi>.test.ts` (copy an existing one; `test/helpers.ts` signs requests for you).

**Change the BillPull layout** after receiving an E-SADAD sample: edit `src/messages/billPull.ts` (parser + `billRecordNode` + `billPullErrorBody`) and update `test/billPull.test.ts`.

### Tests

- `test/helpers.ts` generates throw-away RSA keys and certificates at runtime (no keys are committed), and builds requests signed as E-SADAD would sign them.
- `test/signature.test.ts` holds **golden vectors**: canonical `MsgBody` strings produced by the E-SADAD Python reference (`lxml` c14n + `remove_whitespace_between_tags`). If you change `src/xml/c14n.ts`, these must keep passing; otherwise E-SADAD will reject your signatures. To add a vector, run the Python reference on a sample and paste the output.
- Each API test checks the exact XML returned and that its signature verifies.
- Add a test for every bug you fix.

### Conventions

- TypeScript `strict` mode. No `any` (enforced by ESLint).
- Run `npm run lint` and `npm run format` before committing; CI fails otherwise.
- Comments explain _why_. Every exported function or class has a short doc comment.
- Errors inside handlers: `throw new EsadadError(key)` for expected outcomes. Plain `Error` means "unexpected", and becomes GENERAL_ERROR with the details logged only.
- Never build XML with string templates in `src/`: use `el`, `leaf` and `optLeaf`, which escape values.
- Keep runtime dependencies minimal (currently `@xmldom/xmldom` and `node-forge`). Run `npm audit --omit=dev` before releasing.

### Releasing

1. Update `version` in `package.json` (semver: patch for fixes, minor for new features, major for breaking changes).
2. `npm run typecheck && npm test && npm run build && npm run smoke`
3. Commit, tag (`git tag v0.2.0`), push with tags.
4. Apps install the tag: `npm install github:zaqoutabed/e-sadad-xml#v0.2.0`.

### Node.js support policy

Support only Node.js lines that receive security updates ([schedule](https://github.com/nodejs/Release)). When a line reaches end-of-life, or a new security release comes out:

1. Update `engines.node` in `package.json`, using the latest security patch of each supported line as its minimum.
2. Update `.nvmrc`, the CI matrix in `.github/workflows/ci.yml`, `target` in `tsup.config.ts`, and the [Requirements](#requirements) table.
