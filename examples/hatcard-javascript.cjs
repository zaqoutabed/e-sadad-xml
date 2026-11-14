/**
 * The same HatCard integration in plain JavaScript (CommonJS).
 *
 * Run:  ESADAD_CERT=./certs/ESADAD.cer BILLER_PFX=./certs/biller.pfx BILLER_PFX_PASSWORD=... \
 *       AVAILABILITY_TOKEN=... node examples/hatcard-javascript.cjs
 */
const express = require('express');
const { EsadadService, InMemoryStore, normalizeMobileNumber } = require('e-sadad-xml');
const { createEsadadRouter } = require('e-sadad-xml/express');

const esadad = new EsadadService({
  biller: { code: 344, name: 'HatCard' },
  services: [
    {
      serviceType: 'TELC_Recharge',
      nameEn: 'HatCard TopUp - ILS',
      nameAr: 'رصيد هات كارد - بالشيكل',
      paymentType: 'PrePaid',
      currency: 'ILS',
      bankCode: 8,
      iban: 'PS49PALS045431072990993100000',
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
  logger: console,
});

const app = express();
app.disable('x-powered-by');
app.use('/api/v1/esadad', createEsadadRouter(esadad));
app.listen(3000, () => console.log('Listening on :3000'));
