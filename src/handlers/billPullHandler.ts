import { ApiNames, MessageTypes, type ResultCode } from '../constants';
import { withTimeout } from '../core/timeout';
import { EsadadError } from '../errors';
import {
  billPullBody,
  billPullErrorBody,
  billRecordNode,
  parseBillPullRequest,
  type RawBillPullRequest,
} from '../messages/billPull';
import type { BillPullRequest } from '../types';
import type { XmlNode } from '../xml/builder';
import type { XDocument } from '../xml/parser';
import { handlerContext, type ApiHandler, type HandlerDeps, type LogFields, type Reply, type RequestContext } from './types';

/**
 * BillPull (post-paid). Flow from the integration document:
 *   - billing number not found      → INVALID_BILLING_NUMBER
 *   - found, amount due             → bill with due amount
 *   - found, nothing due            → bill with DueAmount 0
 *   - unexpected error              → GENERAL_ERROR
 */
export class BillPullHandler implements ApiHandler {
  readonly api = ApiNames.BILL_PULL;
  readonly responseType = MessageTypes.BILL_PULL_RESPONSE;

  constructor(private readonly deps: HandlerDeps) {}

  describe(doc: XDocument): LogFields {
    const r = parseBillPullRequest(doc);
    const currency = this.deps.services.find(r.serviceType)?.currency;
    return { billingNo: r.billingNo, billNo: r.billNo, serviceType: r.serviceType, currency };
  }

  errorBody(ctx: RequestContext, result: ResultCode): XmlNode {
    const raw = ctx.doc ? parseBillPullRequest(ctx.doc) : {};
    return billPullErrorBody(result, raw, this.deps.billerCode);
  }

  async process(ctx: RequestContext): Promise<Reply> {
    const { adapter, results } = this.deps;
    if (!adapter.getBills) throw new Error('adapter.getBills is not implemented');

    const raw = parseBillPullRequest(ctx.doc!);
    try {
      const request = this.buildRequest(ctx, raw);
      const outcome = await withTimeout(
        adapter.getBills(request, handlerContext(ctx)),
        this.deps.adapterTimeoutMs,
        'adapter.getBills',
      );

      if (!outcome?.found) {
        const reason = outcome?.found === false ? outcome.result : undefined;
        return this.businessError(raw, results.resolve(reason, 'INVALID_BILLING_NUMBER'));
      }

      const records = outcome.bills.map((bill) =>
        billRecordNode(bill, {
          billingNo: request.originalBillingNo,
          billerCode: this.deps.billerCode,
          service: request.service,
          success: results.success,
        }),
      );
      return { result: results.success, body: billPullBody(records) };
    } catch (err) {
      // Expected business errors go in the body; unexpected ones go to the pipeline.
      if (err instanceof EsadadError) return this.businessError(raw, results.fromError(err));
      throw err;
    }
  }

  /** Validates the raw request against the configuration and builds what the adapter receives. */
  private buildRequest(ctx: RequestContext, raw: RawBillPullRequest): BillPullRequest {
    const service = this.deps.services.require(raw.serviceType, 'PostPaid');
    return {
      guid: ctx.guid,
      header: ctx.header,
      rawXml: ctx.rawXml,
      billingNo: this.deps.services.normalizeBillingNo(raw.billingNo, service.serviceType),
      originalBillingNo: raw.billingNo ?? '',
      billNo: raw.billNo,
      serviceType: service.serviceType,
      service,
    };
  }

  /** Business errors keep a successful header and report the problem in the body. */
  private businessError(raw: RawBillPullRequest, result: ResultCode): Reply {
    return { result: this.deps.results.success, body: billPullErrorBody(result, raw, this.deps.billerCode) };
  }
}
