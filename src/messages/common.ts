import type { SubPayment } from '../types';
import { formatAmount, parseAmount } from '../utils/currency';
import { el, leaf, type XmlNode } from '../xml/builder';
import { findAll, text, type XElement } from '../xml/parser';

export function subPaymentsNode(subPayments: SubPayment[], currency: string): XmlNode {
  return el(
    'SubPmts',
    subPayments.map((s) =>
      el('SubPmt', leaf('Amount', formatAmount(s.amount, currency)), leaf('SetBnkCode', s.bankCode), leaf('AcctNo', s.accountNo)),
    ),
  );
}

export function parseSubPayments(scope: XElement | undefined): SubPayment[] {
  return findAll(scope, 'SubPmt').map((s) => ({
    amount: parseAmount(text(s, 'Amount')) ?? 0,
    bankCode: text(s, 'SetBnkCode') ?? '',
    accountNo: text(s, 'AcctNo') ?? '',
  }));
}
