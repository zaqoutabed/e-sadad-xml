import { EsadadConfigError, EsadadError } from '../errors';
import type { EsadadConfig, PaymentType, ServiceConfig } from '../types';
import { isSupportedCurrency } from '../utils/currency';

/** Validates a service row from the configuration and throws `EsadadConfigError` when it is invalid. */
function validateService(s: ServiceConfig): void {
  const where = `Service "${s.serviceType}"`;
  if (!s.serviceType) throw new EsadadConfigError('service.serviceType is required');
  if (s.paymentType !== 'PostPaid' && s.paymentType !== 'PrePaid') {
    throw new EsadadConfigError(`${where}: paymentType must be "PostPaid" or "PrePaid"`);
  }
  if (!s.currency || !isSupportedCurrency(s.currency)) throw new EsadadConfigError(`${where}: unsupported currency "${s.currency}"`);
  if (s.bankCode === undefined || s.bankCode === '') throw new EsadadConfigError(`${where}: bankCode is required`);
  if (!s.iban) throw new EsadadConfigError(`${where}: iban is required`);
  if (s.lowerValue !== undefined && s.upperValue !== undefined && s.lowerValue > s.upperValue) {
    throw new EsadadConfigError(`${where}: lowerValue is greater than upperValue`);
  }
}

/**
 * The configured E-SADAD services, looked up by `ServiceType`, plus the
 * billing-number rules shared by every API.
 */
export class ServiceRegistry {
  private readonly byType = new Map<string, ServiceConfig>();

  constructor(
    services: ServiceConfig[],
    private readonly normalizer?: EsadadConfig['normalizeBillingNo'],
  ) {
    if (!Array.isArray(services) || services.length === 0) throw new EsadadConfigError('At least one service must be configured');
    for (const service of services) {
      validateService(service);
      if (this.byType.has(service.serviceType)) throw new EsadadConfigError(`Duplicate serviceType "${service.serviceType}"`);
      this.byType.set(service.serviceType, service);
    }
  }

  /** Returns the service, or `undefined` when unknown. */
  find(serviceType: string | undefined): ServiceConfig | undefined {
    return serviceType ? this.byType.get(serviceType) : undefined;
  }

  /**
   * Returns the service for a request, or throws:
   * - INVALID_REQUEST when `ServiceType` is missing,
   * - INVALID_SERVICE_TYPE when it is unknown or has the wrong payment type.
   */
  require(serviceType: string | undefined, paymentType?: PaymentType): ServiceConfig {
    if (!serviceType) throw new EsadadError('INVALID_REQUEST', 'ServiceType is required');
    const service = this.byType.get(serviceType);
    if (!service) throw new EsadadError('INVALID_SERVICE_TYPE', `Unknown ServiceType "${serviceType}"`);
    if (paymentType && service.paymentType !== paymentType) {
      throw new EsadadError('INVALID_SERVICE_TYPE', `ServiceType "${serviceType}" is not ${paymentType}`);
    }
    return service;
  }

  /** Applies `config.normalizeBillingNo`. Throws INVALID_BILLING_NUMBER when the number is missing or rejected. */
  normalizeBillingNo(billingNo: string | undefined, serviceType: string): string {
    if (!billingNo) throw new EsadadError('INVALID_BILLING_NUMBER', 'BillingNo is required');
    const normalized = this.normalizer ? this.normalizer(billingNo, serviceType) : billingNo.trim();
    if (!normalized) throw new EsadadError('INVALID_BILLING_NUMBER');
    return normalized;
  }
}

/** True when both currency codes mean the same currency (`EUR` and `EURO` match). */
export function sameCurrency(a: string, b: string): boolean {
  const norm = (c: string) => (c.toUpperCase() === 'EURO' ? 'EUR' : c.toUpperCase());
  return norm(a) === norm(b);
}
