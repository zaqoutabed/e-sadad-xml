/**
 * Post-paid services: BillPull + payment notification.
 *
 * Shows every BillPull outcome:
 *   - account not found         → { found: false }
 *   - bill(s) with amount due   → { found: true, bills: [...] }
 *   - account with nothing due  → { found: true, bills: [{ dueAmount: 0 }] }
 *   - special error code        → throw new EsadadError(...)
 */
import express from 'express';
import { EsadadError, EsadadService, InMemoryStore, type BillerAdapter, type BillRecord } from 'e-sadad-xml';
import { createEsadadRouter } from 'e-sadad-xml/express';

// --- A fake billing system, so the example runs on its own ----------------------
interface Invoice {
  id: string;
  amount: number;
  issued: Date;
  due: Date;
  paid: boolean;
}
const accounts = new Map<string, { suspended: boolean; invoices: Invoice[] }>([
  ['CUST-1001', { suspended: false, invoices: [{ id: 'INV-1', amount: 45.5, issued: new Date('2026-11-01'), due: new Date('2026-11-30'), paid: false }] }],
  ['CUST-1002', { suspended: false, invoices: [] }],
  ['CUST-1003', { suspended: true, invoices: [] }],
]);

// --- The adapter: the only part that knows your billing system -----------------
const adapter: BillerAdapter = {
  async getBills(request) {
    const account = accounts.get(request.billingNo);
    if (!account) return { found: false }; // → 408 Invalid Billing Number

    if (account.suspended) {
      // Any code you want E-SADAD to see:
      throw new EsadadError({ code: 410, desc: 'Account Suspended', severity: 'Error' });
    }

    const unpaid = account.invoices.filter((i) => !i.paid);
    if (unpaid.length === 0) return { found: true, bills: [{ dueAmount: 0 }] }; // nothing due

    const bills: BillRecord[] = unpaid.map((invoice) => ({
      billNo: invoice.id,
      dueAmount: invoice.amount,
      issueDate: invoice.issued, // Date objects are formatted for you
      dueDate: invoice.due,
      billStatus: 'BillNew',
      allowPartial: false, // overrides the service setting for this bill
    }));
    return { found: true, bills };
  },

  async postPayment(trx) {
    const account = accounts.get(trx.billingNo);
    const invoice = account?.invoices.find((i) => i.id === trx.billNo);
    if (!invoice) return { success: false, result: 'INVALID_BILLING_NUMBER' };
    invoice.paid = true; // in real life: save trx.joebppsTrx as the payment reference
  },
};

const esadad = new EsadadService({
  biller: { code: 344, name: 'My Company' },
  services: [
    {
      serviceType: 'Invoices',
      nameEn: 'Monthly invoices',
      paymentType: 'PostPaid',
      currency: 'JOD', // JOD → amounts with 3 decimals (45.500)
      bankCode: 8,
      iban: 'PS00XXXX000000000000000000000',
      partialPayment: true,
      lowerValue: 1,
    },
  ],
  certificates: {
    esadadCertificate: { path: process.env.ESADAD_CERT ?? 'dev-keys/esadad-dev.cer' },
    billerPfx: { path: process.env.BILLER_PFX ?? 'dev-keys/biller-dev.pfx', password: process.env.BILLER_PFX_PASSWORD ?? 'dev-password' },
  },
  adapter,
  store: new InMemoryStore(),
  logger: console,
});

const app = express();
app.use('/api/v1/esadad', createEsadadRouter(esadad));
app.listen(3000, () => console.log('BillPull: POST http://localhost:3000/api/v1/esadad/BillPull?guid=...'));
