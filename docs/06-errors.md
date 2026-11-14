# 6. Errors and result codes

⏱ 5 min · 🎯 You'll learn: every code, where it shows up, and how to send your own.

> **TL;DR**
>
> - XML APIs **always** return HTTP 200. The error is **inside** the XML.
> - **Message problems** (bad signature, bad XML, wrong credentials) → error in the header **and** the body.
> - **Business problems** (unknown customer, bad amount) → error in the **body** only; the header says Success.
> - Internal error details are **never** sent to E-SADAD.

---

## 📋 All codes

| Key                      | Code    | Meaning                                         | Confirmed by E-SADAD? |
| ------------------------ | ------- | ----------------------------------------------- | --------------------- |
| `SUCCESS`                | **0**   | All good                                        | ✅ yes                |
| `INVALID_SIGNATURE`      | **2**   | Signature missing or wrong                      | ✅ yes                |
| `INVALID_BILLING_NUMBER` | **408** | Customer/account not found                      | ✅ yes                |
| `INVALID_REQUEST`        | 1       | Broken XML, missing GUID, body too big…         | ⏳ default            |
| `AUTHENTICATION_FAILED`  | 3       | Wrong `username`/`password`                     | ⏳ default            |
| `INVALID_BILLER_CODE`    | 4       | `BillerCode` isn't yours                        | ⏳ default            |
| `INVALID_SERVICE_TYPE`   | 5       | Unknown service, or prepaid/postpaid mismatch   | ⏳ default            |
| `INVALID_CURRENCY`       | 6       | Currency doesn't match the service              | ⏳ default            |
| `INVALID_AMOUNT`         | 7       | Not a positive decimal, or outside the min/max  | ⏳ default            |
| `GENERAL_ERROR`          | 500     | Something unexpected (details logged, not sent) | ⏳ default            |

⏳ = library default. **Change them** once E-SADAD confirms the real numbers:

```ts
new EsadadService({
  …,
  resultCodes: {
    INVALID_AMOUNT: { code: 13, desc: 'Invalid Amount', severity: 'Error' },
  },
});
```

---

## 📍 Where does the error appear?

```
Message problem (signature, XML, GUID, credentials, unexpected crash)
  → Header Result = error
  → Body Result   = error

Business problem (customer, amount, service, currency, your EsadadError)
  → Header Result = 0 Success
  → Body Result   = error
```

For payments, **each transaction** has its own result. One payment can fail while another succeeds in the same request.

---

## 🎯 Sending your own error

From your adapter:

```ts
import { EsadadError } from 'e-sadad-xml';

throw new EsadadError('INVALID_AMOUNT'); // a built-in key
throw new EsadadError({ code: 410, desc: 'Account Suspended', severity: 'Error' }); // anything
```

Or without throwing:

```ts
return { valid: false, result: 'INVALID_AMOUNT' }; // validatePrepaid
return { found: false, result: { code: 411, desc: 'Closed', severity: 'Error' } }; // getBills
return { success: false, result: 'INVALID_BILLING_NUMBER' }; // postPayment
```

---

## 💥 What if my code crashes?

```ts
async validatePrepaid() {
  throw new Error('DB password=secret at 10.0.0.5'); // oops
}
```

- E-SADAD gets **500 General Error**, with no details. ✅
- Your `logger.error` gets the full error. ✅
- The response is still **signed** and **logged**. ✅

---

## 🧱 Errors that are NOT XML

| Error                | When                                                 | What to do                                                 |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| `EsadadConfigError`  | `new EsadadService(...)` with bad config             | Fix the config. The message says exactly what's wrong.     |
| `EsadadSigningError` | Your private key can't sign (broken key or HSM down) | Answer **HTTP 500**. The Express router does this for you. |
| HTTP 413             | Body bigger than `bodyLimit` (Express)               | Normal protection.                                         |
| HTTP 415             | Unsupported charset (Express)                        | Normal protection.                                         |

---

➡️ **Next:** [7. Database store](07-database-store.md)
