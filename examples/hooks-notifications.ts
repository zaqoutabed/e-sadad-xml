/**
 * Hooks: do something AFTER E-SADAD has its answer, without slowing it down.
 *
 *   onPaymentPosted     → SMS / e-mail / webhook after a successful payment (not for retries)
 *   onRequestCompleted  → metrics and alerts for every request
 *
 * Hooks run in the background. If they fail, the error goes to logger.error;
 * E-SADAD's response is never affected.
 */
import { EsadadService, InMemoryStore, toInternationalMobile } from 'e-sadad-xml';

// Stand-ins for your real services:
async function sendSms(to: string, text: string): Promise<void> {
  console.log(`SMS to ${to}: ${text}`);
}
async function sendEmail(subject: string, body: string): Promise<void> {
  console.log(`E-mail "${subject}": ${body}`);
}
const metrics = { record: (name: string, value: number, tags: Record<string, string>) => console.log(name, value, tags) };

export const esadad = new EsadadService({
  biller: { code: 344, name: 'HatCard' },
  services: [
    { serviceType: 'TELC_Recharge', paymentType: 'PrePaid', currency: 'ILS', bankCode: 8, iban: 'PS49PALS045431072990993100000' },
  ],
  certificates: {
    esadadCertificate: { path: 'dev-keys/esadad-dev.cer' },
    billerPfx: { path: 'dev-keys/biller-dev.pfx', password: 'dev-password' },
  },
  adapter: {
    validatePrepaid: async () => ({ valid: true }),
    postPayment: async (trx) => {
      // Keep this fast: only post the payment here. Notifications go in the hook below.
      console.log('Posting', trx.joebppsTrx);
    },
  },
  hooks: {
    async onPaymentPosted(trx) {
      await sendSms(
        toInternationalMobile(trx.billingNo),
        `Your HatCard balance was topped up with ${trx.paidAmount} ${trx.currency}.`,
      );
      await sendEmail('E-SADAD payment', `${trx.billingNo} paid ${trx.paidAmount} ${trx.currency} (ref ${trx.joebppsTrx})`);
    },
    onRequestCompleted(event) {
      metrics.record('esadad.request.duration_ms', event.durationMs, { api: event.api, code: String(event.result.code) });
      if (event.result.code !== 0)
        console.warn(`E-SADAD ${event.api} ${event.guid} answered ${event.result.code} ${event.result.desc}`);
    },
  },
  store: new InMemoryStore(),
  logger: console,
});
