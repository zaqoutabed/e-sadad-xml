# 12. Reference

🎯 Every export, in one place. Look things up here; don't read it top to bottom.

```ts
import { … } from 'e-sadad-xml';           // everything below
import { … } from 'e-sadad-xml/express';   // createEsadadRouter, defaultPaths
```

`require('e-sadad-xml')` works the same.

---

## 🏗️ Main class

### `new EsadadService(config)` · `createEsadadService(config)`

Throws `EsadadConfigError` if the config is invalid. → [Configuration](03-configuration.md)

| Method                              | Returns                         | Notes                                                                      |
| ----------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `prepaidValidation(input)`          | `Promise<HandlerOutput>`        |                                                                            |
| `billPull(input)`                   | `Promise<HandlerOutput>`        |                                                                            |
| `receivePaymentNotification(input)` | `Promise<HandlerOutput>`        |                                                                            |
| `handle(api, input)`                | `Promise<HandlerOutput>`        | `api`: `'BillPull' \| 'PrepaidValidation' \| 'ReceivePaymentNotification'` |
| `availability(token)`               | `Promise<{ statusCode, body }>` | JSON body for `/availability`                                              |
| `authenticate(body)`                | `Promise<{ statusCode, body }>` | Signed JSON for `/authentication` → [Authentication](13-authentication.md) |
| `verifyAccessToken(token)`          | `Promise<boolean>`              | `true` for an issued, unexpired token                                      |
| `authenticationEnabled`             | `boolean`                       | `authentication` is configured                                             |
| `getService(serviceType)`           | `ServiceConfig \| undefined`    |                                                                            |
| `resultCodes`                       | `ResultCodes`                   | the codes in use (defaults + overrides)                                    |

```ts
// input (HandlerInput)
{ body: string | Buffer, guid?: string, username?: string, password?: string }

// output (HandlerOutput)
{ xml: string, result: ResultCode, api: ApiName, guid: string }
```

The XML methods never throw, except **`EsadadSigningError`** (the key can't sign).

---

## 🛣️ Express (`e-sadad-xml/express`)

| Export                                                                     | What                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `createEsadadRouter(service, { paths?, bodyLimit?, requireAccessToken? })` | Express `Router` with all routes                                                            |
| `defaultPaths`                                                             | `{ billPull, prepaidValidation, receivePaymentNotification, availability, authentication }` |

---

## ⚠️ Errors

| Class                              | When                                                   |
| ---------------------------------- | ------------------------------------------------------ |
| `EsadadError(keyOrCode, message?)` | Throw from your adapter to send a specific result code |
| `EsadadConfigError`                | Bad configuration (thrown at startup)                  |
| `EsadadSigningError`               | A response couldn't be signed → answer HTTP 500        |

---

## 🔐 Signing

| Export                                                                                        | What                                                                                                                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `new CertificateSigner(certificates)`                                                         | `MessageSigner` from `.cer` + `.pfx`/`.pem`                                                                                         |
| `signMessage(xml, signer)`                                                                    | Returns the XML with `MsgFooter/Security/Signature` filled in                                                                       |
| `verifyMessage(xml, signer)`                                                                  | `{ valid: boolean, reason?: 'missing-signature' \| 'invalid-signature' }`                                                           |
| `canonicalMsgBody(xmlOrDoc)`                                                                  | The exact string that gets signed (for debugging)                                                                                   |
| `canonicalize(element)`                                                                       | Canonical XML (C14N) of a DOM element                                                                                               |
| `decodeXmlBody(buffer, charset?)`                                                             | Raw request bytes → string. Detects UTF-8/UTF-16 from the bytes; throws `UnsupportedCharsetError` (HTTP 415) for an unknown charset |
| `signData(text, privateKey, encoding?)` / `verifyData(text, signature, publicKey, encoding?)` | Low-level RSA-SHA256. `encoding`: `'utf16le'` (default, XML APIs) or `'utf8'` (Authentication API)                                  |
| `signer.signUtf8(text)` / `signer.verifyUtf8(text, signature)`                                | UTF-8 signing on `CertificateSigner` (needed for `authentication`)                                                                  |
| `authSigningString(data, 'pipe' \| 'json')`                                                   | The text signed for an Authentication API `data` object                                                                             |
| `hashAccessToken(token)`                                                                      | The SHA-256 hex a token store receives                                                                                              |
| `loadPublicKey(source)`                                                                       | From `.cer`/`.crt` (PEM or DER) or a public key                                                                                     |
| `loadPfxPrivateKey(source, password)`                                                         | From `.pfx`/`.p12`                                                                                                                  |
| `loadPemPrivateKey(source, passphrase?)`                                                      | From PEM (PKCS#1/PKCS#8) or DER                                                                                                     |

`source` = `{ path: string }` or `{ data: string | Buffer }`.

---

## 🗂️ Config tables

| Export                                                                     | What                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `configFromTables({ biller, services, certificates }, { baseDir?, env? })` | Rows (document column names) → `{ biller, services, certificates }` |
| `loadConfigFile(path, { env? })`                                           | Same, from a JSON file. Paths are resolved from the file's folder.  |

→ [Configuration → Config tables](03-configuration.md#config-tables-or-a-config-file)

---

## 🗃️ Storage

| Export                     | What                                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| `InMemoryStore`            | Dev/test store. Has `.transactions` and `.payments` arrays.                 |
| `EsadadStore` (type)       | Interface for your own store → [Database store](07-database-store.md)       |
| `InMemoryAccessTokenStore` | Dev/test store for Authentication API tokens                                |
| `AccessTokenStore` (type)  | Interface for your own token store → [Authentication](13-authentication.md) |

---

## 📡 Availability client

| Export                                                       | What                                              |
| ------------------------------------------------------------ | ------------------------------------------------- |
| `requestAvailability({ baseUrl, token, path?, timeoutMs? })` | Calls an availability endpoint. **Never throws.** |

---

## 🧮 Utilities

| Export                                     | Example                                             |
| ------------------------------------------ | --------------------------------------------------- |
| `normalizeMobileNumber(s)`                 | `'970599123456'` → `'0599123456'` (`''` if invalid) |
| `toInternationalMobile(s, '970' \| '972')` | `'0599123456'` → `'970599123456'`                   |
| `formatAmount(n, currency)`                | `(10, 'JOD')` → `'10.000'`                          |
| `parseAmount(s)`                           | `'20.50'` → `20.5`; `'1e3'` → `undefined`           |
| `currencyDecimals(currency)`               | `'JOD'` → `3`                                       |
| `isSupportedCurrency(s)`                   | `'ILS'` → `true`                                    |
| `isAmountInRange(n, min?, max?)`           | inclusive                                           |
| `formatTimestamp(date?)`                   | `'2026-11-12T09:05:00'` (local time)                |

---

## 📚 Constants

| Export               | Contains                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `MessageTypes`       | `BILL_PULL_REQUEST/RESPONSE`, `PREPAID_VALIDATION_REQUEST/RESPONSE`, `PAYMENT_NOTIFICATION_REQUEST/RESPONSE` |
| `ApiNames`           | `BILL_PULL`, `PREPAID_VALIDATION`, `RECEIVE_PAYMENT_NOTIFICATION`                                            |
| `DefaultResultCodes` | all codes → [Errors](06-errors.md)                                                                           |
| `CurrencyDecimals`   | `{ JOD: 3, USD: 2, ILS: 2, EUR: 2, EURO: 2 }`                                                                |

---

## 🏷️ Main types (TypeScript)

| Type                                                                         | Used for                          |
| ---------------------------------------------------------------------------- | --------------------------------- |
| `EsadadConfig`                                                               | constructor options               |
| `ServiceConfig`, `BillerInfo`, `CertificatesConfig`, `Credentials`, `Logger` | parts of the config               |
| `BillerAdapter`                                                              | your adapter                      |
| `PrepaidValidationRequest` → `PrepaidValidationResult`                       | `validatePrepaid`                 |
| `BillPullRequest` → `BillPullResult`, `BillRecord`                           | `getBills`                        |
| `PaymentTransaction` → `PostPaymentResult`                                   | `postPayment`                     |
| `SubPayment`                                                                 | `{ amount, bankCode, accountNo }` |
| `ResultCode`, `ResultCodeKey`, `ResultInput`                                 | result codes                      |
| `EsadadStore`, `TransactionLogEntry`, `PaymentLogEntry`                      | stores                            |
| `MessageSigner`                                                              | custom signer (HSM/KMS)           |
| `ConfigTables`, `ConfigRow`, `ConfigTablesOptions`, `TablesConfig`           | config tables                     |
| `EsadadHooks`, `RequestCompletedEvent`                                       | background hooks                  |
| `HandlerInput`, `HandlerOutput`, `HandlerContext`                            | calling the service directly      |
| `AvailabilityResponse`, `AvailabilityResult`, `AvailabilityClientOptions`    | availability                      |

---

⬅️ **Back to:** [the guide index](README.md)
