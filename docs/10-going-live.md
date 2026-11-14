# 10. Going live checklist

⏱ 3 min · 🎯 Tick everything, then go live.

> **TL;DR:** real certificates · real adapter · database store · confirmed codes · security checklist · one full test with E-SADAD.

---

## 📨 Get from E-SADAD

- [ ] Your **biller code** (the app: `999`)
- [ ] **ServiceType** codes, bank code and IBAN for each service
- [ ] E-SADAD's **public certificate** (`.cer`)
- [ ] Their official **result codes** (to replace the ⏳ defaults, see [Errors](06-errors.md))
- [ ] A **BillPull sample**, if you have post-paid services
- [ ] Whether they'll send `username`/`password`, and the values
- [ ] Their **IP addresses** (for the firewall)
- [ ] The **availability token** arrangement

## 📤 Give to E-SADAD

- [ ] Your **public certificate** (the `.cer` that matches your `.pfx`)
- [ ] Your endpoint URLs, for example:
  - `https://api.example.com/api/v1/esadad/prepaid/PrepaidValidation`
  - `https://api.example.com/api/v1/esadad/Payment/ReceivePaymentNotification`
  - `https://api.example.com/api/v1/esadad/BillPull`
  - `https://api.example.com/api/v1/esadad/availability`

Create your production key pair (keep the `.key`/`.pfx` **secret**):

```bash
openssl req -newkey rsa:2048 -nodes -keyout biller.key -out biller.csr -subj "/CN=your-company"
# send biller.csr to E-SADAD if they issue the certificate, or self-sign if they accept that:
openssl x509 -req -in biller.csr -signkey biller.key -days 730 -out biller.cer
openssl pkcs12 -export -inkey biller.key -in biller.cer -out biller.pfx
```

## ⚙️ Your configuration

- [ ] Real `biller.code` and `services`
- [ ] Real certificates, loaded from **secrets** (not committed)
- [ ] `store` = a **database** store, with the schema applied (including the unique index)
- [ ] `resultCodes` updated if E-SADAD gave different numbers
- [ ] `credentials` set if E-SADAD uses them
- [ ] `availabilityToken` and `healthCheck` set
- [ ] `logger` connected to your log system
- [ ] `verifySignature` **not** set to `false`

## 🧑‍💻 Your adapter

- [ ] Real lookups, not stubs
- [ ] `postPayment` saves `joebppsTrx` with a **unique** constraint
- [ ] `postPayment` **throws** when your system fails
- [ ] Automated tests pass (see [Testing](08-testing.md))

## 🛡️ Security

- [ ] Everything in the [Security checklist](09-security.md)

## 🧪 With E-SADAD (test environment)

- [ ] Availability check passes
- [ ] Prepaid validation: valid customer and invalid customer
- [ ] BillPull: with bills, nothing due, not found (post-paid only)
- [ ] Payment received and posted
- [ ] Payment retried and **not** posted twice
- [ ] Your logs show both requests and responses

🎉 All ticked? **Go live.**

---

➡️ **Next:** [11. Troubleshooting](11-troubleshooting.md)
