/**
 * BillPull (post-paid). The E-SADAD reference implementation does not include
 * this message, so its layout follows the standard MFEP `BILPULRQ`/`BILPULRS`
 * format. Confirm it against an E-SADAD sample before going live.
 *
 * Request body:  MsgBody/AcctInfo{BillingNo, BillNo?}, MsgBody/ServiceType
 * Response body: MsgBody/RecCount, MsgBody/BillsRec/BillRec*
 */
import type { ResultCode } from '../constants';
import type { BillRecord, ServiceConfig, SubPayment } from '../types';
import { formatAmount } from '../utils/currency';
import { toXmlDate } from '../utils/datetime';
import { el, leaf, optLeaf, type XmlNode } from '../xml/builder';
import { findFirst, text, type XDocument } from '../xml/parser';
import { resultNode } from './envelope';
import { subPaymentsNode } from './common';

export interface RawBillPullRequest {
  billingNo?: string;
  billNo?: string;
  serviceType?: string;
}

export function parseBillPullRequest(doc: XDocument): RawBillPullRequest {
  const body = findFirst(doc, 'MsgBody');
  return {
    billingNo: text(body, 'BillingNo'),
    billNo: text(body, 'BillNo'),
    serviceType: text(body, 'ServiceType'),
  };
}

export interface BillRecordContext {
  billingNo: string;
  billerCode: string;
  service: ServiceConfig;
  success: ResultCode;
}

export function billRecordNode(bill: BillRecord, ctx: BillRecordContext): XmlNode {
  const { service } = ctx;
  const currency = service.currency;
  const allowPartial = bill.allowPartial ?? service.partialPayment ?? false;
  const lower = bill.lowerAmount ?? service.lowerValue;
  const upper = bill.upperAmount ?? service.upperValue;
  const subPayments: SubPayment[] = bill.subPayments ?? [
    { amount: bill.dueAmount, bankCode: String(service.bankCode), accountNo: service.iban },
  ];
  return el(
    'BillRec',
    resultNode(ctx.success),
    el('AcctInfo', leaf('BillingNo', bill.billingNo ?? ctx.billingNo), optLeaf('BillNo', bill.billNo), leaf('BillerCode', ctx.billerCode)),
    leaf('BillStatus', bill.billStatus ?? 'BillNew'),
    leaf('DueAmount', formatAmount(bill.dueAmount, currency)),
    optLeaf('IssueDate', toXmlDate(bill.issueDate)),
    optLeaf('OpenDate', toXmlDate(bill.openDate)),
    optLeaf('DueDate', toXmlDate(bill.dueDate)),
    optLeaf('ExpiryDate', toXmlDate(bill.expiryDate)),
    optLeaf('CloseDate', toXmlDate(bill.closeDate)),
    leaf('ServiceType', service.serviceType),
    leaf('Currency', currency),
    el(
      'PmtConst',
      leaf('AllowPart', allowPartial ? 'true' : 'false'),
      optLeaf('Lower', lower === undefined ? undefined : formatAmount(lower, currency)),
      optLeaf('Upper', upper === undefined ? undefined : formatAmount(upper, currency)),
    ),
    subPaymentsNode(subPayments, currency),
  );
}

export function billPullBody(records: XmlNode[]): XmlNode {
  return el('MsgBody', leaf('RecCount', records.length), el('BillsRec', records));
}

/** Body for a business error, for example an unknown billing number. */
export function billPullErrorBody(result: ResultCode, req: RawBillPullRequest, billerCode: string): XmlNode {
  return el(
    'MsgBody',
    leaf('RecCount', 0),
    el(
      'BillsRec',
      el(
        'BillRec',
        resultNode(result),
        el('AcctInfo', leaf('BillingNo', req.billingNo), optLeaf('BillNo', req.billNo), leaf('BillerCode', billerCode)),
        optLeaf('ServiceType', req.serviceType),
      ),
    ),
  );
}
