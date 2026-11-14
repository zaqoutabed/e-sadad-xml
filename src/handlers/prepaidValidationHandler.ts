import { ApiNames, MessageTypes, type ResultCode } from '../constants';
import { sameCurrency } from '../core/services';
import { EsadadError } from '../errors';
import {
  parsePrepaidValidationRequest,
  prepaidValidationBody,
  type RawPrepaidValidationRequest,
} from '../messages/prepaidValidation';
import type { PrepaidValidationRequest, ServiceConfig, SubPayment } from '../types';
import { isAmountInRange, parseAmount } from '../utils/currency';
import type { XmlNode } from '../xml/builder';
import type { XDocument } from '../xml/parser';
import { handlerContext, type ApiHandler, type HandlerDeps, type LogFields, type Reply, type RequestContext } from './types';

/**
 * PrepaidValidation (pre-paid). Checks the request against the configured
 * service (biller code, currency, amount range), then asks the adapter
 * whether the billing number can be topped up.
 */
export class PrepaidValidationHandler implements ApiHandler {
  readonly api = ApiNames.PREPAID_VALIDATION;
  readonly responseType = MessageTypes.PREPAID_VALIDATION_RESPONSE;

  constructor(private readonly deps: HandlerDeps) {}

  describe(doc: XDocument): LogFields {
    const r = parsePrepaidValidationRequest(doc);
    // Requests rarely carry <Currency>: fall back to the configured service currency.
    const currency = r.currency ?? this.deps.services.find(r.serviceType)?.currency;
    return { billingNo: r.billingNo, serviceType: r.serviceType, currency };
  }

  errorBody(ctx: RequestContext, result: ResultCode): XmlNode {
    const raw = ctx.doc ? parsePrepaidValidationRequest(ctx.doc) : {};
    return this.body(raw, result);
  }

  async process(ctx: RequestContext): Promise<Reply> {
    const { adapter, results } = this.deps;
    if (!adapter.validatePrepaid) throw new Error('adapter.validatePrepaid is not implemented');

    const raw = parsePrepaidValidationRequest(ctx.doc!);
    try {
      const request = this.buildRequest(ctx, raw);
      const outcome = await adapter.validatePrepaid(request, handlerContext(ctx));

      if (!outcome?.valid) {
        const reason = outcome?.valid === false ? outcome.result : undefined;
        return { result: results.success, body: this.body(raw, results.resolve(reason, 'INVALID_BILLING_NUMBER')) };
      }

      const dueAmount = outcome.dueAmount ?? request.dueAmount;
      const body = this.body(raw, results.success, {
        dueAmount,
        validationCode: outcome.validationCode ?? request.validationCode,
        subPayments: outcome.subPayments ?? defaultSubPayments(request.service, dueAmount),
      });
      return { result: results.success, body };
    } catch (err) {
      // Expected business errors go in the body (header stays Success), as in the E-SADAD reference.
      if (err instanceof EsadadError) return { result: results.success, body: this.body(raw, results.fromError(err)) };
      throw err;
    }
  }

  /** Validates the raw request against the configuration and builds what the adapter receives. */
  private buildRequest(ctx: RequestContext, raw: RawPrepaidValidationRequest): PrepaidValidationRequest {
    const { services, billerCode } = this.deps;
    const service = services.require(raw.serviceType, 'PrePaid');

    if (raw.billerCode && raw.billerCode !== billerCode) throw new EsadadError('INVALID_BILLER_CODE');
    if (raw.currency && !sameCurrency(raw.currency, service.currency)) throw new EsadadError('INVALID_CURRENCY');
    const dueAmount = parseRequestedAmount(raw.dueAmount, service);

    return {
      guid: ctx.guid,
      header: ctx.header,
      rawXml: ctx.rawXml,
      billingNo: services.normalizeBillingNo(raw.billingNo, service.serviceType),
      originalBillingNo: raw.billingNo ?? '',
      billerCode: raw.billerCode,
      dueAmount,
      validationCode: raw.validationCode,
      serviceType: service.serviceType,
      prepaidCategory: raw.prepaidCategory,
      currency: raw.currency,
      service,
    };
  }

  /** Builds the response `<MsgBody>`, echoing the request values unless overridden. */
  private body(
    raw: RawPrepaidValidationRequest,
    result: ResultCode,
    overrides: { dueAmount?: number; validationCode?: string; subPayments?: SubPayment[] } = {},
  ): XmlNode {
    const service = this.deps.services.find(raw.serviceType);
    const dueAmount = overrides.dueAmount ?? raw.dueAmount;
    return prepaidValidationBody({
      result,
      billingNo: raw.billingNo,
      billerCode: this.deps.billerCode,
      dueAmount,
      currency: service?.currency ?? raw.currency ?? '',
      validationCode: overrides.validationCode ?? raw.validationCode,
      serviceType: raw.serviceType,
      prepaidCategory: raw.prepaidCategory,
      subPayments: overrides.subPayments ?? (service ? defaultSubPayments(service, toAmount(dueAmount)) : []),
    });
  }
}

/** Parses `DueAmt`. Throws INVALID_AMOUNT when it is not positive or outside the service range. */
function parseRequestedAmount(value: string | undefined, service: ServiceConfig): number | undefined {
  if (value === undefined) return undefined;
  const amount = parseAmount(value);
  const valid = amount !== undefined && amount > 0 && isAmountInRange(amount, service.lowerValue, service.upperValue);
  if (!valid) throw new EsadadError('INVALID_AMOUNT');
  return amount;
}

/** Number from a parsed amount or raw request text; 0 when not a valid amount. */
function toAmount(value: number | string | undefined): number {
  return typeof value === 'number' ? value : (parseAmount(value) ?? 0);
}

/** One sub-payment of the full amount to the service's settlement bank and IBAN. */
export function defaultSubPayments(service: ServiceConfig, amount: number | undefined): SubPayment[] {
  return [{ amount: amount ?? 0, bankCode: String(service.bankCode), accountNo: service.iban }];
}
