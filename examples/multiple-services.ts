/**
 * One biller, several services: prepaid top-ups in ILS and USD plus post-paid
 * invoices in JOD. Different billing-number rules per service.
 */
import { EsadadService, InMemoryStore, normalizeMobileNumber, type BillerAdapter, type ServiceConfig } from 'e-sadad-xml';

const services: ServiceConfig[] = [
  {
    serviceType: 'MOBILE_TOPUP',
    nameEn: 'Mobile TopUp - ILS',
    nameAr: 'شحن رصيد - بالشيكل',
    paymentType: 'PrePaid',
    currency: 'ILS',
    bankCode: 99,
    iban: 'PS00XXXX000000000000000000000', // dummy: use your settlement IBAN
    lowerValue: 5,
    upperValue: 500,
  },
  {
    serviceType: 'MOBILE_TOPUP_USD',
    nameEn: 'Mobile TopUp - USD',
    paymentType: 'PrePaid',
    currency: 'USD',
    bankCode: 99,
    iban: 'PS00XXXX000000000000000000001',
    lowerValue: 2,
    upperValue: 150,
  },
  {
    serviceType: 'Invoices',
    nameEn: 'Business invoices',
    paymentType: 'PostPaid',
    currency: 'JOD',
    bankCode: 99,
    iban: 'PS00XXXX000000000000000000002',
  },
];

const adapter: BillerAdapter = {
  // `request.service` tells you which service was requested.
  async validatePrepaid(request) {
    console.log(
      `Prepaid ${request.service.serviceType}: ${request.billingNo} wants ${request.dueAmount} ${request.service.currency}`,
    );
    return { valid: true };
  },
  async getBills(request) {
    return { found: true, bills: [{ billNo: `INV-${request.billingNo}`, dueAmount: 99.999 }] };
  },
  async postPayment(trx) {
    switch (trx.serviceType) {
      case 'MOBILE_TOPUP':
      case 'MOBILE_TOPUP_USD':
        console.log(`Top up ${trx.billingNo} with ${trx.paidAmount} ${trx.currency}`);
        break;
      case 'Invoices':
        console.log(`Mark invoice ${trx.billNo} as paid`);
        break;
    }
  },
};

export const esadad = new EsadadService({
  biller: { code: 999, name: 'My Company' }, // dummy: use your biller code from E-SADAD
  services,
  certificates: {
    esadadCertificate: { path: 'dev-keys/esadad-dev.cer' },
    billerPfx: { path: 'dev-keys/biller-dev.pfx', password: 'dev-password' },
  },
  // Prepaid services use mobile numbers; invoices use account numbers.
  normalizeBillingNo: (billingNo, serviceType) => {
    if (serviceType.startsWith('MOBILE_TOPUP')) return normalizeMobileNumber(billingNo); // '' → Invalid Billing Number
    const account = billingNo.trim().toUpperCase();
    return /^CUST-\d+$/.test(account) ? account : null; // null → Invalid Billing Number
  },
  adapter,
  store: new InMemoryStore(),
});

// Look up a service's configuration at runtime:
console.log(esadad.getService('MOBILE_TOPUP_USD')?.upperValue); // 150
