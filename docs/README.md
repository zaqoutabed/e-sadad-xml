# 📘 e-sadad-xml: the guide

> **TL;DR:** E-SADAD sends your server XML requests. This library reads them, checks them, asks **your code** a simple question ("does this customer exist?", "post this payment"), and sends back a correct, signed answer.
>
> **You write about 20 lines. The library does the rest.**

---

## 🗺️ Pick your path

| I want to… | Read this | Time |
|---|---|---|
| Understand what this is | [1. The big picture](01-big-picture.md) | ⏱ 3 min |
| **Get it running now** | [2. Quick start](02-quick-start.md) | ⏱ 10 min |
| See every setting | [3. Configuration](03-configuration.md) | ⏱ 5 min |
| Connect my billing system | [4. The adapter (your code)](04-adapter.md) | ⏱ 7 min |
| See the XML for each API | [5. The APIs, one by one](05-apis.md) | ⏱ 8 min |
| Understand errors and codes | [6. Errors and result codes](06-errors.md) | ⏱ 5 min |
| Save logs in a database | [7. Database store](07-database-store.md) | ⏱ 5 min |
| Test before E-SADAD connects | [8. Testing](08-testing.md) | ⏱ 6 min |
| Make sure it's safe | [9. Security](09-security.md) | ⏱ 4 min |
| Go to production | [10. Going live checklist](10-going-live.md) | ⏱ 3 min |
| Fix a problem | [11. Troubleshooting](11-troubleshooting.md) | ⏱ as needed |
| Look up a function | [12. Reference](12-reference.md) | ⏱ as needed |

👉 **New here?** Read 1 → 2 → 4. That's enough to build a working integration.

---

## 🧩 Examples

Every example runs. Full list: [`examples/README.md`](../examples/README.md).

| Example | Shows |
|---|---|
| [`prepaid-typescript.ts`](../examples/prepaid-typescript.ts) | A complete prepaid integration (TypeScript + Express) |
| [`prepaid-javascript.cjs`](../examples/prepaid-javascript.cjs) | The same in plain JavaScript (`require`) |
| [`esm-javascript.mjs`](../examples/esm-javascript.mjs) | Plain JavaScript with `import` |
| [`postpaid-billpull.ts`](../examples/postpaid-billpull.ts) | Post-paid bills (every BillPull outcome) |
| [`simulate-esadad.ts`](../examples/simulate-esadad.ts) | Pretend to be E-SADAD and test your server |

---

## 📌 Words you'll see a lot

| Word | Meaning |
|---|---|
| **Biller** | You: the company receiving payments (for example the app, code `999`). |
| **E-SADAD** | The payment network that calls your server. |
| **Billing number** (`BillingNo`) | The customer's ID at your company, such as a mobile number or account number. |
| **Service type** (`ServiceType`) | One product you sell through E-SADAD, for example `MOBILE_TOPUP`. |
| **Prepaid** | The customer pays first, for example a top-up. Uses **PrepaidValidation**. |
| **Postpaid** | The customer pays a bill. Uses **BillPull**. |
| **GUID** | The unique ID of one E-SADAD request. |
| **JOEBPPSTrx** | E-SADAD's transaction number for a payment. Use it as your payment reference. |
| **Signature** | Proof the message wasn't changed. E-SADAD signs requests; you sign responses. |
| **Adapter** | The small object where **your** code lives. |
| **Store** | Where request/response logs and payment logs are saved. |
