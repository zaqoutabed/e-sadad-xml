# 11. Troubleshooting

🎯 Find your symptom → follow the fix.

---

## 🔴 "Invalid Signature" (code 2) on every request

Check in this order:

1. **Wrong certificate?** `esadadCertificate` must be **E-SADAD's** `.cer`, not yours.
2. **Body changed before it reached you?** A proxy or middleware that reformats XML, or a JSON body parser, breaks signatures. The library needs the **raw** body.
   - Express: use `createEsadadRouter`. It reads the raw body for you.
   - Don't put `express.json()` or another XML parser **before** the E-SADAD routes.
3. **Test environment vs production certificate mix-up?**
4. **Compare what's being signed.** Print the exact text:

```ts
import { canonicalMsgBody } from 'e-sadad-xml';
console.log(canonicalMsgBody(rawXml));
```

Send it to E-SADAD and ask them to compare with what they signed.

---

## 🔴 E-SADAD says **our** signature is invalid

- [ ] Is the `.pfx` the one that matches the `.cer` you gave E-SADAD?
- [ ] Does anything modify the response after the library (compression is fine; rewriting XML is not)?
- [ ] Check: `openssl pkcs12 -in biller.pfx -nokeys | openssl x509 -noout -fingerprint` matches the certificate E-SADAD has.

---

## 🔴 App crashes at startup with `EsadadConfigError`

Read the message. It names the problem. Common ones:

| Message                                    | Fix                                          |
| ------------------------------------------ | -------------------------------------------- |
| `Cannot open biller PFX (wrong password…)` | Wrong `password`, or the file isn't a `.pfx` |
| `Cannot read E-SADAD certificate`          | Wrong `path`                                 |
| `unsupported currency "NIS"`               | Use `ILS`                                    |
| `Duplicate serviceType`                    | Two services with the same `serviceType`     |
| `Provide either certificates or signer`    | Add `certificates`                           |

---

## 🟠 Always `408 Invalid Billing Number`

- Your `normalizeBillingNo` returns `''` or `null` for that number. Test it: `normalizeMobileNumber('…')`.
- Your adapter returns `{ valid: false }` or `{ found: false }`. Log `request.billingNo`, because it's the **normalised** value (`0599…`, not `970599…`).

---

## 🟠 `5 Invalid Service Type`

- The `ServiceType` in the request isn't in your `services` list (check spelling and case).
- Or it's a **PostPaid** service called via PrepaidValidation (or the reverse).

## 🟠 `7 Invalid Amount`

- Amount ≤ 0, outside `lowerValue`/`upperValue`, or not a plain decimal (`1e3` and `0x10` are rejected on purpose).

## 🟠 `1 Invalid Request`

- Empty or broken XML, or a `DOCTYPE` in the body
- No GUID in the query **and** none in `MsgHeader/GUID`
- A GUID with odd characters (allowed: letters, digits, `{ } . _ -`)
- Query GUID ≠ `MsgHeader/GUID`
- Body over `maxBodyBytes`

## 🟠 `3 Authentication Failed`

- `credentials` is configured but `?username=…&password=…` is missing or wrong.

## 🟠 `500 General Error`

Your adapter (or store) threw an unexpected error. **Look at your logger.** The full error is there (E-SADAD only sees "General Error").

---

## 🟡 A payment was posted twice

This shouldn't happen. Check:

- [ ] You're **not** using `InMemoryStore` with several servers or after restarts
- [ ] Your store's `isPaymentPosted` matches on **`joebppsTrx`**
- [ ] The unique index exists
- [ ] Your own `postPayment` doesn't post again on its own retries

## 🟡 `/availability` returns 503

- `availabilityToken` isn't set, or your `healthCheck` returned `false` or threw.

## 🟡 HTTP 413 / 415 from Express

- 413: body larger than `bodyLimit`
- 415: unknown charset in `Content-Type`

---

## 🆘 Still stuck?

1. Turn on logging: `logger: console`
2. Look at the transaction log rows for that GUID (request and response XML are saved)
3. Reproduce with [`examples/simulate-esadad.ts`](../examples/simulate-esadad.ts)

---

➡️ **Next:** [12. Reference](12-reference.md)
