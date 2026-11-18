# 3. Configuration

⏱ 5 min · 🎯 You'll learn: every setting, which ones you need, and good defaults.

> **TL;DR:** you need **4 things**: `biller`, `services`, `certificates` and `adapter`. Add a `store` before production. Everything else is optional.

📄 Every option in one runnable file: [`examples/config-options.ts`](../examples/config-options.ts)

---

## 🟢 Required (4)

### 1. `biller`: who you are

```ts
biller: { code: 999, name: 'My Company' } // dummy: use your biller code from E-SADAD
```

- `code`: given to you by E-SADAD. Sent in every response.
- `name`: optional, just for you.

### 2. `services`: what you sell

One entry per E-SADAD **service type**:

```ts
services: [
  {
    serviceType: 'MOBILE_TOPUP', // the code E-SADAD gave you
    nameEn: 'Mobile TopUp - ILS', // optional
    nameAr: 'شحن رصيد - بالشيكل', // optional
    paymentType: 'PrePaid', // 'PrePaid' or 'PostPaid'
    currency: 'ILS', // 'JOD' | 'USD' | 'ILS' | 'EUR' (or 'EURO')
    bankCode: 99, // settlement bank
    iban: 'PS00XXXX000000000000000000000', // dummy: use your settlement IBAN
    lowerValue: 1, // optional: minimum amount
    upperValue: 1000, // optional: maximum amount
    partialPayment: false, // optional, postpaid only
  },
];
```

🧠 **Remember:**

| `paymentType` | E-SADAD calls              | Your adapter function |
| ------------- | -------------------------- | --------------------- |
| `'PrePaid'`   | PrepaidValidation          | `validatePrepaid`     |
| `'PostPaid'`  | BillPull                   | `getBills`            |
| both          | ReceivePaymentNotification | `postPayment`         |

💰 **Decimals are automatic:** JOD → 3 (`10.000`); USD, ILS, EUR → 2 (`10.00`).

### 3. `certificates`: your keys

```ts
certificates: {
  esadadCertificate: { path: './certs/ESADAD.cer' },                          // from E-SADAD
  billerPfx: { path: './certs/biller.pfx', password: process.env.PFX_PASSWORD! }, // yours
}
```

| Key                 | What                                                         | Used to                     |
| ------------------- | ------------------------------------------------------------ | --------------------------- |
| `esadadCertificate` | E-SADAD's **public** certificate (`.cer`/`.crt`, PEM or DER) | **check** incoming requests |
| `billerPfx`         | **Your** `.pfx` file plus its password                       | **sign** your responses     |

Other ways to give keys:

```ts
// Already loaded (from a secret manager, env var, …): use `data` instead of `path`
esadadCertificate: { data: process.env.ESADAD_CERT_PEM! },
billerPfx: { data: Buffer.from(process.env.BILLER_PFX_BASE64!, 'base64'), password: '…' },

// A PEM private key instead of a .pfx
billerPrivateKey: { path: './certs/biller.key', passphrase: '…' },
```

🔐 Keys in an HSM or cloud KMS? Use `signer` instead of `certificates`. See [`examples/custom-signer.ts`](../examples/custom-signer.ts).

### 4. `adapter`: your code

```ts
adapter: {
  validatePrepaid: async (request) => ({ valid: true }),
  getBills: async (request) => ({ found: false }),
  postPayment: async (trx) => { /* post it */ },
}
```

Only write the functions you need. Full guide: [4. The adapter](04-adapter.md).

---

## 🟡 Recommended

| Option   | Why                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`  | Saves logs and prevents double payments **across restarts**. The default (`InMemoryStore`) forgets everything when the app stops. → [Database store](07-database-store.md) |
| `logger` | See what's happening. `logger: console` works; so do pino and winston.                                                                                                     |

---

## ⚪ Optional

| Option               | Default                     | What it does                                                                                                                                                                                     |
| -------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `normalizeBillingNo` | trim spaces                 | Cleans the billing number before your adapter sees it. Return `null` or `''` to reject it as **408 Invalid Billing Number**.                                                                     |
| `credentials`        | none                        | `{ username, password }`. E-SADAD must send `?username=…&password=…`.                                                                                                                            |
| `availabilityToken`  | none (endpoint returns 503) | Token for `GET /availability?token=…`                                                                                                                                                            |
| `healthCheck`        | always healthy              | `async () => boolean`, used by `/availability`. Return `false` (or throw) to report "down".                                                                                                      |
| `resultCodes`        | see [Errors](06-errors.md)  | Change error numbers, for example once E-SADAD confirms theirs.                                                                                                                                  |
| `maxBodyBytes`       | 512 KB                      | Bigger requests are rejected.                                                                                                                                                                    |
| `adapterTimeoutMs`   | no limit                    | Time limit for `validatePrepaid` and `getBills`. If your billing system hangs, E-SADAD gets **500** instead of waiting forever. Not applied to `postPayment` (see [the adapter](04-adapter.md)). |
| `timestamp`          | local `YYYY-MM-DDTHH:mm:ss` | Custom time for `TmStp`.                                                                                                                                                                         |
| `verifySignature`    | `true`                      | ⚠️ **Never** set `false` in production.                                                                                                                                                          |
| `hooks`              | none                        | Background callbacks after a payment or any request (SMS, e-mail, metrics). See [Hooks](#hooks-sms-e-mail-metrics).                                                                              |

### `normalizeBillingNo` examples

```ts
import { normalizeMobileNumber } from 'e-sadad-xml';

// Billing number is a mobile number
normalizeBillingNo: normalizeMobileNumber,

// Different rules per service
normalizeBillingNo: (billingNo, serviceType) =>
  serviceType === 'MOBILE_TOPUP'
    ? normalizeMobileNumber(billingNo)          // '' → rejected
    : /^\d{6,10}$/.test(billingNo) ? billingNo : null, // null → rejected
```

---

## Config tables or a config file

The integration document asks for **config tables** (Biller, Services, Certificates). Keep them in your **database** or a **JSON file**, and the library reads them for you.

> **TL;DR:** `...configFromTables(rows)` or `...loadConfigFile('esadad.config.json')` replaces `biller`, `services` and `certificates`.

### From a JSON file

⚠️ The values in the file below are dummy values. Replace them with your own.

📄 [`examples/config/esadad.config.json`](../examples/config/esadad.config.json) · [`examples/config-from-file.ts`](../examples/config-from-file.ts)

```json
{
  "biller": { "BillerCode": "999", "BillerName": "My Company" },
  "services": [
    {
      "ServiceTypeCode": "MOBILE_TOPUP",
      "PaymentType": "PrePaid",
      "Currency": "ILS",
      "BankCode": 99,
      "IBAN": "PS00XXXX000000000000000000000"
    }
  ],
  "certificates": [
    { "CertificateOwner": "Esadad", "CertificateType": "Public", "CertificatePath": "certs/ESADAD.cer" },
    {
      "CertificateOwner": "My Company",
      "CertificateType": "Private",
      "CertificatePath": "certs/biller.pfx",
      "CertificatePassword": "env:BILLER_PFX_PASSWORD"
    }
  ]
}
```

```ts
import { EsadadService, loadConfigFile } from 'e-sadad-xml';

const esadad = new EsadadService({
  ...loadConfigFile('./esadad.config.json'), // biller + services + certificates
  adapter,
  store,
});
```

### From database tables

📄 [`examples/config-from-database.ts`](../examples/config-from-database.ts) (includes the `CREATE TABLE` statements)

```ts
import { configFromTables } from 'e-sadad-xml';

const esadad = new EsadadService({
  ...configFromTables({ biller: billerRows, services: serviceRows, certificates: certificateRows }),
  adapter,
  store,
});
```

### Column names (from the integration document)

| Table        | Columns                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Biller       | `BillerCode`, `BillerName`                                                                                                                                |
| Services     | `ServiceTypeCode`, `ServiceNameArabic`, `ServiceNameEnglish`, `PaymentType`, `Currency`, `BankCode`, `IBAN`, `PartialPayment`, `LowerValue`, `UpperValue` |
| Certificates | `CertificateOwner` (`Esadad` or your name), `CertificateType` (`Public`/`Private`), `CertificatePassword`, `CertificatePath`                              |

🧠 Good to know:

- ✅ Column names ignore **case and underscores**: `ServiceTypeCode`, `service_type_code` and `servicetypecode` all work.
- ✅ Database strings are converted: `'1'`/`'true'` → `true`, `'10.500'` → `10.5`, `'prepaid'` → `PrePaid`.
- 🔐 `"env:NAME"` reads a value from the environment, so passwords stay out of files and tables.
- 📁 Relative `CertificatePath` values are resolved from the **JSON file's folder** (or `baseDir` for tables).
- 🧾 Certificates used: **Esadad + Public** (to check requests) and **your name + Private** (`.pfx`/`.p12`, or a PEM key). Other rows are ignored.
- 🚨 Mistakes stop startup with a clear `EsadadConfigError`, for example `Services row 2: column IBAN is required`.

---

## Hooks: SMS, e-mail, metrics

Need to **do something after** E-SADAD gets its answer? Use hooks. They run **in the background**: they never slow down or change the response, and their errors only go to `logger.error`.

📄 [`examples/hooks-notifications.ts`](../examples/hooks-notifications.ts)

```ts
hooks: {
  // after a payment is posted (NOT called again for retries)
  async onPaymentPosted(trx) {
    await sms.send(toInternationalMobile(trx.billingNo), `Topped up ${trx.paidAmount} ${trx.currency}`);
  },
  // after every request: metrics and alerts
  onRequestCompleted(event) {
    metrics.timing('esadad.duration', event.durationMs, { api: event.api, code: event.result.code });
  },
},
```

| Hook                        | When                              | You get                                                            |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `onPaymentPosted(trx, ctx)` | A payment was posted successfully | the full `PaymentTransaction`                                      |
| `onRequestCompleted(event)` | Any XML request was answered      | `api`, `guid`, `result`, `durationMs`, `requestXml`, `responseXml` |

💡 Rule of thumb: **`postPayment` posts the money. `onPaymentPosted` tells people about it.**

---

## 🛣️ Express router options

```ts
createEsadadRouter(esadad, {
  bodyLimit: '512kb',
  paths: {
    billPull: '/BillPull', // default
    prepaidValidation: '/prepaid/PrepaidValidation', // default
    receivePaymentNotification: '/Payment/ReceivePaymentNotification', // default
    availability: '/availability', // default
    // set any of them to false to turn that route off
  },
});
```

Mount it under a **versioned** path:

```ts
app.use('/api/v1/esadad', createEsadadRouter(esadad));
// → POST /api/v1/esadad/prepaid/PrepaidValidation?guid=…
```

---

## 🚨 Config mistakes are caught at startup

`new EsadadService(...)` throws an **`EsadadConfigError`** immediately if something is wrong. For example:

```
EsadadConfigError: Service "MOBILE_TOPUP": unsupported currency "NIS"
EsadadConfigError: Cannot open biller PFX (wrong password or unsupported format)
```

So a bad config never reaches production silently. 👍

---

➡️ **Next:** [4. The adapter (your code)](04-adapter.md)
