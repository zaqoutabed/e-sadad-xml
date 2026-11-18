/**
 * Using the service with any framework (Fastify, NestJS, Koa, plain node:http, ...).
 * Pass the raw body and query parameters, and send back `xml` with HTTP 200.
 */
import { createServer } from 'node:http';
import { EsadadService, EsadadSigningError, type ApiName } from 'e-sadad-xml';

declare const esadad: EsadadService; // built as in prepaid-typescript.ts

const routes: Record<string, ApiName> = {
  '/api/v1/esadad/BillPull': 'BillPull',
  '/api/v1/esadad/prepaid/PrepaidValidation': 'PrepaidValidation',
  '/api/v1/esadad/Payment/ReceivePaymentNotification': 'ReceivePaymentNotification',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const api = req.method === 'POST' ? routes[url.pathname] : undefined;
  if (!api) return void res.writeHead(404).end();

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 512 * 1024) return void res.writeHead(413).end();
    chunks.push(chunk as Buffer);
  }

  try {
    const { xml } = await esadad.handle(api, {
      body: Buffer.concat(chunks),
      guid: url.searchParams.get('guid') ?? undefined,
      username: url.searchParams.get('username') ?? undefined,
      password: url.searchParams.get('password') ?? undefined,
    });
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }).end(xml);
  } catch (err) {
    // Only EsadadSigningError can reach here (broken key): answer 500 so E-SADAD retries.
    res.writeHead(500).end(err instanceof EsadadSigningError ? 'Signing failed' : 'Internal Server Error');
  }
}).listen(3000);
