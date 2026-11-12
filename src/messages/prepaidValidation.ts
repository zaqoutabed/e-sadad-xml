/**
 * PrepaidValidation (`BILRPREPADVALRQ` / `BILRPREPADVALRS`), following the
 * E-SADAD reference implementation.
 *
 * Request and response body:
 *   MsgBody/BillingInfo{Result, AcctInfo{BillingNo, BillerCode}, DueAmt, Currency,
 *   ValidationCode, ServiceTypeDetails{ServiceType, PrepaidCat?}, SubPmts/SubPmt*}
 */
import type { ResultCode } from '../constants';
import type { SubPayment } from '../types';
import { formatAmount, parseAmount } from '../utils/currency';
import { el, leaf, optLeaf, type XmlNode } from '../xml/builder';
import { findFirst, text, type XDocument } from '../xml/parser';
import { resultNode } from './envelope';
import { subPaymentsNode } from './common';

export interface RawPrepaidValidationRequest {
  billingNo?: string;
  billerCode?: string;
  dueAmount?: string;
  validationCode?: string;
  serviceType?: string;
  prepaidCategory?: string;
  currency?: string;
}

export function parsePrepaidValidationRequest(doc: XDocument): RawPrepaidValidationRequest {
  const body = findFirst(doc, 'MsgBody');
  return {
    billingNo: text(body, 'BillingNo'),
    billerCode: text(body, 'BillerCode'),
    dueAmount: text(body, 'DueAmt'),
    validationCode: text(body, 'ValidationCode'),
    serviceType: text(body, 'ServiceType'),
    prepaidCategory: text(body, 'PrepaidCat'),
    currency: text(body, 'Currency'),
  };
}

export interface PrepaidBodyOptions {
  result: ResultCode;
  billingNo?: string;
  billerCode: string;
  dueAmount?: number | string;
  currency: string;
  validationCode?: string;
  serviceType?: string;
  prepaidCategory?: string;
  subPayments: SubPayment[];
}

function amountText(amount: number | string | undefined, currency: string): string {
  if (amount === undefined || amount === '') return '';
  const n = typeof amount === 'number' ? amount : parseAmount(amount);
  return n !== undefined && Number.isFinite(n) ? formatAmount(n, currency) : String(amount);
}

export function prepaidValidationBody(o: PrepaidBodyOptions): XmlNode {
  return el(
    'MsgBody',
    el(
      'BillingInfo',
      resultNode(o.result),
      el('AcctInfo', leaf('BillingNo', o.billingNo), leaf('BillerCode', o.billerCode)),
      leaf('DueAmt', amountText(o.dueAmount, o.currency)),
      leaf('Currency', o.currency),
      leaf('ValidationCode', o.validationCode),
      el('ServiceTypeDetails', leaf('ServiceType', o.serviceType), optLeaf('PrepaidCat', o.prepaidCategory)),
      subPaymentsNode(o.subPayments, o.currency),
    ),
  );
}
