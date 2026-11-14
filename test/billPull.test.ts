import { describe, expect, it, vi } from 'vitest';
import { verifyMessage, type BillPullRequest } from '../src';
import { createService, esadadRequest, esadadSide } from './helpers';

const RQ = 'BILPULRQ';
const body = (billingNo = 'CUST-1', serviceType = 'Invoices') =>
  `<MsgBody><AcctInfo><BillingNo>${billingNo}</BillingNo></AcctInfo><ServiceType>${serviceType}</ServiceType></MsgBody>`;

describe('BillPull', () => {
  it('returns bills with due amount (JOD uses 3 decimals)', async () => {
    const getBills = vi.fn((_req: BillPullRequest) => ({
      found: true as const,
      bills: [{ billNo: 'INV-1', dueAmount: 12.5, dueDate: '2026-12-01', issueDate: new Date(2026, 10, 1, 8, 0, 0) }],
    }));
    const { service } = createService({ getBills });
    const out = await service.billPull({ body: await esadadRequest('bp-1', RQ, body()), guid: 'bp-1' });

    expect(out.result.code).toBe(0);
    expect(out.xml).toContain('<ResTyp>BILPULRS</ResTyp>');
    expect(out.xml).toContain('<RecCount>1</RecCount>');
    expect(out.xml).toContain(
      '<AcctInfo><BillingNo>CUST-1</BillingNo><BillNo>INV-1</BillNo><BillerCode>999</BillerCode></AcctInfo><BillStatus>BillNew</BillStatus><DueAmount>12.500</DueAmount>',
    );
    expect(out.xml).toContain('<IssueDate>2026-11-01T08:00:00</IssueDate><DueDate>2026-12-01</DueDate>');
    expect(out.xml).toContain('<PmtConst><AllowPart>true</AllowPart><Lower>1.000</Lower></PmtConst>');
    expect(out.xml).toContain('<SubPmt><Amount>12.500</Amount><SetBnkCode>99</SetBnkCode>');
    expect(await verifyMessage(out.xml, esadadSide)).toEqual({ valid: true });
    expect(getBills.mock.calls[0]![0]).toMatchObject({ billingNo: 'CUST-1', serviceType: 'Invoices' });
  });

  it('returns a bill without due amount', async () => {
    const { service } = createService({ getBills: () => ({ found: true, bills: [{ dueAmount: 0 }] }) });
    const out = await service.billPull({ body: await esadadRequest('bp-2', RQ, body()), guid: 'bp-2' });
    expect(out.xml).toContain('<DueAmount>0.000</DueAmount>');
  });

  it('returns INVALID_BILLING_NUMBER when the account does not exist', async () => {
    const { service } = createService({ getBills: () => ({ found: false }) });
    const out = await service.billPull({ body: await esadadRequest('bp-3', RQ, body('NOPE')), guid: 'bp-3' });
    expect(out.result.code).toBe(0);
    expect(out.xml).toContain('<RecCount>0</RecCount><BillsRec><BillRec><Result><ErrorCode>408</ErrorCode>');
  });

  it('rejects a prepaid service type', async () => {
    const getBills = vi.fn();
    const { service } = createService({ getBills });
    const out = await service.billPull({ body: await esadadRequest('bp-4', RQ, body('X', 'MOBILE_TOPUP')), guid: 'bp-4' });
    expect(out.xml).toContain('<ErrorCode>5</ErrorCode>');
    expect(getBills).not.toHaveBeenCalled();
  });

  it('answers GENERAL_ERROR when the adapter returns an invalid amount', async () => {
    const { service } = createService({ getBills: () => ({ found: true, bills: [{ dueAmount: Number.NaN }] }) });
    const out = await service.billPull({ body: await esadadRequest('bp-5', RQ, body()), guid: 'bp-5' });
    expect(out.result.code).toBe(500);
    expect(await verifyMessage(out.xml, esadadSide)).toEqual({ valid: true });
  });
});
