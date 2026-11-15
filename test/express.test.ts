import express from 'express';
import express4 from 'express4';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createEsadadRouter } from '../src/adapters/express';
import { requestAvailability } from '../src';
import { createService, esadadRequest, paymentBody, paymentTrx, prepaidBody } from './helpers';

type ExpressFactory = () => ReturnType<typeof express>;

function createApp(createExpress: ExpressFactory) {
  const { service } = createService(
    { validatePrepaid: () => ({ valid: true }), postPayment: () => undefined },
    { availabilityToken: 'tok' },
  );
  const app = createExpress();
  app.use('/api/v1/esadad', createEsadadRouter(service, { bodyLimit: '10kb' }));
  return app;
}

// The router must work with both supported Express major versions.
const versions: Array<[string, ExpressFactory]> = [
  ['Express 5', () => express()],
  ['Express 4', () => express4() as unknown as ReturnType<typeof express>],
];

describe.each(versions)('Express adapter (%s)', (_name, createExpress) => {
  const app = createApp(createExpress);

  it('POST /prepaid/PrepaidValidation returns XML', async () => {
    const body = await esadadRequest('ex-1', 'BILRPREPADVALRQ', prepaidBody());
    const res = await request(app)
      .post('/api/v1/esadad/prepaid/PrepaidValidation?guid=ex-1')
      .set('Content-Type', 'text/xml')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/xml/);
    expect(res.text).toContain('<ResTyp>BILRPREPADVALRS</ResTyp>');
    expect(res.text).toContain('<ErrorCode>0</ErrorCode>');
  });

  it('POST /Payment/ReceivePaymentNotification works without a Content-Type', async () => {
    const body = await esadadRequest('ex-2', 'BLRPMTNTFRQ', paymentBody(paymentTrx({ trx: 'EX-2' })));
    const res = await request(app).post('/api/v1/esadad/Payment/ReceivePaymentNotification?guid=ex-2').send(Buffer.from(body));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<JOEBPPSTrx>EX-2</JOEBPPSTrx>');
  });

  it('ignores array query parameters safely', async () => {
    const body = await esadadRequest('ex-3', 'BILRPREPADVALRQ', prepaidBody());
    const res = await request(app).post('/api/v1/esadad/prepaid/PrepaidValidation?guid=ex-3&guid=evil').type('xml').send(body);
    expect(res.text).toContain('<GUID>ex-3</GUID>');
  });

  it('answers 413 without details for oversized bodies', async () => {
    const res = await request(app)
      .post('/api/v1/esadad/BillPull?guid=g')
      .type('xml')
      .send('<a>' + 'x'.repeat(20_000) + '</a>');
    expect(res.status).toBe(413);
    expect(res.text).toBe('Payload Too Large');
  });

  it('accepts a UTF-16 body sent without a charset', async () => {
    const xml = await esadadRequest('ex-16', 'BILRPREPADVALRQ', prepaidBody());
    const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
    const res = await request(app)
      .post('/api/v1/esadad/prepaid/PrepaidValidation?guid=ex-16')
      .set('Content-Type', 'text/xml')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<BillingInfo><Result><ErrorCode>0</ErrorCode>');
  });

  it('honours a declared charset', async () => {
    const xml = await esadadRequest('ex-17', 'BILRPREPADVALRQ', prepaidBody());
    const res = await request(app)
      .post('/api/v1/esadad/prepaid/PrepaidValidation?guid=ex-17')
      .set('Content-Type', 'text/xml; charset="windows-1252"')
      .send(Buffer.from(xml, 'latin1'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<BillingInfo><Result><ErrorCode>0</ErrorCode>');
  });

  it('answers 415 without details for an unsupported charset', async () => {
    const res = await request(app)
      .post('/api/v1/esadad/BillPull?guid=g')
      .set('Content-Type', 'text/xml; charset=klingon')
      .send('<a/>');
    expect(res.status).toBe(415);
    expect(res.text).toBe('Unsupported Media Type');
  });

  it('GET /availability', async () => {
    expect((await request(app).get('/api/v1/esadad/availability?token=tok')).body.status).toBe('success');
    const denied = await request(app).get('/api/v1/esadad/availability?token=bad');
    expect(denied.status).toBe(401);
    expect(denied.body).toMatchObject({ status: 'error', error_code: 401 });
  });

  it('requestAvailability client talks to the endpoint', async () => {
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const ok = await requestAvailability({
        baseUrl: `http://127.0.0.1:${port}`,
        path: '/api/v1/esadad/availability',
        token: 'tok',
      });
      expect(ok.status).toBe('success');
      const bad = await requestAvailability({
        baseUrl: `http://127.0.0.1:${port}`,
        path: '/api/v1/esadad/availability',
        token: 'x',
      });
      expect(bad).toMatchObject({ status: 'error', error_code: 401 });
      const down = await requestAvailability({ baseUrl: 'http://127.0.0.1:1', token: 'x', timeoutMs: 2000 });
      expect(down.status).toBe('error');
    } finally {
      server.close();
    }
  });
});
