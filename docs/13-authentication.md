# 🔑 13. Authentication API

> **TL;DR:** E-SADAD sends `POST /authentication` with a shared **user** and **secret**, signed with E-SADAD's key. You answer with a **token** valid for 7 days, signed with your key. Add 3 lines of config; the library does the rest.

⏱ 5 min

---

## 1️⃣ Turn it on

```ts
const esadad = new EsadadService({
  // ...biller, services, certificates, adapter, store...
  authentication: {
    user: process.env.ESADAD_AUTH_USER!, // the shared user you gave E-SADAD
    secret: process.env.ESADAD_AUTH_SECRET!, // the shared secret you gave E-SADAD
    tokenStore: myTokenStore, // recommended in production (see step 4)
  },
});

app.use('/api/v1/esadad', createEsadadRouter(esadad)); // now serves POST /authentication too
```

✅ That's it. The route exists only when `authentication` is set.

⚠️ Keep `user` and `secret` in environment variables or a secret manager, never in git.

---

## 2️⃣ What E-SADAD sends

```json
{
  "data": { "user": "sharedUserName", "secret": "sharedSecret", "tranTimestamp": "2025-05-07T12:34:56Z" },
  "signature": "Base64 signature made with E-SADAD's private key"
}
```

The signed text is the `data` values **in order, joined with `|`**, as UTF-8:

```
sharedUserName|sharedSecret|2025-05-07T12:34:56Z
```

RSA, SHA-256, PKCS#1 v1.5, Base64. The same keys as the XML APIs: E-SADAD's certificate verifies, your `.pfx` signs.

---

## 3️⃣ What you answer

| When                                        | HTTP | `data`                                                                    |
| ------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| ✅ All good                                 | 200  | `{ token, expiryDate, tranTimestamp }`                                    |
| 🔏 Signature wrong                          | 401  | `{ status: "error", message: "Invalid signature", error_code: 401, ... }` |
| ⏰ `tranTimestamp` more than 10 min off     | 401  | `message: "Request expired"`                                              |
| 🙅 Wrong user or secret                     | 401  | `message: "Invalid user credentials"`                                     |
| 🧩 Not JSON, a field missing, bad timestamp | 400  | `message: "Invalid request"`                                              |
| 💥 Token could not be saved                 | 500  | `message: "Internal error"`                                               |

Every answer is signed with your private key, over its `data` values joined with `|`:

```json
{
  "data": {
    "token": "d1251a3bafa6957328e6fb7f24b07058f0de2eb193bebcfb1a18b2b5b3f1a23b",
    "expiryDate": "2025-05-14T12:34:56Z",
    "tranTimestamp": "2025-05-07T12:34:56Z"
  },
  "signature": "Base64 signature made with your private key"
}
```

🔐 The token is `SHA-256(user:tranTimestamp:random UUID)` as lowercase hex, as the document describes. Every call gives a new one.

---

## 4️⃣ Where tokens are kept

By default tokens live **in memory**: fine for development, gone on restart, not shared between servers.

For production, give it a store. It only ever sees the **SHA-256 hash** of each token, so a database leak doesn't leak usable tokens:

```ts
const tokenStore: AccessTokenStore = {
  async saveAccessToken(r) {
    await db.query(
      'INSERT INTO esadad_access_tokens (token_hash, esadad_user, issued_at, expires_at, tran_timestamp) VALUES ($1, $2, $3, $4, $5)',
      [r.tokenHash, r.user, r.issuedAt, r.expiresAt, r.tranTimestamp],
    );
  },
  async findAccessToken(tokenHash) {
    const { rows } = await db.query('SELECT * FROM esadad_access_tokens WHERE token_hash = $1', [tokenHash]);
    const row = rows[0];
    return (
      row && {
        tokenHash,
        user: row.esadad_user,
        issuedAt: row.issued_at,
        expiresAt: row.expires_at,
        tranTimestamp: row.tran_timestamp,
      }
    );
  },
};
```

🧹 Delete expired rows now and then (`DELETE FROM esadad_access_tokens WHERE expires_at < now()`).

---

## 5️⃣ Checking the token (optional)

The document does not say how E-SADAD sends the token on later calls. If it is `Authorization: Bearer <token>`:

```ts
app.use('/api/v1/esadad', createEsadadRouter(esadad, { requireAccessToken: true }));
// XML routes without a valid token → HTTP 401
```

Any other way (another header, a query parameter): check it yourself.

```ts
if (!(await esadad.verifyAccessToken(token))) return res.status(401).end();
```

⚠️ Turn this on only after E-SADAD confirms how they send the token, or every request gets 401.

---

## ⚙️ All options

| Option                    | Default            | What                                                                            |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| `user`, `secret`          | required           | The shared credentials                                                          |
| `tokenTtlMs`              | 7 days             | Token lifetime                                                                  |
| `maxClockSkewMs`          | 10 minutes         | Largest accepted `tranTimestamp` difference from your clock. `false` = no check |
| `requestSignatureFormats` | `['pipe', 'json']` | Signed-text formats accepted on requests, tried in order                        |
| `responseSignatureFormat` | `'pipe'`           | Signed-text format of your answers                                              |
| `tokenStore`              | in memory          | Where tokens are kept                                                           |

💡 **Why two formats?** The document shows the pipe format (`user|secret|time`) and, in one place, compact JSON (`{"user":"...","secret":"...","tranTimestamp":"..."}`). Requests accept both. Answers use pipe; if E-SADAD expects JSON, set `responseSignatureFormat: 'json'`.

---

## 🧪 Test it

```ts
import { authSigningString, CertificateSigner } from 'e-sadad-xml';

// Pretend to be E-SADAD: sign with the E-SADAD dev key.
const esadadSide = new CertificateSigner({
  billerPrivateKey: { path: 'dev-keys/esadad-dev.key' },
  esadadCertificate: { path: 'dev-keys/biller-dev.cer' },
});
const data = { user: 'dev-user', secret: 'dev-secret', tranTimestamp: new Date().toISOString().slice(0, 19) + 'Z' };
const body = { data, signature: esadadSide.signUtf8(authSigningString(data, 'pipe')) };
```

`examples/simulate-esadad.ts` does this for you (step 0) when the server has `ESADAD_AUTH_USER` and `ESADAD_AUTH_SECRET`.

👉 Next: [Security](09-security.md) · [Going live](10-going-live.md)
