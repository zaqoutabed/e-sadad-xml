# 2. Quick start

⏱ 10 min · 🎯 You'll have a working E-SADAD server on your laptop.

> **TL;DR:** install → make dev keys → paste the server code → run → test with the simulator.

---

## ✅ Before you start

- [ ] Node.js **22.23.5+**, **24.22.3+** or **26.13.1+** (`node -v`)
- [ ] An Express project (or `npm init -y` in a new folder)
- [ ] `openssl` (only for dev keys)

---

## Step 1: Install

```bash
npm install github:zaqoutabed/e-sadad-xml express
```

TypeScript users, also run:

```bash
npm install -D typescript tsx @types/express @types/node
```

---

## Step 2: Make dev keys 🔑

E-SADAD gives you **real** certificates later. For now, make throw-away ones:

```bash
bash node_modules/e-sadad-xml/examples/dev-keys.sh
```

You now have a `dev-keys/` folder:

| File             | Role                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| `esadad-dev.cer` | Pretends to be E-SADAD's certificate. **Your server** uses it to check requests.     |
| `esadad-dev.key` | Pretends to be E-SADAD's private key. **The simulator** uses it to sign requests.    |
| `biller-dev.pfx` | **Your** private key (password `dev-password`). Your server signs responses with it. |
| `biller-dev.cer` | Your certificate. The simulator uses it to check your responses.                     |

> ⚠️ Add `dev-keys/` to `.gitignore`. **Never commit keys.**

---

## Step 3: Create the server

Create `server.ts` (TypeScript) or `server.mjs` (JavaScript; just remove the types):

```ts
import express from 'express';
import { EsadadService, InMemoryStore, normalizeMobileNumber } from 'e-sadad-xml';
import { createEsadadRouter } from 'e-sadad-xml/express';

const esadad = new EsadadService({
  // 1️⃣ Who you are
  biller: { code: 999, name: 'My Company' }, // dummy: use your biller code from E-SADAD

  // 2️⃣ What you sell
  services: [
    {
      serviceType: 'MOBILE_TOPUP',
      paymentType: 'PrePaid',
      currency: 'ILS',
      bankCode: 99,
      iban: 'PS00XXXX000000000000000000000', // dummy: use your settlement IBAN
    },
  ],

  // 3️⃣ Your keys
  certificates: {
    esadadCertificate: { path: 'dev-keys/esadad-dev.cer' },
    billerPfx: { path: 'dev-keys/biller-dev.pfx', password: 'dev-password' },
  },

  // 4️⃣ Billing number = mobile number → clean it up (970599… → 0599…)
  normalizeBillingNo: normalizeMobileNumber,

  // 5️⃣ YOUR CODE (replace with real lookups)
  adapter: {
    async validatePrepaid(request) {
      const exists = request.billingNo.startsWith('059'); // ← your database lookup
      return { valid: exists };
    },
    async postPayment(trx) {
      console.log(`💰 Top up ${trx.billingNo} with ${trx.paidAmount} (ref ${trx.joebppsTrx})`); // ← your top-up
    },
  },

  // 6️⃣ Where logs go (use a database in production)
  store: new InMemoryStore(),
  availabilityToken: 'dev-token',
  logger: console,
});

const app = express();
app.use('/api/v1/esadad', createEsadadRouter(esadad));
app.listen(3000, () => console.log('✅ Ready on http://localhost:3000/api/v1/esadad'));
```

---

## Step 4: Run it

```bash
npx tsx server.ts        # TypeScript
node server.mjs          # JavaScript
```

You should see: `✅ Ready on http://localhost:3000/api/v1/esadad`

Quick health check:

```bash
curl "http://localhost:3000/api/v1/esadad/availability?token=dev-token"
```

→ `{"status":"success", ...}` 🎉

---

## Step 5: Pretend to be E-SADAD 🎭

Copy [`examples/simulate-esadad.ts`](../examples/simulate-esadad.ts) into your project and run:

```bash
npx tsx simulate-esadad.ts
```

You'll see:

```
BILRPREPADVALRQ  HTTP 200  signature VALID
  results: 0 Success | 0 Success
BILRPREPADVALRQ  HTTP 200  signature VALID
  results: 0 Success | 408 Invalid Billing Number
BLRPMTNTFRQ  HTTP 200  signature VALID
  results: 0 Success | 0 Success
  retry → HTTP 200, check your server log: only ONE top-up
  <ErrorCode>2</ErrorCode><ErrorDesc>Invalid Signature
```

And in your server log, **one** `💰 Top up …` line, even though the payment was sent twice. ✅

---

## 🏁 Done! What now?

- [ ] Replace the adapter stubs with real lookups → [The adapter](04-adapter.md)
- [ ] Replace `InMemoryStore` with a database → [Database store](07-database-store.md)
- [ ] Get the real certificates from E-SADAD → [Going live](10-going-live.md)

---

➡️ **Next:** [3. Configuration](03-configuration.md)
