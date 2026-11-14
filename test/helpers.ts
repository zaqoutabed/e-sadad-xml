import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';
import {
  CertificateSigner,
  EsadadService,
  InMemoryStore,
  normalizeMobileNumber,
  signMessage,
  type BillerAdapter,
  type EsadadConfig,
  type MessageSigner,
} from '../src';

/** Creates an RSA key pair, a self-signed certificate (PEM) and a PFX holding both. */
export function createIdentity(name: string, password = 'test-password') {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(keyPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: 'commonName', value: name }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forgeKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  const p12 = forge.pkcs12.toPkcs12Asn1(forgeKey, [cert], password, { algorithm: 'aes256' });
  const pfx = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
  return { keyPem, certPem, pfx, password };
}

// Generated once per test file (RSA key generation is slow).
export const esadadIdentity = createIdentity('E-SADAD');
export const billerIdentity = createIdentity('Biller');

/** Signs like E-SADAD does: E-SADAD private key; verifies biller responses with the biller certificate. */
export const esadadSide: MessageSigner = new CertificateSigner({
  esadadCertificate: { data: billerIdentity.certPem },
  billerPrivateKey: { data: esadadIdentity.keyPem },
});

export const PREPAID_SERVICE = {
  serviceType: 'MOBILE_TOPUP',
  nameEn: 'Mobile TopUp - ILS',
  nameAr: 'شحن رصيد - بالشيكل',
  paymentType: 'PrePaid',
  currency: 'ILS',
  bankCode: 99,
  iban: 'PS00XXXX000000000000000000000',
  lowerValue: 1,
  upperValue: 1000,
} as const;

export const POSTPAID_SERVICE = {
  serviceType: 'Invoices',
  paymentType: 'PostPaid',
  currency: 'JOD',
  bankCode: 99,
  iban: 'PS00TEST000000000000000000000',
  partialPayment: true,
  lowerValue: 1,
} as const;

export function createService(adapter: BillerAdapter, overrides: Partial<EsadadConfig> = {}) {
  const store = new InMemoryStore();
  const service = new EsadadService({
    biller: { code: 999, name: 'the app' },
    services: [PREPAID_SERVICE, POSTPAID_SERVICE],
    certificates: {
      esadadCertificate: { data: esadadIdentity.certPem },
      billerPfx: { data: billerIdentity.pfx, password: billerIdentity.password },
    },
    normalizeBillingNo: (billingNo, serviceType) =>
      serviceType === 'MOBILE_TOPUP' ? normalizeMobileNumber(billingNo) : billingNo.trim(),
    adapter,
    store,
    timestamp: () => '2026-11-12T10:00:00',
    ...overrides,
  });
  return { service, store };
}

/** Wraps a `<MsgBody>` in an MFEP envelope and signs it as E-SADAD. */
export function esadadRequest(guid: string, requestType: string, msgBody: string): Promise<string> {
  const xml = `<MFEP>
  <MsgHeader>
    <TmStp>2026-11-12T09:59:00</TmStp>
    <GUID>${guid}</GUID>
    <TrsInf><SdrCode>EBPP</SdrCode><RcvCode>999</RcvCode><ReqTyp>${requestType}</ReqTyp></TrsInf>
  </MsgHeader>
  ${msgBody}
  <MsgFooter><Security><Signature></Signature></Security></MsgFooter>
</MFEP>`;
  return signMessage(xml, esadadSide);
}

export function prepaidBody(
  opts: { billingNo?: string; amount?: string; serviceType?: string; billerCode?: string; currency?: string } = {},
) {
  return `<MsgBody>
    <BillingInfo>
      <AcctInfo><BillingNo>${opts.billingNo ?? '0599123456'}</BillingNo><BillerCode>${opts.billerCode ?? '999'}</BillerCode></AcctInfo>
      <DueAmt>${opts.amount ?? '20'}</DueAmt>
      ${opts.currency ? `<Currency>${opts.currency}</Currency>` : ''}
      <ValidationCode>VC-001</ValidationCode>
      <ServiceTypeDetails><ServiceType>${opts.serviceType ?? 'MOBILE_TOPUP'}</ServiceType></ServiceTypeDetails>
    </BillingInfo>
  </MsgBody>`;
}

export function paymentTrx(opts: { trx: string; billingNo?: string; paid?: string; serviceType?: string; currency?: string }) {
  return `<TrxInf>
    <AcctInfo><BillingNo>${opts.billingNo ?? '0599123456'}</BillingNo><BillNo>B-1</BillNo></AcctInfo>
    <JOEBPPSTrx>${opts.trx}</JOEBPPSTrx>
    <BankTrxID>BT-${opts.trx}</BankTrxID>
    <BankCode>99</BankCode>
    <PmtStatus>PmtNew</PmtStatus>
    <DueAmt>${opts.paid ?? '20.00'}</DueAmt>
    <PaidAmt>${opts.paid ?? '20.00'}</PaidAmt>
    <FeesAmt>0.00</FeesAmt>
    <FeesOnBiller>false</FeesOnBiller>
    <ProcessDate>2026-11-12T10:00:00</ProcessDate>
    <STMTDate>2026-11-12</STMTDate>
    <AccessChannel>Internet</AccessChannel>
    <PaymentMethod>ACTDEB</PaymentMethod>
    <PaymentType>Prepaid</PaymentType>
    <Currency>${opts.currency ?? 'ILS'}</Currency>
    <ServiceTypeDetails><ServiceType>${opts.serviceType ?? 'MOBILE_TOPUP'}</ServiceType></ServiceTypeDetails>
    <SubPmts><SubPmt><Amount>${opts.paid ?? '20.00'}</Amount><SetBnkCode>99</SetBnkCode><AcctNo>PS00XXXX000000000000000000000</AcctNo></SubPmt></SubPmts>
  </TrxInf>`;
}

export const paymentBody = (...trx: string[]) => `<MsgBody><Transactions>${trx.join('')}</Transactions></MsgBody>`;
