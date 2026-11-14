# 3. Configuration

⏱ 5 min · 🎯 You'll learn: every setting, which ones you need, and good defaults.

> **TL;DR:** you need **4 things**: `biller`, `services`, `certificates` and `adapter`. Add a `store` before production. Everything else is optional.

📄 Every option in one runnable file: [`examples/config-options.ts`](../examples/config-options.ts)

---

## 🟢 Required (4)

### 1. `biller`: who you are

```ts
biller: { code: 999, name: 'the app' }
```

- `code`: given to you by E-SADAD. Sent in every response.
- `name`: optional, just for you.

### 2. `services`: what you sell

One entry per E-SADAD **service type**:

```ts
services: [
  {
    serviceType: 'MOBILE_TOPUP',          // the code E-SADAD gave you
    nameEn: 'Mobile TopUp - ILS',         // optional
    nameAr: 'شحن رصيد - بالشيكل',       // optional
    paymentType: 'PrePaid',                // 'PrePaid' or 'PostPaid'
    currency: 'ILS',                       // 'JOD' | 'USD' | 'ILS' | 'EUR' (or 'EURO')
    bankCode: 99,                           // settlement bank
    iban: 'PS00XXXX000000000000000000000', // settlement account
    lowerValue: 1,                         // optional: minimum amount
    upperValue: 1000,                      // optional: maximum amount
    partialPayment: false,                 // optional, postpaid only
  },
]
```

🧠 **Remember:**

| `paymentType` | E-SADAD calls | Your adapter function |
|---|---|---|
| `'PrePaid'` | PrepaidValidation | `validatePrepaid` |
| `'PostPaid'` | BillPull | `getBills` |
| both | ReceivePaymentNotification | `postPayment` |

💰 **Decimals are automatic:** JOD → 3 (`10.000`); USD, ILS, EUR → 2 (`10.00`).

### 3. `certificates`: your keys

```ts
certificates: {
  esadadCertificate: { path: './certs/ESADAD.cer' },                          // from E-SADAD
  billerPfx: { path: './certs/biller.pfx', password: process.env.PFX_PASSWORD! }, // yours
}
```

| Key | What | Used to |
|---|---|---|
| `esadadCertificate` | E-SADAD's **public** certificate (`.cer`/`.crt`, PEM or DER) | **check** incoming requests |
| `billerPfx` | **Your** `.pfx` file plus its password | **sign** your responses |

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

| Option | Why |
|---|---|
| `store` | Saves logs and prevents double payments **across restarts**. The default (`InMemoryStore`) forgets everything when the app stops. → [Database store](07-database-store.md) |
| `logger` | See what's happening. `logger: console` works; so do pino and winston. |

---

## ⚪ Optional

| Option | Default | What it does |
|---|---|---|
| `normalizeBillingNo` | trim spaces | Cleans the billing number before your adapter sees it. Return `null` or `''` to reject it as **408 Invalid Billing Number**. |
| `credentials` | none | `{ username, password }`. E-SADAD must send `?username=…&password=…`. |
| `availabilityToken` | none (endpoint returns 503) | Token for `GET /availability?token=…` |
| `healthCheck` | always healthy | `async () => boolean`, used by `/availability`. Return `false` (or throw) to report "down". |
| `resultCodes` | see [Errors](06-errors.md) | Change error numbers, for example once E-SADAD confirms theirs. |
| `maxBodyBytes` | 512 KB | Bigger requests are rejected. |
| `timestamp` | local `YYYY-MM-DDTHH:mm:ss` | Custom time for `TmStp`. |
| `verifySignature` | `true` | ⚠️ **Never** set `false` in production. |

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

## 🛣️ Express router options

```ts
createEsadadRouter(esadad, {
  bodyLimit: '512kb',
  paths: {
    billPull: '/BillPull',                                         // default
    prepaidValidation: '/prepaid/PrepaidValidation',               // default
    receivePaymentNotification: '/Payment/ReceivePaymentNotification', // default
    availability: '/availability',                                 // default
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
