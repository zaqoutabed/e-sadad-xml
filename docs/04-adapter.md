# 4. The adapter (your code)

⏱ 7 min · 🎯 You'll learn: exactly what to write, what you receive and what to return.

> **TL;DR:** the adapter is an object with up to **3 functions**. Each gets a clean JS object (no XML) and returns a small result. Throw `EsadadError` to send a specific error code.

```ts
const adapter = {
  validatePrepaid(request) { … },  // prepaid: "is this OK?"
  getBills(request) { … },         // postpaid: "what bills?"
  postPayment(trx) { … },          // both: "post this payment"
};
```

All 3 can be `async`. Write only the ones you use.

---

## 1️⃣ `validatePrepaid`: "Can this customer top up this amount?"

**Called by:** PrepaidValidation · **When:** before a prepaid payment.

### You receive

```ts
{
  billingNo: '0599123456',          // ✨ already cleaned by normalizeBillingNo
  originalBillingNo: '970599123456', // exactly what E-SADAD sent
  dueAmount: 20,                     // number (already checked against lowerValue/upperValue)
  validationCode: 'VC-001',
  serviceType: 'MOBILE_TOPUP',
  service: { …your service config… },
  guid: '…',
}
```

### You return

| Situation                    | Return                                                  |
| ---------------------------- | ------------------------------------------------------- |
| ✅ OK                        | `{ valid: true }`                                       |
| ❌ Customer not found        | `{ valid: false }` → **408 Invalid Billing Number**     |
| ❌ Another reason            | `{ valid: false, result: 'INVALID_AMOUNT' }`            |
| ✏️ Change the amount or code | `{ valid: true, dueAmount: 25, validationCode: 'NEW' }` |

### Example

```ts
async validatePrepaid(request) {
  const customer = await db.customers.findByMobile(request.billingNo);
  if (!customer) return { valid: false };
  if (customer.blocked) throw new EsadadError({ code: 410, desc: 'Account Blocked', severity: 'Error' });
  return { valid: true };
}
```

---

## 2️⃣ `getBills`: "What bills does this customer have?"

**Called by:** BillPull · **When:** before a postpaid payment.

### You receive

```ts
{
  billingNo: 'CUST-1001',
  originalBillingNo: 'CUST-1001',
  billNo: undefined,          // set if E-SADAD asks for one specific bill
  serviceType: 'Invoices',
  service: { … },
  guid: '…',
}
```

### You return

| Situation            | Return                                       |
| -------------------- | -------------------------------------------- |
| ❌ Account not found | `{ found: false }` → **408**                 |
| 🧾 Has bills         | `{ found: true, bills: [ … ] }`              |
| 🆓 Nothing due       | `{ found: true, bills: [{ dueAmount: 0 }] }` |

### A bill

Only `dueAmount` is required:

```ts
{
  dueAmount: 45.5,              // required (0 = nothing due)
  billNo: 'INV-1',
  billStatus: 'BillNew',        // default 'BillNew'
  issueDate: new Date(),        // Date or string
  dueDate: '2026-12-01',
  expiryDate: undefined,
  allowPartial: true,           // overrides the service setting
  lowerAmount: 10,              // overrides the service setting
  upperAmount: 45.5,            // overrides the service setting
  subPayments: undefined,       // default: full amount → service bank + IBAN
}
```

📄 Every case in a runnable file: [`examples/postpaid-billpull.ts`](../examples/postpaid-billpull.ts)

---

## 3️⃣ `postPayment`: "The customer paid. Post it."

**Called by:** ReceivePaymentNotification · **When:** after payment.

### You receive

```ts
{
  joebppsTrx: '9001',          // ⭐ E-SADAD transaction number: SAVE IT as your reference
  billingNo: '0599123456',
  billNo: 'B-1',
  paidAmount: 20,              // number
  dueAmount: 20,
  feesAmount: 0,
  currency: 'ILS',
  serviceType: 'MOBILE_TOPUP',
  bankTrxId: 'BT-…',
  processDate: '2026-11-12T10:00:00',
  stmtDate: '2026-11-12',
  paymentMethod: 'ACTDEB',
  accessChannel: 'Internet',
  subPayments: [{ amount: 20, bankCode: '99', accountNo: 'PS00…' }],
  guid: '…',
  service: { … },
}
```

### You return

| Situation      | Return                                                 |
| -------------- | ------------------------------------------------------ |
| ✅ Posted      | nothing (`undefined`) or `{ success: true }`           |
| ❌ Rejected    | `{ success: false, result: 'INVALID_BILLING_NUMBER' }` |
| 💥 System down | **throw**: E-SADAD gets an error and **retries later** |

### 🛡️ Double payments: already handled

```
E-SADAD sends payment 9001  → postPayment() runs ✅ → marked "posted"
E-SADAD retries 9001        → postPayment() does NOT run → "Success" again
```

- If `postPayment` **throws**, the payment is **not** marked posted, so the retry will post it. ✅
- Concurrent duplicates are handled too.
- If the payment **was posted** but saving the "posted" flag fails (database blip), the library retries the save, then still answers **Success** and logs an error. Answering with an error would make E-SADAD retry and post the payment twice.
- ⏳ `adapterTimeoutMs` does **not** apply to `postPayment`: a payment that "timed out" could still finish and then be posted again on retry. Put your own timeout inside `postPayment` only if your billing system can safely cancel.
- 💡 Extra safety: also store `joebppsTrx` with a **unique** constraint in your own database.

### Example

```ts
async postPayment(trx) {
  await db.transaction(async (tx) => {
    await tx.topUps.insert({ mobile: trx.billingNo, amount: trx.paidAmount, reference: trx.joebppsTrx }); // unique reference
    await tx.balances.increment(trx.billingNo, trx.paidAmount);
  });
}
```

---

### 📣 Sending an SMS or e-mail after payment?

Don't put it in `postPayment`: it would slow down E-SADAD's response, and a failed SMS could look like a failed payment. Use the **`onPaymentPosted` hook** instead. → [Hooks](03-configuration.md#hooks-sms-e-mail-metrics)

---

## 🚦 Errors in the adapter: 3 options

| You do                                                                             | E-SADAD sees                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `return { valid: false }` / `{ found: false }`                                     | 408 Invalid Billing Number                                     |
| `throw new EsadadError('INVALID_AMOUNT')`                                          | that code (7 by default)                                       |
| `throw new EsadadError({ code: 410, desc: 'Account Blocked', severity: 'Error' })` | exactly that                                                   |
| `throw new Error('db timeout')` (any other error)                                  | 500 General Error. **Your message is NOT sent** (it's logged). |

More: [6. Errors and result codes](06-errors.md)

---

## ✅ Adapter checklist

- [ ] `validatePrepaid` looks up the **normalised** `billingNo`
- [ ] `getBills` returns `{ found: false }` for unknown accounts
- [ ] `postPayment` saves `joebppsTrx` as a **unique** reference
- [ ] `postPayment` **throws** when your system fails (so E-SADAD retries)
- [ ] No business logic in your route handlers, only in the adapter

---

➡️ **Next:** [5. The APIs, one by one](05-apis.md)
