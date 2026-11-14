import { ApiNames, MessageTypes, type ResultCode } from '../constants';
import { runInBackground } from '../core/background';
import { sameCurrency } from '../core/services';
import { EsadadError } from '../errors';
import {
  parsePaymentNotificationRequest,
  paymentNotificationBody,
  type RawPaymentTransaction,
  type TrxResult,
} from '../messages/paymentNotification';
import type { PaymentTransaction } from '../types';
import type { XmlNode } from '../xml/builder';
import type { XDocument } from '../xml/parser';
import { handlerContext, type ApiHandler, type HandlerDeps, type LogFields, type Reply, type RequestContext } from './types';

/**
 * ReceivePaymentNotification. Flow from the integration document:
 *   - before verification, write a payment log row (IsPaymentPosted = false)
 *   - if this payment is already posted (a retry), answer success without posting again
 *   - otherwise post it to the billing system and mark it as posted
 *
 * Each `TrxInf` is processed on its own and gets its own `Result`. A payment is
 * identified by its `JOEBPPSTrx`, which is covered by the signature (the GUID
 * is not).
 */
export class PaymentNotificationHandler implements ApiHandler {
  readonly api = ApiNames.RECEIVE_PAYMENT_NOTIFICATION;
  readonly responseType = MessageTypes.PAYMENT_NOTIFICATION_RESPONSE;

  constructor(private readonly deps: HandlerDeps) {}

  describe(doc: XDocument): LogFields {
    const first = parsePaymentNotificationRequest(doc)[0];
    return {
      billingNo: first?.billingNo,
      billNo: first?.billNo,
      serviceType: first?.serviceType,
      currency: this.currencyOf(first),
    };
  }

  errorBody(ctx: RequestContext, result: ResultCode): XmlNode {
    const transactions = ctx.doc ? parsePaymentNotificationRequest(ctx.doc) : [];
    return paymentNotificationBody(transactions.map((t) => trxResult(t, result)));
  }

  /** Step 3 of the spec: log every payment (IsPaymentPosted = false) so retries can be detected. */
  async beforeVerify(ctx: RequestContext): Promise<void> {
    for (const t of parsePaymentNotificationRequest(ctx.doc!)) {
      if (!t.joebppsTrx) continue;
      await this.deps.store.logPayment({
        guid: ctx.guid,
        joebppsTrx: t.joebppsTrx,
        billingNo: t.billingNo ?? '',
        billNo: t.billNo,
        serviceType: t.serviceType ?? '',
        currency: this.currencyOf(t),
        paidAmount: t.paidAmount ?? 0,
        isPaymentPosted: false,
        createdAt: new Date(),
      });
    }
  }

  async process(ctx: RequestContext): Promise<Reply> {
    if (!this.deps.adapter.postPayment) throw new Error('adapter.postPayment is not implemented');
    const transactions = parsePaymentNotificationRequest(ctx.doc!);
    if (transactions.length === 0) throw new EsadadError('INVALID_REQUEST', 'No transactions in request');

    const results: TrxResult[] = [];
    for (const raw of transactions) {
      results.push(trxResult(raw, await this.processTransaction(ctx, raw)));
    }
    return { result: this.deps.results.success, body: paymentNotificationBody(results) };
  }

  /** Currency from the request, or from the configured service when the request has none. */
  private currencyOf(t: RawPaymentTransaction | undefined): string | undefined {
    return t?.currency ?? this.deps.services.find(t?.serviceType)?.currency;
  }

  /** Validates and posts one transaction. Never throws: errors become that transaction's result. */
  private async processTransaction(ctx: RequestContext, raw: RawPaymentTransaction): Promise<ResultCode> {
    try {
      const trx = this.buildTransaction(ctx, raw);
      // Serialise retries of the same payment so it cannot be posted twice in parallel.
      return await this.deps.locks.run(trx.joebppsTrx, () => this.postOnce(ctx, trx));
    } catch (err) {
      if (!(err instanceof EsadadError)) {
        this.deps.logger.error?.(`[${ctx.api}] ${ctx.guid}: posting payment ${raw.joebppsTrx} failed`, err);
      }
      return this.deps.results.fromError(err);
    }
  }

  /** Posts a payment unless it is already marked as posted (a retry). */
  private async postOnce(ctx: RequestContext, trx: PaymentTransaction): Promise<ResultCode> {
    const { store, adapter, results, logger } = this.deps;
    if (await store.isPaymentPosted(trx.joebppsTrx, ctx.guid)) {
      logger.info?.(`[${ctx.api}] ${ctx.guid}: payment ${trx.joebppsTrx} already posted, answering retry`);
      return results.success;
    }

    const outcome = await adapter.postPayment!(trx, handlerContext(ctx));
    if (outcome && outcome.success === false) return results.resolve(outcome.result, 'GENERAL_ERROR');

    await store.markPaymentPosted(trx.joebppsTrx, ctx.guid);
    this.notifyPosted(ctx, trx);
    return results.success;
  }

  /** Runs `hooks.onPaymentPosted` in the background (SMS, e-mail, ...). */
  private notifyPosted(ctx: RequestContext, trx: PaymentTransaction): void {
    const hook = this.deps.hooks.onPaymentPosted;
    if (!hook) return;
    runInBackground(
      `[${ctx.api}] ${ctx.guid}: onPaymentPosted(${trx.joebppsTrx})`,
      () => hook(trx, handlerContext(ctx)),
      this.deps.logger,
    );
  }

  /** Validates the raw transaction against the configuration and builds what the adapter receives. */
  private buildTransaction(ctx: RequestContext, raw: RawPaymentTransaction): PaymentTransaction {
    const { services } = this.deps;
    if (!raw.joebppsTrx) throw new EsadadError('INVALID_REQUEST', 'JOEBPPSTrx is required');
    const service = services.require(raw.serviceType);
    if (raw.currency && !sameCurrency(raw.currency, service.currency)) throw new EsadadError('INVALID_CURRENCY');
    if (raw.paidAmount === undefined || raw.paidAmount <= 0) throw new EsadadError('INVALID_AMOUNT');

    return {
      ...raw,
      guid: ctx.guid,
      joebppsTrx: raw.joebppsTrx,
      paidAmount: raw.paidAmount,
      serviceType: service.serviceType,
      billingNo: services.normalizeBillingNo(raw.billingNo, service.serviceType),
      originalBillingNo: raw.billingNo ?? '',
      service,
    };
  }
}

function trxResult(raw: RawPaymentTransaction, result: ResultCode): TrxResult {
  return { joebppsTrx: raw.joebppsTrx, processDate: raw.processDate, stmtDate: raw.stmtDate, result };
}
