import { describe, expect, it, vi } from 'vitest';
import type { PaymentTransaction, RequestCompletedEvent } from '../src';
import { createService, esadadRequest, paymentBody, paymentTrx, prepaidBody } from './helpers';

describe('hooks', () => {
  it('onPaymentPosted runs once per posted payment, not for retries', async () => {
    const onPaymentPosted = vi.fn(async (_trx: PaymentTransaction) => undefined);
    const { service } = createService({ postPayment: () => undefined }, { hooks: { onPaymentPosted } });
    const body = await esadadRequest('h-1', 'BLRPMTNTFRQ', paymentBody(paymentTrx({ trx: 'H-1' })));

    await service.receivePaymentNotification({ body, guid: 'h-1' });
    await service.receivePaymentNotification({ body, guid: 'h-1' }); // retry

    await vi.waitFor(() => expect(onPaymentPosted).toHaveBeenCalledTimes(1));
    expect(onPaymentPosted.mock.calls[0]![0]).toMatchObject({ joebppsTrx: 'H-1', billingNo: '0599123456', paidAmount: 20 });
    await new Promise((r) => setTimeout(r, 20));
    expect(onPaymentPosted).toHaveBeenCalledTimes(1);
  });

  it('onPaymentPosted is not called when posting fails', async () => {
    const onPaymentPosted = vi.fn();
    const { service } = createService({ postPayment: () => ({ success: false as const }) }, { hooks: { onPaymentPosted } });
    const body = await esadadRequest('h-2', 'BLRPMTNTFRQ', paymentBody(paymentTrx({ trx: 'H-2' })));
    await service.receivePaymentNotification({ body, guid: 'h-2' });
    await new Promise((r) => setTimeout(r, 20));
    expect(onPaymentPosted).not.toHaveBeenCalled();
  });

  it('a slow or failing hook never delays or changes the response', async () => {
    const logger = { error: vi.fn() };
    let finishHook!: () => void;
    const onPaymentPosted = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          finishHook = () => reject(new Error('SMS gateway down'));
        }),
    );
    const { service } = createService({ postPayment: () => undefined }, { hooks: { onPaymentPosted }, logger });
    const body = await esadadRequest('h-3', 'BLRPMTNTFRQ', paymentBody(paymentTrx({ trx: 'H-3' })));

    const out = await service.receivePaymentNotification({ body, guid: 'h-3' }); // returns while the hook is pending
    expect(out.xml).toContain('<Result><ErrorCode>0</ErrorCode>');

    await vi.waitFor(() => expect(onPaymentPosted).toHaveBeenCalled());
    finishHook();
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('onPaymentPosted(H-3) failed'), expect.any(Error)),
    );
  });

  it('onRequestCompleted reports every request with its result and duration', async () => {
    const events: RequestCompletedEvent[] = [];
    const { service } = createService(
      { validatePrepaid: () => ({ valid: true }) },
      { hooks: { onRequestCompleted: (e) => void events.push(e) } },
    );
    await service.prepaidValidation({ body: await esadadRequest('h-4', 'BILRPREPADVALRQ', prepaidBody()), guid: 'h-4' });
    await service.prepaidValidation({ body: 'not xml', guid: 'h-5' });

    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[0]).toMatchObject({ api: 'PrepaidValidation', guid: 'h-4', result: { code: 0 } });
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(events[0]!.responseXml).toContain('<ResTyp>BILRPREPADVALRS</ResTyp>');
    expect(events[1]).toMatchObject({ guid: 'h-5', result: { code: 1 }, requestXml: 'not xml' });
  });
});
