# 🧩 Examples

Every example here is type-checked and was run against the library.

> **Start with:** `bash examples/dev-keys.sh` → creates `dev-keys/` (throw-away keys, never commit them).
> Then run any example: `npx tsx examples/<file>.ts` or `node examples/<file>.cjs|.mjs`

---

## 🚀 Complete servers

| File | Language | What it shows |
|---|---|---|
| [`hatcard-typescript.ts`](hatcard-typescript.ts) | TypeScript | HatCard prepaid top-up with Express, config from env vars |
| [`hatcard-javascript.cjs`](hatcard-javascript.cjs) | JavaScript (`require`) | The same, in CommonJS |
| [`esm-javascript.mjs`](esm-javascript.mjs) | JavaScript (`import`) | The same, in ES modules |
| [`postpaid-billpull.ts`](postpaid-billpull.ts) | TypeScript | Post-paid bills: found, nothing due, not found, custom error |
| [`multiple-services.ts`](multiple-services.ts) | TypeScript | ILS + USD prepaid and JOD invoices, with billing-number rules per service |
| [`config-options.ts`](config-options.ts) | TypeScript | **Every** option explained (credentials, result codes, logger, health check, routes…) |

## 🔌 Other frameworks

| File | What it shows |
|---|---|
| [`fastify.ts`](fastify.ts) | Fastify (raw body for all content types) |
| [`without-express.ts`](without-express.ts) | Plain `node:http`. The same pattern works for Koa, NestJS, Hono. |

## 🗃️ Databases

| File | What it shows |
|---|---|
| [`sql/schema.sqlserver.sql`](sql/schema.sqlserver.sql) + [`sql/sqlServerStore.ts`](sql/sqlServerStore.ts) | SQL Server store (`mssql`) |
| [`sql/schema.postgres.sql`](sql/schema.postgres.sql) + [`sql/postgresStore.ts`](sql/postgresStore.ts) | PostgreSQL store (`pg`) |

## 🧪 Testing

| File | What it shows |
|---|---|
| [`dev-keys.sh`](dev-keys.sh) | Create development keys and certificates |
| [`simulate-esadad.ts`](simulate-esadad.ts) | Pretend to be E-SADAD against your running server (validation, payment, retry, tampering) |
| [`testing-your-adapter.test.ts`](testing-your-adapter.test.ts) | Automated vitest tests for your integration |

## 🔧 Advanced

| File | What it shows |
|---|---|
| [`custom-signer.ts`](custom-signer.ts) | Key in an env var, HSM or cloud KMS instead of a file |
| [`availability-monitor.ts`](availability-monitor.ts) | Check an availability endpoint every minute |
| [`utilities.ts`](utilities.ts) | Phone numbers, amounts, signing/verifying, constants |

---

📘 Full guide: [`docs/README.md`](../docs/README.md)
