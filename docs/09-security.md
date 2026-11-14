# 9. Security

⏱ 4 min · 🎯 You'll learn: what's already protected, and the few things **you** must do.

> **TL;DR:** the library blocks the dangerous stuff by default. You must: **HTTPS**, **keep keys secret**, **use a database store**, **hide query strings from logs**.

---

## ✅ Already handled by the library

| Threat | Protection |
|---|---|
| 🎭 Fake requests | Every request's **signature is verified** before your code runs |
| ✏️ Changed amounts | Any change to `MsgBody` breaks the signature → `2` |
| 🔁 Replayed payments | Duplicates detected by the signed `JOEBPPSTrx` → never posted twice |
| 🏃 Concurrent duplicates | Serialised per payment (plus the DB unique index across servers) |
| 💣 XML attacks (XXE, "billion laughs") | `DOCTYPE` is rejected outright |
| 🐘 Huge requests | Size limit (512 KB default) |
| 💉 XML injection | Every value in a response is escaped |
| 🔢 Weird amounts (`0x10`, `1e3`, `Infinity`) | Only plain decimals are accepted |
| 🕵️ Leaking internals | Error details go to your logger, **never** to E-SADAD |
| ⏱️ Timing attacks on secrets | Tokens and passwords compared in constant time |
| 🧾 GUID tricks | Format checked; must match `MsgHeader/GUID` when both are sent |

---

## 📝 Your checklist

- [ ] **HTTPS only.** Never expose these endpoints over plain HTTP.
- [ ] **Keys out of git.** `.pfx`, its password and tokens go in env vars or a secret manager.
- [ ] **Database store** with the unique index (see [Database store](07-database-store.md)).
- [ ] **Hide query strings in logs.** `username`, `password` and `token` arrive in the URL (E-SADAD's design). Configure nginx or your load balancer **not** to log query strings for these routes.
- [ ] **Allow-list E-SADAD's IPs** at the firewall or reverse proxy, if they publish them.
- [ ] **Rate limit** the endpoints at the proxy.
- [ ] **`verifySignature` stays `true`.** Never ship `false`.
- [ ] **Keep Node.js updated** to a supported security release (22 / 24 / 26).
- [ ] `app.disable('x-powered-by')` in Express.

---

## 🔐 Storing the key safely

```ts
// ✅ From a secret manager / env var (no file on disk)
certificates: {
  esadadCertificate: { data: process.env.ESADAD_CERT_PEM! },
  billerPfx: { data: Buffer.from(process.env.BILLER_PFX_BASE64!, 'base64'), password: process.env.BILLER_PFX_PASSWORD! },
}
```

```bash
# make the base64 value once
base64 -w0 biller.pfx
```

🏦 Highest security: keep the key in an **HSM or cloud KMS** with a custom `signer`. See [`examples/custom-signer.ts`](../examples/custom-signer.ts).

---

➡️ **Next:** [10. Going live checklist](10-going-live.md)
