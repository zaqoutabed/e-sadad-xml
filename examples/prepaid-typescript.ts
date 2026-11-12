/**
 * the app prepaid top-up (ILS) with Express, in TypeScript.
 *
 * Run:  ESADAD_CERT=./certs/ESADAD.cer BILLER_PFX=./certs/biller.pfx BILLER_PFX_PASSWORD=... \
 *       AVAILABILITY_TOKEN=... npx tsx examples/prepaid-typescript.ts
 */
import express from 'express';
import {
  EsadadError,
  EsadadService,
  InMemoryStore,
  normalizeMobileNumber,
  type BillerAdapter,
  type ServiceConfig,
} from 'e-sadad-xml';
import { createEsadadRouter } from 'e-sadad-xml/express';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// Values from the the app prepaid sheet.
const services: ServiceConfig[] = [
  {
    serviceType: 'MOBILE_TOPUP',
    nameEn: 'Mobile TopUp - ILS',
    nameAr: 'شحن رصيد - بالشيكل',
    paymentType: 'PrePaid',
    currency: 'ILS',
    bankCode: 99,
    iban: 'PS00XXXX000000000000000000000',
    lowerValue: 1,
    upperValue: 1000,
  },
];

// Replace these stubs with calls to your billing system (API or database).
const adapter: BillerAdapter = {
  async validatePrepaid(request) {
    const customerExists = request.billingNo.startsWith('05'); // e.g. look up the mobile number
    return customerExists ? { valid: true } : { valid: false, result: 'INVALID_BILLING_NUMBER' };
  },

  async postPayment(trx) {
    // Top up `trx.billingNo` with `trx.paidAmount` and store `trx.joebppsTrx` as the reference.
    console.log(`Top-up ${trx.paidAmount} ${trx.currency} for ${trx.billingNo} (E-SADAD trx ${trx.joebppsTrx})`);
    if (trx.paidAmount > 1000) throw new EsadadError('INVALID_AMOUNT'); // returns a specific code
  },
};

const esadad = new EsadadService({
  biller: { code: 999, name: 'the app' },
  services,
  certificates: {
    esadadCertificate: { path: env('ESADAD_CERT') },
    billerPfx: { path: env('BILLER_PFX'), password: env('BILLER_PFX_PASSWORD') },
  },
  normalizeBillingNo: (billingNo) => normalizeMobileNumber(billingNo), // billing number = mobile number
  adapter,
  store: new InMemoryStore(), // use a database store in production (see examples/sql)
  availabilityToken: env('AVAILABILITY_TOKEN'),
  logger: console,
});

const app = express();
app.disable('x-powered-by');
app.use('/api/v1/esadad', createEsadadRouter(esadad));
app.listen(3000, () => console.log('E-SADAD endpoints on http://localhost:3000/api/v1/esadad'));
