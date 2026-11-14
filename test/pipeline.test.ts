import { describe, expect, it, vi } from 'vitest';
import { EsadadConfigError, EsadadService, EsadadSigningError, verifyMessage, type EsadadStore } from '../src';
import { HATCARD_SERVICE, createService, esadadIdentity, esadadRequest, esadadSide, prepaidBody } from './helpers';

const RQ = 'BILRPREPADVALRQ';
const adapter = { validatePrepaid: () => ({ valid: true as const }) };

describe('request pipeline: header-level errors', () => {
  it.each([
    ['empty body', ''],
    ['malformed XML', '<MFEP><MsgBody>'],
    ['not XML', 'hello'],
    ['DOCTYPE / entity expansion', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><MFEP><MsgBody>&a;</MsgBody></MFEP>'],
    ['external entity (XXE)', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><MFEP><MsgBody>&e;</MsgBody></MFEP>'],
  ])('%s → INVALID_REQUEST, signed, request still logged', async (_name, body) => {
    const { service, store } = createService(adapter);
    const out = await service.prepaidValidation({ body, guid: 'g-1' });
    expect(out.result.code).toBe(1);
    expect(out.xml).toContain('<GUID>g-1</GUID>');
    expect(out.xml).not.toContain('passwd');
    expect(await verifyMessage(out.xml, esadadSide)).toEqual({ valid: true });
    expect(store.transactions.map((t) => t.transactionType)).toEqual(['Request', 'Response']);
  });

  it('survives deeply nested XML without crashing', async () => {
    const { service } = createService(adapter, { maxBodyBytes: 2_000_000 });
    const depth = 100_000;
    const body = `<MFEP><MsgHeader><GUID>deep</GUID></MsgHeader><MsgBody>${'<a>'.repeat(depth)}${'</a>'.repeat(depth)}</MsgBody></MFEP>`;
    const out = await service.prepaidValidation({ body, guid: 'deep' });
    expect(out.result.code).not.toBe(0);
    expect(await verifyMessage(out.xml, esadadSide)).toEqual({ valid: true });
  });

  it('rejects bodies over maxBodyBytes', async () => {
    const { service, store } = createService(adapter, { maxBodyBytes: 1000 });
    const out = await service.prepaidValidation({ body: `<MFEP>${'x'.repeat(5000)}</MFEP>`, guid: 'g' });
    expect(out.result.code).toBe(1);
    expect(store.transactions[0]!.xml.length).toBeLessThan(1100);
  });

  it('uses MsgHeader/GUID when the query has none', async () => {
    const { service } = createService(adapter);
    const out = await service.prepaidValidation({ body: await esadadRequest('hdr-guid', RQ, prepaidBody()) });
    expect(out.guid).toBe('hdr-guid');
    expect(out.result.code).toBe(0);
  });

  it('rejects a query GUID that differs from MsgHeader/GUID', async () => {
    const { service } = createService(adapter);
    const out = await service.prepaidValidation({ body: await esadadRequest('real', RQ, prepaidBody()), guid: 'other' });
    expect(out.result.code).toBe(1);
  });

  it('rejects a GUID with unsafe characters and does not echo it', async () => {
    const { service } = createService(adapter);
    const body = (await esadadRequest('x', RQ, prepaidBody())).replace('<GUID>x</GUID>', '');
    const out = await service.prepaidValidation({ body, guid: '<script>alert(1)</script>' });
    expect(out.result.code).toBe(1);
    expect(out.xml).toContain('<GUID></GUID>');
    expect(out.xml).not.toContain('script');
  });

  it('rejects requests without a GUID', async () => {
    const { service } = createService(adapter);
    const body = (await esadadRequest('x', RQ, prepaidBody())).replace('<GUID>x</GUID>', '');
    expect((await service.prepaidValidation({ body })).result.code).toBe(1);
  });

  it('rejects a missing or wrong signature', async () => {
    const validatePrepaid = vi.fn();
    const { service } = createService({ validatePrepaid });
    const signed = await esadadRequest('g', RQ, prepaidBody());
    const unsigned = signed.replace(/<Signature>[^<]*<\/Signature>/, '<Signature></Signature>');
    const tampered = signed.replace('<DueAmt>20</DueAmt>', '<DueAmt>2</DueAmt>');

    for (const body of [unsigned, tampered]) {
      const out = await service.prepaidValidation({ body, guid: 'g' });
      expect(out.result).toEqual({ code: 2, desc: 'Invalid Signature', severity: 'Error' });
      expect(out.xml).toContain('<BillingInfo><Result><ErrorCode>2</ErrorCode>');
    }
    expect(validatePrepaid).not.toHaveBeenCalled();
  });

  it('checks optional username/password', async () => {
    const { service } = createService(adapter, { credentials: { username: 'esadad', password: 's3cret' } });
    const body = await esadadRequest('g', RQ, prepaidBody());
    expect((await service.prepaidValidation({ body, guid: 'g' })).result.code).toBe(3);
    expect((await service.prepaidValidation({ body, guid: 'g', username: 'esadad', password: 'wrong' })).result.code).toBe(3);
    expect((await service.prepaidValidation({ body, guid: 'g', username: 'esadad', password: 's3cret' })).result.code).toBe(0);
  });

  it('still answers when the transaction log store fails', async () => {
    const logger = { error: vi.fn() };
    const failingStore: EsadadStore = {
      logTransaction: () => {
        throw new Error('db down');
      },
      logPayment: () => undefined,
      isPaymentPosted: () => false,
      markPaymentPosted: () => undefined,
    };
    const { service } = createService(adapter, { store: failingStore, logger });
    const out = await service.prepaidValidation({ body: await esadadRequest('g', RQ, prepaidBody()), guid: 'g' });
    expect(out.result.code).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it('throws EsadadSigningError when the response cannot be signed', async () => {
    const { service } = createService(adapter, {
      signer: { sign: () => Promise.reject(new Error('HSM offline')), verify: () => true },
    });
    await expect(
      service.prepaidValidation({ body: await esadadRequest('g', RQ, prepaidBody()), guid: 'g' }),
    ).rejects.toBeInstanceOf(EsadadSigningError);
  });

  it('supports overriding result codes', async () => {
    const { service } = createService(adapter, {
      resultCodes: { INVALID_SIGNATURE: { code: 99, desc: 'Bad Signature', severity: 'Error' } },
    });
    const out = await service.prepaidValidation({ body: '<MFEP><MsgBody/></MFEP>', guid: 'g' });
    expect(out.result.code).toBe(99);
  });
});

describe('service helpers', () => {
  it('handle() dispatches by API name and rejects unknown names', async () => {
    const { service } = createService(adapter);
    const out = await service.handle('PrepaidValidation', { body: await esadadRequest('h', RQ, prepaidBody()), guid: 'h' });
    expect(out.api).toBe('PrepaidValidation');
    await expect(service.handle('Nope' as never, { body: '' })).rejects.toBeInstanceOf(EsadadConfigError);
  });

  it('getService() returns the service config', () => {
    const { service } = createService(adapter);
    expect(service.getService('TELC_Recharge')?.iban).toBe('PS49PALS045431072990993100000');
    expect(service.getService('missing')).toBeUndefined();
  });

  it('answers GENERAL_ERROR when the adapter method for an API is missing', async () => {
    const { service } = createService({});
    const out = await service.prepaidValidation({ body: await esadadRequest('m', RQ, prepaidBody()), guid: 'm' });
    expect(out.result.code).toBe(500);
  });
});

describe('configuration validation', () => {
  const base = {
    biller: { code: 344 },
    services: [HATCARD_SERVICE],
    certificates: { esadadCertificate: { data: esadadIdentity.certPem }, billerPrivateKey: { data: esadadIdentity.keyPem } },
    adapter,
  };

  it('accepts a valid configuration', () => {
    expect(() => new EsadadService(base)).not.toThrow();
  });

  it.each([
    ['missing biller code', { biller: { code: '' } }],
    ['no services', { services: [] }],
    ['duplicate service', { services: [HATCARD_SERVICE, HATCARD_SERVICE] }],
    ['bad currency', { services: [{ ...HATCARD_SERVICE, currency: 'GBP' }] }],
    ['bad payment type', { services: [{ ...HATCARD_SERVICE, paymentType: 'Monthly' }] }],
    ['missing IBAN', { services: [{ ...HATCARD_SERVICE, iban: '' }] }],
    ['lower > upper', { services: [{ ...HATCARD_SERVICE, lowerValue: 10, upperValue: 1 }] }],
    ['no keys', { certificates: undefined }],
    ['half credentials', { credentials: { username: 'a', password: '' } }],
    ['missing adapter', { adapter: undefined }],
  ])('rejects %s', (_name, override) => {
    expect(() => new EsadadService({ ...base, ...override } as never)).toThrow(EsadadConfigError);
  });
});

describe('availability', () => {
  it('returns success with the right token', async () => {
    const { service } = createService(adapter, { availabilityToken: 'tok-123' });
    const res = await service.availability('tok-123');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'success', availability: { status_code: 200, status_message: 'OK' } });
    expect(typeof res.body.availability!.response_time).toBe('number');
    expect(res.body.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects wrong, missing or non-string tokens', async () => {
    const { service } = createService(adapter, { availabilityToken: 'tok-123' });
    for (const token of ['nope', undefined, ['tok-123'], { a: 1 }]) {
      const res = await service.availability(token);
      expect(res.statusCode).toBe(401);
      expect(res.body).toMatchObject({ status: 'error', error_code: 401 });
    }
  });

  it('reports 503 when the health check fails or no token is configured', async () => {
    const failing = createService(adapter, { availabilityToken: 't', healthCheck: () => Promise.reject(new Error('x')) }).service;
    expect((await failing.availability('t')).statusCode).toBe(503);
    const unhealthy = createService(adapter, { availabilityToken: 't', healthCheck: () => false }).service;
    expect((await unhealthy.availability('t')).body.message).toBe('Target unreachable');
    expect((await createService(adapter).service.availability('t')).statusCode).toBe(503);
  });
});
