import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestAvailability } from '../src';

/** A tiny server that misbehaves in different ways, one path per case. */
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/plain-ok') return void res.writeHead(200, { 'Content-Type': 'text/plain' }).end('OK');
    if (url.pathname === '/plain-error')
      return void res.writeHead(502, { 'Content-Type': 'text/html' }).end('<h1>Bad Gateway</h1>');
    if (url.pathname === '/other-json') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"hello":1}');
    if (url.pathname === '/slow') return; // never answers
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: url.searchParams.get('token') }));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('requestAvailability', () => {
  it('builds a success result when a healthy endpoint does not answer in the documented format', async () => {
    for (const path of ['/plain-ok', '/other-json']) {
      const result = await requestAvailability({ baseUrl, path, token: 't' });
      expect(result).toMatchObject({ status: 'success', availability: { status_code: 200 } });
    }
  });

  it('builds an error result from a non-JSON error response', async () => {
    const result = await requestAvailability({ baseUrl, path: '/plain-error', token: 't' });
    expect(result).toMatchObject({ status: 'error', error_code: 502, message: 'Bad Gateway' });
  });

  it('reports a timeout as 408 and never throws', async () => {
    const result = await requestAvailability({ baseUrl, path: '/slow', token: 't', timeoutMs: 100 });
    expect(result).toMatchObject({ status: 'error', error_code: 408, message: 'Request timed out' });
  });

  it('sends the token (URL-encoded) to the default /availability path', async () => {
    const res = await fetch(`${baseUrl}/availability?token=${encodeURIComponent('a b&c')}`);
    expect(await res.json()).toEqual({ token: 'a b&c' });
    const result = await requestAvailability({ baseUrl, token: 'a b&c' });
    expect(result.status).toBe('success');
  });
});
