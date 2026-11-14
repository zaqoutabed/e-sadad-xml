# 5. The APIs, one by one

⏱ 8 min · 🎯 You'll learn: what each request looks like, what goes back, and which step your code runs in.

> **TL;DR:** every API follows the **same 7 steps**. Only step 5 (your adapter) differs.
> Responses are always **HTTP 200** + signed XML. Errors are reported **inside** the XML.

---

## 🔁 The 7 steps (same for every API)

```
1. Read      guid/username/password (query) + XML (body)
2. Log       request → store.logTransaction
3. Payments only: store.logPayment (isPaymentPosted = false)
4. Check     size · XML · GUID · username/password · SIGNATURE
5. Your code adapter.validatePrepaid / getBills / postPayment
6. Sign      the response MsgBody
7. Log       response → store.logTransaction
```

If anything fails in steps 1–5, E-SADAD still gets a **signed error response**.

📐 All messages share this envelope:

```xml
<MFEP>
  <MsgHeader>
    <TmStp>2026-11-12T10:00:00</TmStp>
    <GUID>…</GUID>
    <TrsInf><SdrCode>999</SdrCode><ResTyp>…</ResTyp></TrsInf>
    <Result><ErrorCode>0</ErrorCode><ErrorDesc>Success</ErrorDesc><Severity>Info</Severity></Result>
  </MsgHeader>
  <MsgBody> …depends on the API… </MsgBody>
  <MsgFooter><Security><Signature>base64…</Signature></Security></MsgFooter>
</MFEP>
```

> The library sends XML without line breaks. It's formatted below so it's easier to read.

---

## 1️⃣ PrepaidValidation

|             |                                          |
| ----------- | ---------------------------------------- |
| **Route**   | `POST /prepaid/PrepaidValidation?guid=…` |
| **Types**   | `BILRPREPADVALRQ` → `BILRPREPADVALRS`    |
| **Adapter** | `validatePrepaid(request)`               |
| **Service** | must be `PrePaid`                        |

### Request (from E-SADAD)

```xml
<MsgBody>
  <BillingInfo>
    <AcctInfo><BillingNo>970599123456</BillingNo><BillerCode>999</BillerCode></AcctInfo>
    <DueAmt>20</DueAmt>
    <ValidationCode>VC-001</ValidationCode>
    <ServiceTypeDetails><ServiceType>MOBILE_TOPUP</ServiceType></ServiceTypeDetails>
  </BillingInfo>
</MsgBody>
```

### Automatic checks (before your code)

- [x] `ServiceType` exists and is `PrePaid` → else **5**
- [x] `BillerCode` matches yours → else **4**
- [x] `Currency` (if sent) matches the service → else **6**
- [x] `DueAmt` is a positive number within `lowerValue`–`upperValue` → else **7**
- [x] `BillingNo` passes `normalizeBillingNo` → else **408**

### Response (success)

```xml
<MsgBody>
  <BillingInfo>
    <Result><ErrorCode>0</ErrorCode><ErrorDesc>Success</ErrorDesc><Severity>Info</Severity></Result>
    <AcctInfo><BillingNo>970599123456</BillingNo><BillerCode>999</BillerCode></AcctInfo>
    <DueAmt>20.00</DueAmt>
    <Currency>ILS</Currency>
    <ValidationCode>VC-001</ValidationCode>
    <ServiceTypeDetails><ServiceType>MOBILE_TOPUP</ServiceType></ServiceTypeDetails>
    <SubPmts>
      <SubPmt><Amount>20.00</Amount><SetBnkCode>99</SetBnkCode><AcctNo>PS00XXXX000000000000000000000</AcctNo></SubPmt>
    </SubPmts>
  </BillingInfo>
</MsgBody>
```

💡 `SubPmts` comes from your service config (`bankCode`, `iban`) automatically.

### Response (customer not found)

Same shape, with `<Result><ErrorCode>408</ErrorCode><ErrorDesc>Invalid Billing Number</ErrorDesc>…`. The **header** still says `0 Success`, matching E-SADAD's reference.

---

## 2️⃣ BillPull

|             |                         |
| ----------- | ----------------------- |
| **Route**   | `POST /BillPull?guid=…` |
| **Types**   | `BILPULRQ` → `BILPULRS` |
| **Adapter** | `getBills(request)`     |
| **Service** | must be `PostPaid`      |

> ⚠️ E-SADAD's reference didn't include BillPull, so this layout follows the standard MFEP format. Confirm it with E-SADAD. It lives in one file (`src/messages/billPull.ts`).

### Request

```xml
<MsgBody>
  <AcctInfo><BillingNo>CUST-1001</BillingNo></AcctInfo>
  <ServiceType>Invoices</ServiceType>
</MsgBody>
```

### Response (one bill, JOD)

```xml
<MsgBody>
  <RecCount>1</RecCount>
  <BillsRec>
    <BillRec>
      <Result><ErrorCode>0</ErrorCode><ErrorDesc>Success</ErrorDesc><Severity>Info</Severity></Result>
      <AcctInfo><BillingNo>CUST-1001</BillingNo><BillNo>INV-1</BillNo><BillerCode>999</BillerCode></AcctInfo>
      <BillStatus>BillNew</BillStatus>
      <DueAmount>45.500</DueAmount>
      <IssueDate>2026-11-01T00:00:00</IssueDate>
      <DueDate>2026-11-30T00:00:00</DueDate>
      <ServiceType>Invoices</ServiceType>
      <Currency>JOD</Currency>
      <PmtConst><AllowPart>false</AllowPart><Lower>1.000</Lower></PmtConst>
      <SubPmts><SubPmt><Amount>45.500</Amount><SetBnkCode>99</SetBnkCode><AcctNo>PS00…</AcctNo></SubPmt></SubPmts>
    </BillRec>
  </BillsRec>
</MsgBody>
```

### Response (account not found)

```xml
<MsgBody>
  <RecCount>0</RecCount>
  <BillsRec>
    <BillRec>
      <Result><ErrorCode>408</ErrorCode><ErrorDesc>Invalid Billing Number</ErrorDesc><Severity>Error</Severity></Result>
      <AcctInfo><BillingNo>NOPE</BillingNo><BillerCode>999</BillerCode></AcctInfo>
      <ServiceType>Invoices</ServiceType>
    </BillRec>
  </BillsRec>
</MsgBody>
```

---

## 3️⃣ ReceivePaymentNotification

|             |                                                   |
| ----------- | ------------------------------------------------- |
| **Route**   | `POST /Payment/ReceivePaymentNotification?guid=…` |
| **Types**   | `BLRPMTNTFRQ` → `BLRPMTNTFRS`                     |
| **Adapter** | `postPayment(trx)`, once per transaction          |
| **Service** | any configured service                            |

### Request

```xml
<MsgBody>
  <Transactions>
    <TrxInf>
      <AcctInfo><BillingNo>0599123456</BillingNo><BillNo>B-1</BillNo></AcctInfo>
      <JOEBPPSTrx>9001</JOEBPPSTrx>
      <BankTrxID>BT-9001</BankTrxID>
      <BankCode>99</BankCode>
      <PmtStatus>PmtNew</PmtStatus>
      <DueAmt>20.00</DueAmt>
      <PaidAmt>20.00</PaidAmt>
      <FeesAmt>0.00</FeesAmt>
      <FeesOnBiller>false</FeesOnBiller>
      <ProcessDate>2026-11-12T10:00:00</ProcessDate>
      <STMTDate>2026-11-12</STMTDate>
      <AccessChannel>Internet</AccessChannel>
      <PaymentMethod>ACTDEB</PaymentMethod>
      <PaymentType>Prepaid</PaymentType>
      <Currency>ILS</Currency>
      <ServiceTypeDetails><ServiceType>MOBILE_TOPUP</ServiceType></ServiceTypeDetails>
      <SubPmts>…</SubPmts>
    </TrxInf>
    <!-- there can be several TrxInf -->
  </Transactions>
</MsgBody>
```

### What happens per `TrxInf`

```
validate (JOEBPPSTrx, ServiceType, Currency, PaidAmt > 0, BillingNo)
   │
   ├─ already posted?  → answer 0 Success (no posting: it's a retry)
   │
   └─ not posted       → adapter.postPayment(trx)
                           ├─ ok     → mark posted → 0 Success
                           └─ throws → stays unposted → 500 (E-SADAD retries)
```

### Response

One `TrxInf` per transaction, each with its **own** result:

```xml
<MsgBody>
  <Transactions>
    <TrxInf>
      <JOEBPPSTrx>9001</JOEBPPSTrx>
      <ProcessDate>2026-11-12T10:00:00</ProcessDate>
      <STMTDate>2026-11-12</STMTDate>
      <Result><ErrorCode>0</ErrorCode><ErrorDesc>Success</ErrorDesc><Severity>Info</Severity></Result>
    </TrxInf>
  </Transactions>
</MsgBody>
```

---

## 4️⃣ Availability

|            |                               |
| ---------- | ----------------------------- |
| **Route**  | `GET /availability?token=…`   |
| **Format** | JSON                          |
| **Needs**  | `availabilityToken` in config |

```json
{
  "status": "success",
  "availability": { "response_time": 3, "status_code": 200, "status_message": "OK" },
  "checked_at": "2026-11-12T10:00:00.000Z"
}
```

| HTTP | When                                         |
| ---- | -------------------------------------------- |
| 200  | Token OK and `healthCheck` passed            |
| 401  | Missing or wrong token                       |
| 503  | No token configured, or `healthCheck` failed |

Calling someone else's availability endpoint: [`examples/availability-monitor.ts`](../examples/availability-monitor.ts)

---

## 🧰 Calling the APIs without Express

```ts
const out = await esadad.prepaidValidation({ body: rawXml, guid, username, password });
//    esadad.billPull(...) · esadad.receivePaymentNotification(...) · esadad.handle('BillPull', ...)

out.xml; // → send with HTTP 200, Content-Type: application/xml
out.result; // header result, e.g. { code: 0, desc: 'Success', severity: 'Info' }
out.guid;
```

Ready-made: [`examples/fastify.ts`](../examples/fastify.ts) · [`examples/without-express.ts`](../examples/without-express.ts)

---

➡️ **Next:** [6. Errors and result codes](06-errors.md)
