/**
 * The same prepaid top-up integration in plain JavaScript (CommonJS).
 *
 * Run:  ESADAD_CERT=./certs/ESADAD.cer BILLER_PFX=./certs/biller.pfx BILLER_PFX_PASSWORD=... \
 *       AVAILABILITY_TOKEN=... node examples/prepaid-javascript.cjs
 */
const express = require('express');
const { EsadadService, InMemoryStore, normalizeMobileNumber } = require('e-sadad-xml');
const { createEsadadRouter } = require('e-sadad-xml/express');

const esadad = new EsadadService({
  biller: { code: 999, name: 'My Company' }, // dummy: use your biller code from E-SADAD
  services: [
    {
      serviceType: 'MOBILE_TOPUP',
      nameEn: 'Mobile TopUp - ILS',
      nameAr: 'شحن رصيد - بالشيكل',
      paymentType: 'PrePaid',
      currency: 'ILS',
      bankCode: 99,
      iban: 'PS00XXXX000000000000000000000', // dummy: use your settlement IBAN
    },
  ],
  certificates: {
    esadadCertificate: { path: process.env.ESADAD_CERT },
    billerPfx: { path: process.env.BILLER_PFX, password: process.env.BILLER_PFX_PASSWORD },
  },
  normalizeBillingNo: (billingNo) => normalizeMobileNumber(billingNo),
  adapter: {
    async validatePrepaid(request) {
      return { valid: request.billingNo.startsWith('05') };
    },
    async postPayment(trx) {
      console.log('Top-up', trx.billingNo, trx.paidAmount, trx.joebppsTrx);
    },
  },
  store: new InMemoryStore(),
  availabilityToken: process.env.AVAILABILITY_TOKEN,
  // Authentication API (POST /authentication): on only when the shared user and secret are set.
  authentication: process.env.ESADAD_AUTH_USER
    ? { user: process.env.ESADAD_AUTH_USER, secret: process.env.ESADAD_AUTH_SECRET }
    : undefined,
  logger: console,
});

const app = express();
app.disable('x-powered-by');
app.use('/api/v1/esadad', createEsadadRouter(esadad));
app.listen(3000, () => console.log('Listening on :3000'));
