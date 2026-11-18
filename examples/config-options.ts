/**
 * Every configuration option in one place, with comments.
 * Copy what you need; only biller, services, certificates (or signer) and adapter are required.
 */
import express from 'express';
import { EsadadService, InMemoryStore, normalizeMobileNumber, type Logger } from 'e-sadad-xml';
import { createEsadadRouter } from 'e-sadad-xml/express';

// Any logger with optional debug/info/warn/error works: console, pino, winston...
const logger: Logger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: 'info', msg, meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: 'warn', msg, meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: 'error', msg, err: String(meta) })),
};

const esadad = new EsadadService({
  // REQUIRED -------------------------------------------------------------------
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
      partialPayment: false,
      lowerValue: 1,
      upperValue: 1000,
    },
  ],
  certificates: {
    esadadCertificate: { path: 'dev-keys/esadad-dev.cer' }, // or { data: pemStringOrBuffer }
    billerPfx: { path: 'dev-keys/biller-dev.pfx', password: 'dev-password' },
    // or, instead of billerPfx: billerPrivateKey: { path: 'biller.key', passphrase: '...' }
  },
  adapter: {
    validatePrepaid: async () => ({ valid: true }),
    postPayment: async () => undefined,
  },

  // RECOMMENDED ----------------------------------------------------------------
  store: new InMemoryStore(), // replace with a database store (examples/sql)
  logger,

  // OPTIONAL -------------------------------------------------------------------
  // Clean up billing numbers before your adapter sees them.
  normalizeBillingNo: (billingNo) => normalizeMobileNumber(billingNo),

  // Require ?username=...&password=... on every XML request.
  credentials: { username: 'esadad', password: process.env.ESADAD_QUERY_PASSWORD ?? 'change-me' },

  // GET /availability?token=...
  availabilityToken: process.env.AVAILABILITY_TOKEN ?? 'dev-token',
  // Extra check for /availability: return false (or throw) to report "unavailable".
  healthCheck: async () => {
    // e.g. await db.query('SELECT 1');
    return true;
  },

  // Use E-SADAD's official numbers once they confirm them.
  resultCodes: {
    INVALID_AMOUNT: { code: 13, desc: 'Invalid Amount', severity: 'Error' },
    GENERAL_ERROR: { code: 99, desc: 'System Error', severity: 'Error' },
  },

  maxBodyBytes: 256 * 1024, // default 512 KB
  timestamp: () => new Date().toISOString().slice(0, 19), // default: local time YYYY-MM-DDTHH:mm:ss
  verifySignature: true, // NEVER false in production
});

const app = express();
app.disable('x-powered-by');
app.use(
  '/api/v1/esadad',
  createEsadadRouter(esadad, {
    bodyLimit: '256kb',
    paths: {
      billPull: false, // this biller has no post-paid services → route disabled
      prepaidValidation: '/prepaid/PrepaidValidation',
      receivePaymentNotification: '/Payment/ReceivePaymentNotification',
      availability: '/availability',
    },
  }),
);
app.listen(3000);
