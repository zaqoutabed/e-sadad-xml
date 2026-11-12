/**
 * ReceivePaymentNotification (`BLRPMTNTFRQ` / `BLRPMTNTFRS`), following the
 * E-SADAD reference implementation.
 *
 * Request body:  MsgBody/Transactions/TrxInf*{AcctInfo{BillingNo, BillNo}, JOEBPPSTrx,
 *                BankTrxID, BankCode, PmtStatus, DueAmt, PaidAmt, FeesAmt, FeesOnBiller,
 *                ProcessDate, STMTDate, AccessChannel, PaymentMethod, PaymentType,
 *                Currency, ServiceTypeDetails{ServiceType, PrepaidCat}, ValidationCode,
 *                SubPmts/SubPmt*}
 * Response body: MsgBody/Transactions/TrxInf*{JOEBPPSTrx, ProcessDate, STMTDate, Result}
 */
import type { ResultCode } from '../constants';
import type { SubPayment } from '../types';
import { parseAmount } from '../utils/currency';
import { el, leaf, type XmlNode } from '../xml/builder';
import { findAll, findFirst, text, type XDocument } from '../xml/parser';
import { resultNode } from './envelope';
import { parseSubPayments } from './common';

export interface RawPaymentTransaction {
  billingNo?: string;
  billNo?: string;
  joebppsTrx?: string;
  bankTrxId?: string;
  bankCode?: string;
  paymentStatus?: string;
  dueAmount?: number;
  paidAmount?: number;
  feesAmount?: number;
  feesOnBiller?: boolean;
  processDate?: string;
  stmtDate?: string;
  accessChannel?: string;
  paymentMethod?: string;
  paymentType?: string;
  currency?: string;
  serviceType?: string;
  prepaidCategory?: string;
  validationCode?: string;
  subPayments: SubPayment[];
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return /^(true|1|yes)$/i.test(value);
}

export function parsePaymentNotificationRequest(doc: XDocument): RawPaymentTransaction[] {
  const body = findFirst(doc, 'MsgBody');
  const trxNodes = findAll(body, 'TrxInf');
  // Some senders omit the TrxInf wrapper; treat the whole body as one transaction.
  const scopes = trxNodes.length ? trxNodes : body ? [body] : [];
  return scopes.map((t) => ({
    billingNo: text(t, 'BillingNo'),
    billNo: text(t, 'BillNo'),
    joebppsTrx: text(t, 'JOEBPPSTrx'),
    bankTrxId: text(t, 'BankTrxID'),
    bankCode: text(t, 'BankCode'),
    paymentStatus: text(t, 'PmtStatus'),
    dueAmount: parseAmount(text(t, 'DueAmt')),
    paidAmount: parseAmount(text(t, 'PaidAmt')),
    feesAmount: parseAmount(text(t, 'FeesAmt') ?? text(t, 'feesAmt')),
    feesOnBiller: parseBool(text(t, 'FeesOnBiller')),
    processDate: text(t, 'ProcessDate'),
    stmtDate: text(t, 'STMTDate'),
    accessChannel: text(t, 'AccessChannel'),
    paymentMethod: text(t, 'PaymentMethod'),
    paymentType: text(t, 'PaymentType'),
    currency: text(t, 'Currency'),
    serviceType: text(t, 'ServiceType'),
    prepaidCategory: text(t, 'PrepaidCat'),
    validationCode: text(t, 'ValidationCode'),
    subPayments: parseSubPayments(t),
  }));
}

export interface TrxResult {
  joebppsTrx?: string;
  processDate?: string;
  stmtDate?: string;
  result: ResultCode;
}

export function paymentNotificationBody(results: TrxResult[]): XmlNode {
  return el(
    'MsgBody',
    el(
      'Transactions',
      results.map((r) =>
        el('TrxInf', leaf('JOEBPPSTrx', r.joebppsTrx), leaf('ProcessDate', r.processDate), leaf('STMTDate', r.stmtDate), resultNode(r.result)),
      ),
    ),
  );
}
