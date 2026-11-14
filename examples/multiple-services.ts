/**
 * One biller, several services: prepaid top-ups in ILS and USD plus post-paid
 * invoices in JOD. Different billing-number rules per service.
 */
import { EsadadService, InMemoryStore, normalizeMobileNumber, type BillerAdapter, type ServiceConfig } from 'e-sadad-xml';

const services: ServiceConfig[] = [
  {
    serviceType: 'TELC_Recharge',
    nameEn: 'HatCard TopUp - ILS',
    nameAr: 'رصيد هات كارد - بالشيكل',
    paymentType: 'PrePaid',
    currency: 'ILS',
    bankCode: 8,
    iban: 'PS49PALS045431072990993100000',
    lowerValue: 5,
    upperValue: 500,
  },
  {
    serviceType: 'TELC_Recharge_USD',
    nameEn: 'HatCard TopUp - USD',
    paymentType: 'PrePaid',
    currency: 'USD',
    bankCode: 8,
    iban: 'PS00XXXX000000000000000000001',
    lowerValue: 2,
    upperValue: 150,
  },
  {
    serviceType: 'Invoices',
    nameEn: 'Business invoices',
    paymentType: 'PostPaid',
    currency: 'JOD',
    bankCode: 8,
    iban: 'PS00XXXX000000000000000000002',
  },
];

const adapter: BillerAdapter = {
  // `request.service` tells you which service was requested.
  async validatePrepaid(request) {
    console.log(`Prepaid ${request.service.serviceType}: ${request.billingNo} wants ${request.dueAmount} ${request.service.currency}`);
    return { valid: true };
  },
  async getBills(request) {
    return { found: true, bills: [{ billNo: `INV-${request.billingNo}`, dueAmount: 99.999 }] };
  },
  async postPayment(trx) {
    switch (trx.serviceType) {
      case 'TELC_Recharge':
      case 'TELC_Recharge_USD':
        console.log(`Top up ${trx.billingNo} with ${trx.paidAmount} ${trx.currency}`);
        break;
      case 'Invoices':
        console.log(`Mark invoice ${trx.billNo} as paid`);
        break;
    }
  },
};

export const esadad = new EsadadService({
  biller: { code: 344, name: 'HatCard' },
  services,
  certificates: {
    esadadCertificate: { path: 'dev-keys/esadad-dev.cer' },
    billerPfx: { path: 'dev-keys/biller-dev.pfx', password: 'dev-password' },
  },
  // Prepaid services use mobile numbers; invoices use account numbers.
  normalizeBillingNo: (billingNo, serviceType) => {
    if (serviceType.startsWith('TELC_Recharge')) return normalizeMobileNumber(billingNo); // '' → Invalid Billing Number
    const account = billingNo.trim().toUpperCase();
    return /^CUST-\d+$/.test(account) ? account : null; // null → Invalid Billing Number
  },
  adapter,
  store: new InMemoryStore(),
});

// Look up a service's configuration at runtime:
console.log(esadad.getService('TELC_Recharge_USD')?.upperValue); // 150
