# 8. Testing

⏱ 6 min · 🎯 You'll learn: 3 ways to test before E-SADAD ever connects.

> **TL;DR**
>
> 1. 🎭 **Simulator:** pretend to be E-SADAD against your running server.
> 2. 🧪 **Automated tests:** call the service directly in vitest/jest. No server needed.
> 3. 🔍 **Manual:** sign a single request and `curl` it.

All three use **dev keys**: `bash examples/dev-keys.sh`

---

## 🔑 First: how dev keys work

Real life:

```
E-SADAD ──(signs with E-SADAD key)──▶ YOU (check with E-SADAD .cer)
E-SADAD ◀──(signs with YOUR .pfx)─── YOU
```

On your laptop, `dev-keys.sh` makes **both** sides:

| Side            | Signs with       | Checks with      |
| --------------- | ---------------- | ---------------- |
| Your server     | `biller-dev.pfx` | `esadad-dev.cer` |
| Pretend E-SADAD | `esadad-dev.key` | `biller-dev.cer` |

So in "pretend E-SADAD" code, the roles look **swapped**. That's expected:

```ts
const esadad = new CertificateSigner({
  billerPrivateKey: { path: 'dev-keys/esadad-dev.key' }, // "my" key   = E-SADAD's
  esadadCertificate: { path: 'dev-keys/biller-dev.cer' }, // "other side" = you
});
```

---

## 1️⃣ The simulator 🎭

📄 [`examples/simulate-esadad.ts`](../examples/simulate-esadad.ts)

```bash
# terminal 1: your server with dev keys
ESADAD_CERT=dev-keys/esadad-dev.cer BILLER_PFX=dev-keys/biller-dev.pfx BILLER_PFX_PASSWORD=dev-password \
AVAILABILITY_TOKEN=dev-token node server.mjs
```

```bash
# terminal 2
npx tsx simulate-esadad.ts
```

It checks:

- [x] Availability works
- [x] A valid customer gets `0 Success`
- [x] An invalid customer gets `408`
- [x] A payment is posted, and a **retry is not** posted again
- [x] A tampered request gets `2 Invalid Signature`
- [x] Every response signature is **VALID**

---

## 2️⃣ Automated tests 🧪

📄 [`examples/testing-your-adapter.test.ts`](../examples/testing-your-adapter.test.ts)

Pattern:

```ts
// 1. sign a request like E-SADAD
const body = await signMessage(`<MFEP><MsgHeader><GUID>g-1</GUID></MsgHeader>${msgBody}</MFEP>`, esadadSide);

// 2. call the service directly (no HTTP)
const out = await service.prepaidValidation({ body, guid: 'g-1' });

// 3. assert
expect(out.xml).toContain('<ErrorCode>0</ErrorCode>');
expect((await verifyMessage(out.xml, esadadSide)).valid).toBe(true);
```

✅ Test ideas:

- [ ] Known customer → `0`
- [ ] Unknown customer → `408`
- [ ] Amount over the limit → `7`
- [ ] Same payment twice → your top-up function called **once**
- [ ] Billing system down (mock throws) → `500`, then the retry succeeds

---

## 3️⃣ Manual: one request with curl 🔍

```ts
// sign-one.ts: prints a signed request
import { CertificateSigner, signMessage } from 'e-sadad-xml';
const esadad = new CertificateSigner({
  billerPrivateKey: { path: 'dev-keys/esadad-dev.key' },
  esadadCertificate: { path: 'dev-keys/biller-dev.cer' },
});
console.log(
  await signMessage(
    `<MFEP><MsgHeader><GUID>manual-1</GUID></MsgHeader>
  <MsgBody><BillingInfo><AcctInfo><BillingNo>0599123456</BillingNo></AcctInfo><DueAmt>10</DueAmt>
  <ServiceTypeDetails><ServiceType>MOBILE_TOPUP</ServiceType></ServiceTypeDetails></BillingInfo></MsgBody></MFEP>`,
    esadad,
  ),
);
```

```bash
npx tsx sign-one.ts > req.xml
curl -s -X POST "http://localhost:3000/api/v1/esadad/prepaid/PrepaidValidation?guid=manual-1" \
     -H "Content-Type: text/xml" --data-binary @req.xml
```

---

## 🧯 Testing tips

- 🔁 Use a **fresh GUID** and a **fresh `JOEBPPSTrx`** per test, unless you're testing retries.
- 📴 `verifySignature: false` skips signature checks, but only use it for a quick local experiment. Signed tests are better and almost as easy.
- 🗃️ `InMemoryStore` exposes `store.transactions` and `store.payments`, so you can assert on logs in tests.

---

➡️ **Next:** [9. Security](09-security.md)
