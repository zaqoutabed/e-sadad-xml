/**
 * Configuration from a config FILE, using the column names of the E-SADAD
 * integration document (BillerCode, ServiceTypeCode, CertificatePath, ...).
 *
 * Run:  bash examples/dev-keys.sh && BILLER_PFX_PASSWORD=dev-password npx tsx examples/config-from-file.ts
 *
 * - Relative CertificatePath values are resolved from the JSON file's folder.
 * - "env:BILLER_PFX_PASSWORD" reads the password from the environment, so no secret is stored in the file.
 */
import express from 'express';
import { EsadadService, InMemoryStore, loadConfigFile, normalizeMobileNumber } from 'e-sadad-xml';
import { createEsadadRouter } from 'e-sadad-xml/express';

const fromFile = loadConfigFile(new URL('./config/esadad.config.json', import.meta.url).pathname);

const esadad = new EsadadService({
  ...fromFile, // biller, services, certificates
  normalizeBillingNo: normalizeMobileNumber,
  adapter: {
    validatePrepaid: async (request) => ({ valid: request.billingNo.startsWith('059') }),
    postPayment: async (trx) => console.log('Top-up', trx.billingNo, trx.paidAmount, trx.joebppsTrx),
  },
  store: new InMemoryStore(),
  logger: console,
});

console.log(
  'Services loaded from file:',
  fromFile.services.map((s) => s.serviceType),
);

const app = express();
app.use('/api/v1/esadad', createEsadadRouter(esadad));
app.listen(3000, () => console.log('Ready on http://localhost:3000/api/v1/esadad'));
