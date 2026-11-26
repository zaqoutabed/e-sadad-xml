import express from 'express';
import express4 from 'express4';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createEsadadRouter } from '../src/adapters/express';
import {
  authSigningString,
  EsadadConfigError,
  hashAccessToken,
  InMemoryAccessTokenStore,
  type AccessTokenRecord,
  type AuthenticationConfig,
  type AuthSignatureFormat,
} from '../src';
import { billerIdentity, createService, esadadRequest, esadadSide, prepaidBody } from './helpers';

const USER = 'esadadUser';
const SECRET = 'shared-Secret|123';
const adapter = { validatePrepaid: () => ({ valid: true }), postPayment: () => undefined };

function now(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function serviceWith(auth: Partial<AuthenticationConfig> = {}) {
  const tokenStore = auth.tokenStore ?? new InMemoryAccessTokenStore();
  const { service } = createService(adapter, { authentication: { user: USER, secret: SECRET, tokenStore, ...auth } });
  return { service, tokenStore };
}

/** Builds a request signed like E-SADAD does (E-SADAD private key, UTF-8). */
async function signedRequest(
  data: Record<string, string> = { user: USER, secret: SECRET, tranTimestamp: now() },
  format: AuthSignatureFormat = 'pipe',
) {
  return { data, signature: await esadadSide.signUtf8!(authSigningString(data, format)) };
}

/** The response must be signed with the biller private key. */
async function responseSignatureValid(body: { data: object; signature: string }, format: AuthSignatureFormat = 'pipe') {
  return esadadSide.verifyUtf8!(authSigningString(body.data, format), body.signature);
}

describe('Authentication API', () => {
  it('issues a signed token for a valid pipe-signed request', async () => {
    const { service, tokenStore } = serviceWith();
    const req = await signedRequest();
    const { statusCode, body } = await service.authenticate(JSON.stringify(req));

    expect(statusCode).toBe(200);
    expect(Object.keys(body.data)).toEqual(['token', 'expiryDate', 'tranTimestamp']);
    const data = body.data as { token: string; expiryDate: string; tranTimestamp: string };
    expect(data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(data.tranTimestamp).toBe(req.data.tranTimestamp);
    expect(data.expiryDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const sevenDays = 7 * 24 * 3600 * 1000;
    expect(Math.abs(Date.parse(data.expiryDate) - Date.now() - sevenDays)).toBeLessThan(5000);
    expect(await responseSignatureValid(body)).toBe(true);

    // Only the hash is stored, never the token itself.
    expect(tokenStore.findAccessToken(data.token)).toBeUndefined();
    expect(tokenStore.findAccessToken(hashAccessToken(data.token))).toMatchObject({ user: USER });
    expect(await service.verifyAccessToken(data.token)).toBe(true);
  });

  it('issues a different token for every request', async () => {
    const { service } = serviceWith();
    const req = await signedRequest();
    const a = await service.authenticate(req);
    const b = await service.authenticate(req);
    expect((a.body.data as { token: string }).token).not.toBe((b.body.data as { token: string }).token);
  });

  it('accepts a request signed over compact JSON', async () => {
    const { service } = serviceWith();
    const { statusCode } = await service.authenticate(await signedRequest(undefined, 'json'));
    expect(statusCode).toBe(200);
  });

  it('accepts only the configured request formats', async () => {
    const { service } = serviceWith({ requestSignatureFormats: ['pipe'] });
    const { statusCode, body } = await service.authenticate(await signedRequest(undefined, 'json'));
    expect(statusCode).toBe(401);
    expect(body.data).toMatchObject({ message: 'Invalid signature' });
  });

  it('signs responses over compact JSON when configured', async () => {
    const { service } = serviceWith({ responseSignatureFormat: 'json' });
    const { body } = await service.authenticate(await signedRequest());
    expect(await responseSignatureValid(body, 'json')).toBe(true);
    expect(await responseSignatureValid(body, 'pipe')).toBe(false);
  });

  it('rejects wrong credentials with a signed 401', async () => {
    const { service } = serviceWith();
    for (const data of [
      { user: USER, secret: 'wrong', tranTimestamp: now() },
      { user: 'someone', secret: SECRET, tranTimestamp: now() },
    ]) {
      const { statusCode, body } = await service.authenticate(await signedRequest(data));
      expect(statusCode).toBe(401);
      expect(body.data).toEqual({
        status: 'error',
        message: 'Invalid user credentials',
        error_code: 401,
        tranTimestamp: data.tranTimestamp,
      });
      expect(await responseSignatureValid(body)).toBe(true);
    }
  });

  it('rejects a bad or tampered signature', async () => {
    const { service } = serviceWith();
    const req = await signedRequest();
    const tampered = { ...req, data: { ...req.data, secret: 'changed' } };
    for (const body of [tampered, { ...req, signature: 'not base64!' }, { ...req, signature: '' }]) {
      const result = await service.authenticate(body);
      expect(result.statusCode).toBe(401);
      expect(result.body.data).toMatchObject({ message: 'Invalid signature', error_code: 401 });
    }
  });

  it('rejects a request signed with another key', async () => {
    const { service } = serviceWith();
    const data = { user: USER, secret: SECRET, tranTimestamp: now() };
    // Signed with the biller key instead of the E-SADAD key.
    const { CertificateSigner } = await import('../src');
    const wrongSigner = new CertificateSigner({
      esadadCertificate: { data: billerIdentity.certPem },
      billerPfx: { data: billerIdentity.pfx, password: billerIdentity.password },
    });
    const signature = wrongSigner.signUtf8(authSigningString(data, 'pipe'));
    expect((await service.authenticate({ data, signature })).statusCode).toBe(401);
  });

  it('rejects an old or future tranTimestamp, unless the check is off', async () => {
    const { service } = serviceWith();
    for (const offset of [-11 * 60_000, 11 * 60_000]) {
      const result = await service.authenticate(await signedRequest({ user: USER, secret: SECRET, tranTimestamp: now(offset) }));
      expect(result.statusCode).toBe(401);
      expect(result.body.data).toMatchObject({ message: 'Request expired' });
    }
    const relaxed = serviceWith({ maxClockSkewMs: false }).service;
    const old = await signedRequest({ user: USER, secret: SECRET, tranTimestamp: '2025-05-07T12:34:56Z' });
    expect((await relaxed.authenticate(old)).statusCode).toBe(200);
  });

  it('answers malformed requests with a signed 400', async () => {
    const { service } = serviceWith();
    const valid = await signedRequest();
    const cases: unknown[] = [
      '',
      'not json',
      '[]',
      Buffer.from('{"data":'),
      { data: valid.data },
      { signature: valid.signature },
      { data: { ...valid.data, user: 5 }, signature: valid.signature },
      { data: { ...valid.data, secret: '' }, signature: valid.signature },
      { data: { ...valid.data, tranTimestamp: 'yesterday' }, signature: valid.signature },
      { data: { ...valid.data, user: 'x'.repeat(600) }, signature: valid.signature },
      'x'.repeat(20_000),
    ];
    for (const body of cases) {
      const result = await service.authenticate(body);
      expect(result.statusCode).toBe(400);
      expect(result.body.data).toMatchObject({ status: 'error', message: 'Invalid request', error_code: 400 });
      expect(await responseSignatureValid(result.body)).toBe(true);
    }
    // The tranTimestamp of a malformed request is echoed back when it can be read.
    const echoed = await service.authenticate({ data: { tranTimestamp: '2025-05-07T12:34:56Z' } });
    expect(echoed.body.data.tranTimestamp).toBe('2025-05-07T12:34:56Z');
  });

  it('accepts a UTF-8 body with a byte order mark', async () => {
    const { service } = serviceWith();
    const body = Buffer.from(`\uFEFF${JSON.stringify(await signedRequest())}`, 'utf8');
    expect((await service.authenticate(body)).statusCode).toBe(200);
  });

  it('rejects unknown and expired tokens', async () => {
    const expired: AccessTokenRecord = {
      tokenHash: hashAccessToken('a'.repeat(64)),
      user: USER,
      issuedAt: new Date(Date.now() - 2000),
      expiresAt: new Date(Date.now() - 1000),
      tranTimestamp: now(),
    };
    const store = new InMemoryAccessTokenStore();
    store.saveAccessToken(expired);
    const { service } = serviceWith({ tokenStore: store });
    expect(await service.verifyAccessToken('a'.repeat(64))).toBe(false);
    expect(await service.verifyAccessToken('b'.repeat(64))).toBe(false);
    expect(await service.verifyAccessToken('short')).toBe(false);
    expect(await service.verifyAccessToken(undefined)).toBe(false);
  });

  it('answers 500 when the token cannot be saved, and false when it cannot be read', async () => {
    const failing = {
      saveAccessToken: () => Promise.reject(new Error('db down')),
      findAccessToken: () => Promise.reject(new Error('db down')),
    };
    const { service } = serviceWith({ tokenStore: failing });
    const result = await service.authenticate(await signedRequest());
    expect(result.statusCode).toBe(500);
    expect(result.body.data).toMatchObject({ message: 'Internal error' });
    expect(await service.verifyAccessToken('a'.repeat(64))).toBe(false);
  });

  it('answers 503 when authentication is not configured', async () => {
    const { service } = createService(adapter);
    expect(service.authenticationEnabled).toBe(false);
    const result = await service.authenticate(await signedRequest());
    expect(result.statusCode).toBe(503);
    expect(await service.verifyAccessToken('a'.repeat(64))).toBe(false);
  });

  it('rejects invalid configuration', () => {
    const bad: Array<Partial<AuthenticationConfig>> = [
      { user: '' },
      { secret: '' },
      { tokenTtlMs: 0 },
      { maxClockSkewMs: -1 },
      { requestSignatureFormats: [] },
      { requestSignatureFormats: ['xml' as AuthSignatureFormat] },
      { responseSignatureFormat: 'xml' as AuthSignatureFormat },
    ];
    for (const auth of bad) expect(() => serviceWith(auth)).toThrow(EsadadConfigError);

    // A custom signer without UTF-8 support cannot serve the Authentication API.
    const signer = { sign: () => '', verify: () => true };
    expect(() => createService(adapter, { signer, authentication: { user: USER, secret: SECRET } })).toThrow(/signUtf8/);
  });
});

type ExpressFactory = () => ReturnType<typeof express>;
const versions: Array<[string, ExpressFactory]> = [
  ['Express 5', () => express()],
  ['Express 4', () => express4() as unknown as ReturnType<typeof express>],
];

describe.each(versions)('Authentication API over Express (%s)', (_name, createExpress) => {
  it('POST /authentication returns signed JSON', async () => {
    const { service } = serviceWith();
    const app = createExpress();
    app.use('/api/v1/esadad', createEsadadRouter(service));

    const ok = await request(app)
      .post('/api/v1/esadad/authentication')
      .send(await signedRequest());
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/^application\/json/);
    expect(ok.body.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(await responseSignatureValid(ok.body)).toBe(true);

    const malformed = await request(app)
      .post('/api/v1/esadad/authentication')
      .set('Content-Type', 'application/json')
      .send('{oops');
    expect(malformed.status).toBe(400);
    expect(malformed.body.data.message).toBe('Invalid request');

    const tooLarge = await request(app)
      .post('/api/v1/esadad/authentication')
      .set('Content-Type', 'application/json')
      .send(`{"x":"${'a'.repeat(20_000)}"}`);
    expect(tooLarge.status).toBe(413);
  });

  it('does not serve /authentication when it is not configured', async () => {
    const { service } = createService(adapter);
    const app = createExpress();
    app.use(createEsadadRouter(service));
    expect((await request(app).post('/authentication').send({})).status).toBe(404);
    expect(() => createEsadadRouter(service, { requireAccessToken: true })).toThrow(EsadadConfigError);
  });

  it('requireAccessToken protects the XML routes', async () => {
    const { service } = serviceWith();
    const app = createExpress();
    app.use(createEsadadRouter(service, { requireAccessToken: true }));
    const xml = await esadadRequest('tok-1', 'BILRPREPADVALRQ', prepaidBody());

    const missing = await request(app).post('/prepaid/PrepaidValidation?guid=tok-1').send(xml);
    expect(missing.status).toBe(401);
    const wrong = await request(app)
      .post('/prepaid/PrepaidValidation?guid=tok-1')
      .set('Authorization', `Bearer ${'c'.repeat(64)}`)
      .send(xml);
    expect(wrong.status).toBe(401);

    const auth = await request(app)
      .post('/authentication')
      .send(await signedRequest());
    const ok = await request(app)
      .post('/prepaid/PrepaidValidation?guid=tok-1')
      .set('Authorization', `Bearer ${auth.body.data.token}`)
      .send(xml);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('<ErrorCode>0</ErrorCode>');
  });
});
