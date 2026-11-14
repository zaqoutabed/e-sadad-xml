/**
 * How to write automated tests for YOUR integration (vitest shown; jest is the same).
 *   npm i -D vitest
 *   npx vitest run examples/testing-your-adapter.test.ts
 *
 * Idea: generate throw-away keys, sign requests like E-SADAD would, call the
 * service directly (no HTTP needed) and assert on the XML that comes back.
 */
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CertificateSigner, EsadadService, InMemoryStore, normalizeMobileNumber, signMessage, verifyMessage } from 'e-sadad-xml';

// --- Test keys (created once with the dev-keys script) -----------------------------
let esadadSide: CertificateSigner;
let keysDir: string;

beforeAll(() => {
  keysDir = mkdtempSync(join(tmpdir(), 'esadad-test-'));
  execFileSync('bash', ['examples/dev-keys.sh', keysDir]);
  esadadSide = new CertificateSigner({
    billerPrivateKey: { path: join(keysDir, 'esadad-dev.key') }, // E-SADAD signs requests
    esadadCertificate: { path: join(keysDir, 'biller-dev.cer') }, // ...and verifies our responses
  });
});

// --- Your adapter, with the billing system mocked -----------------------------------
const billing = {
  customerExists: vi.fn(async (mobile: string) => mobile === '0599123456'),
  topUp: vi.fn(async (_mobile: string, _amount: number, _reference: string) => undefined),
};

function createService() {
  const store = new InMemoryStore();
  const service = new EsadadService({
    biller: { code: 344 },
    services: [{ serviceType: 'TELC_Recharge', paymentType: 'PrePaid', currency: 'ILS', bankCode: 8, iban: 'PS49PALS045431072990993100000' }],
    certificates: {
      esadadCertificate: { path: join(keysDir, 'esadad-dev.cer') },
      billerPfx: { data: readFileSync(join(keysDir, 'biller-dev.pfx')), password: 'dev-password' },
    },
    normalizeBillingNo: normalizeMobileNumber,
    adapter: {
      validatePrepaid: async (req) => ({ valid: await billing.customerExists(req.billingNo) }),
      postPayment: async (trx) => billing.topUp(trx.billingNo, trx.paidAmount, trx.joebppsTrx),
    },
    store,
  });
  return { service, store };
}

const request = (guid: string, body: string) =>
  signMessage(`<MFEP><MsgHeader><GUID>${guid}</GUID></MsgHeader>${body}</MFEP>`, esadadSide);

// --- Tests ----------------------------------------------------------------------------
describe('my E-SADAD integration', () => {
  it('accepts a known customer', async () => {
    const { service } = createService();
    const body = `<MsgBody><BillingInfo><AcctInfo><BillingNo>970599123456</BillingNo></AcctInfo><DueAmt>20</DueAmt>
      <ServiceTypeDetails><ServiceType>TELC_Recharge</ServiceType></ServiceTypeDetails></BillingInfo></MsgBody>`;

    const out = await service.prepaidValidation({ body: await request('g-1', body), guid: 'g-1' });

    expect(out.xml).toContain('<BillingInfo><Result><ErrorCode>0</ErrorCode>');
    expect(billing.customerExists).toHaveBeenCalledWith('0599123456'); // normalised for you
    expect((await verifyMessage(out.xml, esadadSide)).valid).toBe(true); // E-SADAD will accept our signature
  });

  it('tops up once even if E-SADAD retries', async () => {
    const { service } = createService();
    const body = `<MsgBody><Transactions><TrxInf><AcctInfo><BillingNo>0599123456</BillingNo></AcctInfo>
      <JOEBPPSTrx>T-1</JOEBPPSTrx><PaidAmt>20</PaidAmt><Currency>ILS</Currency>
      <ServiceTypeDetails><ServiceType>TELC_Recharge</ServiceType></ServiceTypeDetails></TrxInf></Transactions></MsgBody>`;
    const signed = await request('g-2', body);

    await service.receivePaymentNotification({ body: signed, guid: 'g-2' });
    await service.receivePaymentNotification({ body: signed, guid: 'g-2' });

    expect(billing.topUp).toHaveBeenCalledTimes(1);
    expect(billing.topUp).toHaveBeenCalledWith('0599123456', 20, 'T-1');
  });
});
