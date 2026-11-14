# 7. Database store

⏱ 5 min · 🎯 You'll learn: why you need a store, and how to plug in SQL Server or PostgreSQL.

> **TL;DR**
>
> - The **store** saves request/response logs and payment logs (required by E-SADAD).
> - It's also what **prevents double payments**.
> - `InMemoryStore` is for development only: it forgets everything on restart. 🚫 production
> - Copy a ready-made store: **SQL Server** or **PostgreSQL**.

---

## 🧱 What a store does (4 functions)

```ts
interface EsadadStore {
  logTransaction(entry); // every request and response → EsadadTransactionsLogs
  logPayment(entry); // every payment received     → EsadadPaymentsLogs (posted = false)
  isPaymentPosted(joebppsTrx, guid); // "did we already post this payment?"
  markPaymentPosted(joebppsTrx, guid); // "we posted it" → latest row = true
}
```

They can be `async`.

---

## 🚀 Ready-made stores (copy into your project)

| Database   | Tables                                                         | Store class                                              | Package       |
| ---------- | -------------------------------------------------------------- | -------------------------------------------------------- | ------------- |
| SQL Server | [`schema.sqlserver.sql`](../examples/sql/schema.sqlserver.sql) | [`sqlServerStore.ts`](../examples/sql/sqlServerStore.ts) | `npm i mssql` |
| PostgreSQL | [`schema.postgres.sql`](../examples/sql/schema.postgres.sql)   | [`postgresStore.ts`](../examples/sql/postgresStore.ts)   | `npm i pg`    |

### Steps

1. Run the schema file on your database.
2. Copy the store file into your project.
3. Pass it in:

```ts
import { Pool } from 'pg';
import { PostgresStore } from './postgresStore';

const esadad = new EsadadService({
  …,
  store: new PostgresStore(new Pool({ connectionString: process.env.DATABASE_URL })),
});
```

```ts
import sql from 'mssql';
import { SqlServerStore } from './sqlServerStore';

const pool = await sql.connect(process.env.MSSQL_URL!);
const esadad = new EsadadService({ …, store: new SqlServerStore(pool) });
```

---

## 🗂️ What gets saved

**EsadadTransactionsLogs**: one row per request and per response:

| Column                     | Example                 |
| -------------------------- | ----------------------- |
| TransactionType            | `Request` / `Response`  |
| Api                        | `PrepaidValidation`     |
| Guid                       | `a1b2…`                 |
| BillingNumber / BillNumber | `0599123456` / `B-1`    |
| ServiceType / Currency     | `MOBILE_TOPUP` / `ILS` |
| ResultCode                 | `0` (responses only)    |
| XmlElement                 | the full XML            |
| InsertDateTime             | now                     |

**EsadadPaymentsLogs**: one row per payment received:

| Column                                           | Example                        |
| ------------------------------------------------ | ------------------------------ |
| Guid, JoebppsTrx                                 | `a1b2…`, `9001`                |
| BillingNumber, BillNumber, ServiceType, Currency | …                              |
| PaidAmount                                       | `20.000`                       |
| IsPaymentPosted                                  | `false` → `true` after posting |

---

## ❓ Why does it check `JOEBPPSTrx`, not the GUID?

Short version: **security**.

- The GUID arrives in the URL, which is **not signed**. Someone could resend an old, valid payment with a **new** GUID.
- `JOEBPPSTrx` is **inside the signed XML**, so it can't be changed.
- Checking `JOEBPPSTrx` means a replayed payment is **never posted twice**. ✅

The GUID is still saved in every row.

---

## 🧯 Several servers? Add the unique index

Both schema files include:

```sql
-- a payment can be marked "posted" only once
CREATE UNIQUE INDEX … ON EsadadPaymentsLogs (JoebppsTrx) WHERE IsPaymentPosted = 1;
```

The library already blocks duplicates **inside one process**. This index blocks them **across all your servers**. Keep it.

---

## ✍️ Writing your own store (MongoDB, Prisma, …)

Implement the 4 functions:

```ts
import type { EsadadStore } from 'e-sadad-xml';

export const myStore: EsadadStore = {
  async logTransaction(e) {
    await db.transactionLogs.insert(e);
  },
  async logPayment(e) {
    await db.paymentLogs.insert(e);
  },
  async isPaymentPosted(joebppsTrx) {
    return (await db.paymentLogs.count({ joebppsTrx, isPaymentPosted: true })) > 0;
  },
  async markPaymentPosted(joebppsTrx) {
    const latest = await db.paymentLogs.findLatest({ joebppsTrx });
    await db.paymentLogs.update(latest.id, { isPaymentPosted: true });
  },
};
```

⚠️ Rules:

- [ ] Match payments on **`joebppsTrx`**, not only the GUID
- [ ] Use parameterised queries (no string-built SQL)
- [ ] Let errors **throw**. For payments, the library turns them into an error so E-SADAD retries.

ℹ️ If `logTransaction` fails, the library logs it and **still answers** E-SADAD (an audit-log failure shouldn't block a payment).

---

➡️ **Next:** [8. Testing](08-testing.md)
