/**
 * Plain JavaScript with ES modules (`import`), for projects with "type": "module"
 * or .mjs files. Run: node examples/esm-javascript.mjs
 */
import express from 'express';
import { EsadadService, InMemoryStore, normalizeMobileNumber } from 'e-sadad-xml';
import { createEsadadRouter } from 'e-sadad-xml/express';

const esadad = new EsadadService({
  biller: { code: 999, name: 'My Company' }, // dummy: use your biller code from E-SADAD
  services: [
    { serviceType: 'MOBILE_TOPUP', paymentType: 'PrePaid', currency: 'ILS', bankCode: 99, iban: 'PS00XXXX000000000000000000000' }, // dummy values: use your own from E-SADAD
  ],
  certificates: {
    esadadCertificate: { path: process.env.ESADAD_CERT ?? 'dev-keys/esadad-dev.cer' },
    billerPfx: {
      path: process.env.BILLER_PFX ?? 'dev-keys/biller-dev.pfx',
      password: process.env.BILLER_PFX_PASSWORD ?? 'dev-password',
    },
  },
  normalizeBillingNo: normalizeMobileNumber,
  adapter: {
    validatePrepaid: async (request) => ({ valid: request.billingNo.startsWith('059') }),
    postPayment: async (trx) => console.log('Top-up', trx.billingNo, trx.paidAmount, trx.joebppsTrx),
  },
  store: new InMemoryStore(),
  availabilityToken: process.env.AVAILABILITY_TOKEN ?? 'dev-token',
  logger: console,
});

const app = express();
app.use('/api/v1/esadad', createEsadadRouter(esadad));
app.listen(3000, () => console.log('Ready on http://localhost:3000/api/v1/esadad'));
