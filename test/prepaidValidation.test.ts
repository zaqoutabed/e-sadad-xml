import { describe, expect, it, vi } from 'vitest';
import { EsadadError, verifyMessage, type PrepaidValidationRequest } from '../src';
import { createService, esadadRequest, esadadSide, prepaidBody } from './helpers';

const RQ = 'BILRPREPADVALRQ';

describe('PrepaidValidation', () => {
  it('returns a signed success response with SubPmts from the service config', async () => {
    const validatePrepaid = vi.fn(async (_req: PrepaidValidationRequest) => ({ valid: true as const }));
    const { service, store } = createService({ validatePrepaid });

    const body = await esadadRequest('guid-1', RQ, prepaidBody({ billingNo: '970599123456', amount: '20' }));
    const out = await service.prepaidValidation({ body, guid: 'guid-1' });

    expect(out.result.code).toBe(0);
    expect(out.xml).toBe(
      '<MFEP><MsgHeader><TmStp>2026-11-12T10:00:00</TmStp><GUID>guid-1</GUID><TrsInf><SdrCode>999</SdrCode><ResTyp>BILRPREPADVALRS</ResTyp></TrsInf>' +
        '<Result><ErrorCode>0</ErrorCode><ErrorDesc>Success</ErrorDesc><Severity>Info</Severity></Result></MsgHeader>' +
        '<MsgBody><BillingInfo><Result><ErrorCode>0</ErrorCode><ErrorDesc>Success</ErrorDesc><Severity>Info</Severity></Result>' +
        '<AcctInfo><BillingNo>970599123456</BillingNo><BillerCode>999</BillerCode></AcctInfo><DueAmt>20.00</DueAmt><Currency>ILS</Currency>' +
        '<ValidationCode>VC-001</ValidationCode><ServiceTypeDetails><ServiceType>MOBILE_TOPUP</ServiceType></ServiceTypeDetails>' +
        '<SubPmts><SubPmt><Amount>20.00</Amount><SetBnkCode>99</SetBnkCode><AcctNo>PS00XXXX000000000000000000000</AcctNo></SubPmt></SubPmts>' +
        `</BillingInfo></MsgBody><MsgFooter><Security><Signature>${out.xml.match(/<Signature>([^<]+)</)![1]}</Signature></Security></MsgFooter></MFEP>`,
    );
    expect(await verifyMessage(out.xml, esadadSide)).toEqual({ valid: true });

    // The adapter receives the normalised billing number and parsed values.
    const req = validatePrepaid.mock.calls[0]![0];
    expect(req).toMatchObject({ guid: 'guid-1', billingNo: '0599123456', originalBillingNo: '970599123456', dueAmount: 20 });
    expect(req.service.serviceType).toBe('MOBILE_TOPUP');

    // Request and response are both logged.
    expect(store.transactions.map((t) => [t.transactionType, t.api, t.guid, t.billingNo, t.serviceType, t.currency])).toEqual([
      ['Request', 'PrepaidValidation', 'guid-1', '970599123456', 'MOBILE_TOPUP', 'ILS'],
      ['Response', 'PrepaidValidation', 'guid-1', '970599123456', 'MOBILE_TOPUP', 'ILS'],
    ]);
  });

  it('lets the adapter override the amount, validation code and sub-payments', async () => {
    const { service } = createService({
      validatePrepaid: () => ({
        valid: true,
        dueAmount: 25,
        validationCode: 'NEW',
        subPayments: [{ amount: 25, bankCode: '99', accountNo: 'X' }],
      }),
    });
    const out = await service.prepaidValidation({ body: await esadadRequest('g', RQ, prepaidBody()), guid: 'g' });
    expect(out.xml).toContain('<DueAmt>25.00</DueAmt>');
    expect(out.xml).toContain('<ValidationCode>NEW</ValidationCode>');
    expect(out.xml).toContain('<SubPmt><Amount>25.00</Amount><SetBnkCode>99</SetBnkCode><AcctNo>X</AcctNo></SubPmt>');
  });

  it.each([
    ['unknown customer (adapter)', {}, { valid: false as const }, 408],
    ['invalid phone number', { billingNo: '12345' }, null, 408],
    ['amount above upper limit', { amount: '5000' }, null, 7],
    ['negative amount', { amount: '-1' }, null, 7],
    ['non-numeric amount', { amount: 'abc' }, null, 7],
    ['hex amount', { amount: '0x10' }, null, 7],
    ['exponent amount', { amount: '1e2' }, null, 7],
    ['wrong biller code', { billerCode: '111' }, null, 4],
    ['unknown service type', { serviceType: 'Nope' }, null, 5],
    ['post-paid service used for prepaid', { serviceType: 'Invoices' }, null, 5],
    ['wrong currency', { currency: 'USD' }, null, 6],
  ])('%s → body error %s with a successful header', async (_name, opts, adapterResult, code) => {
    const validatePrepaid = vi.fn(() => adapterResult ?? { valid: true as const });
    const { service } = createService({ validatePrepaid });
    const out = await service.prepaidValidation({ body: await esadadRequest('g', RQ, prepaidBody(opts)), guid: 'g' });

    expect(out.result.code).toBe(0);
    expect(out.xml).toContain(`<BillingInfo><Result><ErrorCode>${code}</ErrorCode>`);
    expect(await verifyMessage(out.xml, esadadSide)).toEqual({ valid: true });
    if (!adapterResult) expect(validatePrepaid).not.toHaveBeenCalled();
  });

  it('maps an EsadadError thrown by the adapter to its code', async () => {
    const { service } = createService({
      validatePrepaid: () => {
        throw new EsadadError({ code: 410, desc: 'Account Suspended', severity: 'Error' });
      },
    });
    const out = await service.prepaidValidation({ body: await esadadRequest('g', RQ, prepaidBody()), guid: 'g' });
    expect(out.xml).toContain('<Result><ErrorCode>410</ErrorCode><ErrorDesc>Account Suspended</ErrorDesc>');
  });

  it('never leaks internal error messages', async () => {
    const { service } = createService({
      validatePrepaid: () => {
        throw new Error('DB password=hunter2 at 10.0.0.5');
      },
    });
    const out = await service.prepaidValidation({ body: await esadadRequest('g', RQ, prepaidBody()), guid: 'g' });
    expect(out.result).toEqual({ code: 500, desc: 'General Error', severity: 'Error' });
    expect(out.xml).not.toContain('hunter2');
    expect(out.xml).not.toContain('10.0.0.5');
  });

  it('escapes request values echoed in the response', async () => {
    const { service } = createService({ validatePrepaid: () => ({ valid: false }) });
    const body = await esadadRequest('g', RQ, prepaidBody({ billingNo: '&lt;/BillingNo&gt;&lt;Injected/&gt;' }));
    const out = await service.prepaidValidation({ body, guid: 'g' });
    expect(out.xml).not.toContain('<Injected/>');
    expect(out.xml).toContain('<BillingNo>&lt;/BillingNo&gt;&lt;Injected/&gt;</BillingNo>');
  });
});
