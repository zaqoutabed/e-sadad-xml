/**
 * Plays the role of E-SADAD against YOUR running server, so you can test the
 * whole flow locally before E-SADAD connects.
 *
 * 1. bash examples/dev-keys.sh                 (creates dev-keys/)
 * 2. start your server with the dev keys, e.g.:
 *      ESADAD_CERT=dev-keys/esadad-dev.cer BILLER_PFX=dev-keys/biller-dev.pfx BILLER_PFX_PASSWORD=dev-password \
 *      AVAILABILITY_TOKEN=dev-token node examples/prepaid-javascript.cjs
 * 3. npx tsx examples/simulate-esadad.ts
 *
 * It sends signed requests (like E-SADAD does) and checks your server's signatures.
 */
import { randomUUID } from 'node:crypto';
import { CertificateSigner, requestAvailability, signMessage, verifyMessage } from 'e-sadad-xml';

const BASE = process.env.SERVER_URL ?? 'http://localhost:3000/api/v1/esadad';

// From E-SADAD's point of view, the roles are swapped:
//   it SIGNS with the E-SADAD private key and VERIFIES with YOUR (biller) certificate.
const esadad = new CertificateSigner({
  billerPrivateKey: { path: 'dev-keys/esadad-dev.key' }, // "my" private key = E-SADAD's
  esadadCertificate: { path: 'dev-keys/biller-dev.cer' }, // "the other side" = the biller
});

/** Sends one signed request and prints what came back. */
async function send(path: string, requestType: string, msgBody: string, guid = randomUUID()) {
  const unsigned = `<MFEP>
    <MsgHeader>
      <TmStp>${new Date().toISOString().slice(0, 19)}</TmStp>
      <GUID>${guid}</GUID>
      <TrsInf><SdrCode>EBPP</SdrCode><RcvCode>999</RcvCode><ReqTyp>${requestType}</ReqTyp></TrsInf>
    </MsgHeader>
    ${msgBody}
    <MsgFooter><Security><Signature></Signature></Security></MsgFooter>
  </MFEP>`;
  const body = await signMessage(unsigned, esadad);

  const res = await fetch(`${BASE}${path}?guid=${guid}`, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const xml = await res.text();
  const signature = await verifyMessage(xml, esadad);
  const codes = [...xml.matchAll(/<ErrorCode>(\d+)<\/ErrorCode><ErrorDesc>([^<]*)</g)].map((m) => `${m[1]} ${m[2]}`);

  console.log(`\n${requestType}  HTTP ${res.status}  signature ${signature.valid ? 'VALID' : 'INVALID'}`);
  console.log(`  results: ${codes.join(' | ')}`);
  return { guid, body };
}

const prepaid = (billingNo: string, amount: string) => `<MsgBody><BillingInfo>
  <AcctInfo><BillingNo>${billingNo}</BillingNo><BillerCode>999</BillerCode></AcctInfo>
  <DueAmt>${amount}</DueAmt><ValidationCode>VC-${Date.now()}</ValidationCode>
  <ServiceTypeDetails><ServiceType>MOBILE_TOPUP</ServiceType></ServiceTypeDetails>
</BillingInfo></MsgBody>`;

const payment = (trx: string, billingNo: string, amount: string) => `<MsgBody><Transactions><TrxInf>
  <AcctInfo><BillingNo>${billingNo}</BillingNo></AcctInfo>
  <JOEBPPSTrx>${trx}</JOEBPPSTrx><BankTrxID>BANK-${trx}</BankTrxID><BankCode>99</BankCode><PmtStatus>PmtNew</PmtStatus>
  <DueAmt>${amount}</DueAmt><PaidAmt>${amount}</PaidAmt><FeesAmt>0</FeesAmt><FeesOnBiller>false</FeesOnBiller>
  <ProcessDate>${new Date().toISOString().slice(0, 19)}</ProcessDate><STMTDate>${new Date().toISOString().slice(0, 10)}</STMTDate>
  <AccessChannel>Internet</AccessChannel><PaymentMethod>ACTDEB</PaymentMethod><PaymentType>Prepaid</PaymentType>
  <Currency>ILS</Currency><ServiceTypeDetails><ServiceType>MOBILE_TOPUP</ServiceType></ServiceTypeDetails>
</TrxInf></Transactions></MsgBody>`;

// --- Scenarios ---------------------------------------------------------------------
// Wrapped in main() so tsx can run this file as CommonJS (no top-level await).
async function main(): Promise<void> {
  console.log('1) Availability');
  console.log(
    await requestAvailability({
      baseUrl: BASE.replace(/\/api\/.*$/, ''),
      path: '/api/v1/esadad/availability',
      token: 'dev-token',
    }),
  );

  console.log('\n2) Prepaid validation: valid number, then invalid number');
  await send('/prepaid/PrepaidValidation', 'BILRPREPADVALRQ', prepaid('0599123456', '20'));
  await send('/prepaid/PrepaidValidation', 'BILRPREPADVALRQ', prepaid('12345', '20'));

  console.log('\n3) Payment, then the same payment again (E-SADAD retry → must NOT top up twice)');
  const trx = String(Date.now());
  const first = await send('/Payment/ReceivePaymentNotification', 'BLRPMTNTFRQ', payment(trx, '0599123456', '20'));
  const res = await fetch(`${BASE}/Payment/ReceivePaymentNotification?guid=${first.guid}`, { method: 'POST', body: first.body });
  console.log(`  retry → HTTP ${res.status}, check your server log: only ONE top-up for trx ${trx}`);

  console.log('\n4) Tampered request (amount changed after signing) → expect 2 Invalid Signature');
  const signed = await signMessage(`<MFEP><MsgHeader><GUID>t-1</GUID></MsgHeader>${prepaid('0599123456', '20')}</MFEP>`, esadad);
  const tampered = signed.replace('<DueAmt>20</DueAmt>', '<DueAmt>2000</DueAmt>');
  const t = await fetch(`${BASE}/prepaid/PrepaidValidation?guid=t-1`, { method: 'POST', body: tampered });
  console.log(`  ${(await t.text()).match(/<ErrorCode>\d+<\/ErrorCode><ErrorDesc>[^<]*/)?.[0]}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
