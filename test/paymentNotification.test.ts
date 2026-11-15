import { describe, expect, it, vi } from 'vitest';
import { verifyMessage, type PaymentTransaction } from '../src';
import { createService, esadadRequest, esadadSide, paymentBody, paymentTrx } from './helpers';

const RQ = 'BLRPMTNTFRQ';

describe('ReceivePaymentNotification', () => {
  it('posts the payment, logs it and answers BLRPMTNTFRS', async () => {
    const postPayment = vi.fn(async (_t: PaymentTransaction) => undefined);
    const { service, store } = createService({ postPayment });
    const body = await esadadRequest('pay-1', RQ, paymentBody(paymentTrx({ trx: 'T-100', billingNo: '970599123456' })));
    const out = await service.receivePaymentNotification({ body, guid: 'pay-1' });

    expect(out.result.code).toBe(0);
    expect(out.xml).toContain('<ResTyp>BLRPMTNTFRS</ResTyp>');
    expect(out.xml).toContain(
      '<MsgBody><Transactions><TrxInf><JOEBPPSTrx>T-100</JOEBPPSTrx><ProcessDate>2026-11-12T10:00:00</ProcessDate><STMTDate>2026-11-12</STMTDate><Result><ErrorCode>0</ErrorCode>',
    );
    expect(await verifyMessage(out.xml, esadadSide)).toEqual({ valid: true });

    expect(postPayment).toHaveBeenCalledTimes(1);
    expect(postPayment.mock.calls[0]![0]).toMatchObject({
      guid: 'pay-1',
      joebppsTrx: 'T-100',
      billingNo: '0599123456',
      paidAmount: 20,
      feesOnBiller: false,
      currency: 'ILS',
      subPayments: [{ amount: 20, bankCode: '8', accountNo: 'PS49PALS045431072990993100000' }],
    });
    expect(store.payments).toHaveLength(1);
    expect(store.payments[0]).toMatchObject({
      guid: 'pay-1',
      joebppsTrx: 'T-100',
      paidAmount: 20,
      currency: 'ILS',
      isPaymentPosted: true,
    });
    expect(store.transactions.map((t) => t.currency)).toEqual(['ILS', 'ILS']);
  });

  it('does not post again when E-SADAD retries', async () => {
    const postPayment = vi.fn();
    const { service, store } = createService({ postPayment });
    const body = await esadadRequest('pay-2', RQ, paymentBody(paymentTrx({ trx: 'T-200' })));

    const first = await service.receivePaymentNotification({ body, guid: 'pay-2' });
    const retry = await service.receivePaymentNotification({ body, guid: 'pay-2' });

    expect(first.result.code).toBe(0);
    expect(retry.xml).toContain('<JOEBPPSTrx>T-200</JOEBPPSTrx>');
    expect(retry.xml).toContain('<Result><ErrorCode>0</ErrorCode>');
    expect(postPayment).toHaveBeenCalledTimes(1);
    expect(store.payments).toHaveLength(2); // every request is logged
  });

  it('does not post a replayed body sent with a different query GUID', async () => {
    const postPayment = vi.fn();
    const { service } = createService({ postPayment });
    // Header GUID left out, so the attacker controls the GUID through the unsigned query string.
    const body = (await esadadRequest('x', RQ, paymentBody(paymentTrx({ trx: 'T-300' })))).replace('<GUID>x</GUID>', '');

    await service.receivePaymentNotification({ body, guid: 'guid-a' });
    await service.receivePaymentNotification({ body, guid: 'guid-b' });
    expect(postPayment).toHaveBeenCalledTimes(1);
  });

  it('posts only once under concurrent retries', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => (resolve = r));
    const postPayment = vi.fn(() => gate);
    const { service } = createService({ postPayment });
    const body = await esadadRequest('pay-4', RQ, paymentBody(paymentTrx({ trx: 'T-400' })));

    const calls = Promise.all([1, 2, 3].map(() => service.receivePaymentNotification({ body, guid: 'pay-4' })));
    await new Promise((r) => setTimeout(r, 20));
    resolve();
    const outs = await calls;
    expect(postPayment).toHaveBeenCalledTimes(1);
    expect(outs.every((o) => o.xml.includes('<Result><ErrorCode>0</ErrorCode>'))).toBe(true);
  });

  it('keeps a failed posting unposted so the next retry posts it', async () => {
    const postPayment = vi.fn().mockRejectedValueOnce(new Error('billing system down')).mockResolvedValueOnce(undefined);
    const { service, store } = createService({ postPayment });
    const body = await esadadRequest('pay-5', RQ, paymentBody(paymentTrx({ trx: 'T-500' })));

    const first = await service.receivePaymentNotification({ body, guid: 'pay-5' });
    expect(first.xml).toContain('<TrxInf><JOEBPPSTrx>T-500</JOEBPPSTrx>');
    expect(first.xml).toContain('<ErrorCode>500</ErrorCode>');
    expect(first.xml).not.toContain('billing system down');
    expect(store.isPaymentPosted('T-500')).toBe(false);

    const retry = await service.receivePaymentNotification({ body, guid: 'pay-5' });
    expect(retry.xml).toContain('<Result><ErrorCode>0</ErrorCode>');
    expect(store.isPaymentPosted('T-500')).toBe(true);
    expect(postPayment).toHaveBeenCalledTimes(2);
  });

  it('answers Success when the payment was posted but the "posted" flag cannot be saved', async () => {
    const postPayment = vi.fn();
    const logger = { error: vi.fn() };
    const { service, store } = createService({ postPayment }, { logger });
    store.markPaymentPosted = () => {
      throw new Error('db down');
    };
    const body = await esadadRequest('pay-8', RQ, paymentBody(paymentTrx({ trx: 'T-800' })));

    // The money is in the billing system: an error here would make E-SADAD retry and double-post.
    const first = await service.receivePaymentNotification({ body, guid: 'pay-8' });
    expect(first.xml).toContain('<JOEBPPSTrx>T-800</JOEBPPSTrx>');
    expect(first.xml).toContain('<Result><ErrorCode>0</ErrorCode>');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('T-800 WAS POSTED but could not be marked'),
      expect.any(Error),
    );

    // A retry reaching the same process is still recognised.
    const retry = await service.receivePaymentNotification({ body, guid: 'pay-8' });
    expect(retry.xml).toContain('<Result><ErrorCode>0</ErrorCode>');
    expect(postPayment).toHaveBeenCalledTimes(1);
  });

  it('retries saving the "posted" flag after a short failure', async () => {
    const postPayment = vi.fn();
    const { service, store } = createService({ postPayment });
    const realMark = store.markPaymentPosted.bind(store);
    let failures = 1;
    store.markPaymentPosted = (trx: string) => {
      if (failures-- > 0) throw new Error('deadlock');
      realMark(trx);
    };
    const body = await esadadRequest('pay-9', RQ, paymentBody(paymentTrx({ trx: 'T-900' })));
    await service.receivePaymentNotification({ body, guid: 'pay-9' });
    expect(store.isPaymentPosted('T-900')).toBe(true);
  });

  it('returns one result per transaction', async () => {
    const postPayment = vi.fn((t: PaymentTransaction) =>
      t.joebppsTrx === 'B' ? { success: false as const, result: 'INVALID_BILLING_NUMBER' as const } : undefined,
    );
    const { service } = createService({ postPayment });
    const body = await esadadRequest(
      'pay-6',
      RQ,
      paymentBody(
        paymentTrx({ trx: 'A' }),
        paymentTrx({ trx: 'B' }),
        paymentTrx({ trx: 'C', currency: 'USD' }),
        paymentTrx({ trx: 'D', paid: '0' }),
      ),
    );
    const out = await service.receivePaymentNotification({ body, guid: 'pay-6' });
    const codes = [...out.xml.matchAll(/<JOEBPPSTrx>(\w)<\/JOEBPPSTrx>.*?<ErrorCode>(\d+)<\/ErrorCode>/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(codes).toEqual([
      ['A', '0'],
      ['B', '408'],
      ['C', '6'],
      ['D', '7'],
    ]);
  });

  it('answers an invalid signature with a payment-notification body (not a prepaid one)', async () => {
    const postPayment = vi.fn();
    const { service, store } = createService({ postPayment });
    const body = (await esadadRequest('pay-7', RQ, paymentBody(paymentTrx({ trx: 'T-700' })))).replace(
      '<PaidAmt>20.00',
      '<PaidAmt>99999.00',
    );
    const out = await service.receivePaymentNotification({ body, guid: 'pay-7' });

    expect(out.result.code).toBe(2);
    expect(out.xml).toContain('<ResTyp>BLRPMTNTFRS</ResTyp>');
    expect(out.xml).toContain('<Transactions><TrxInf><JOEBPPSTrx>T-700</JOEBPPSTrx>');
    expect(out.xml).not.toContain('BillingInfo');
    expect(postPayment).not.toHaveBeenCalled();
    // Logged before verification (as the spec requires), never marked posted.
    expect(store.payments[0]).toMatchObject({ joebppsTrx: 'T-700', isPaymentPosted: false });
  });
});
