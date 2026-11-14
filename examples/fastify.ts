/**
 * Fastify integration (npm i fastify). The same pattern works for Koa, Hono,
 * NestJS, etc.: give the service the raw body and query values, send back `xml`.
 */
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { EsadadService, EsadadSigningError, InMemoryStore, type ApiName } from 'e-sadad-xml';

const esadad = new EsadadService({
  biller: { code: 344 },
  services: [{ serviceType: 'TELC_Recharge', paymentType: 'PrePaid', currency: 'ILS', bankCode: 8, iban: 'PS49PALS045431072990993100000' }],
  certificates: {
    esadadCertificate: { path: 'dev-keys/esadad-dev.cer' },
    billerPfx: { path: 'dev-keys/biller-dev.pfx', password: 'dev-password' },
  },
  adapter: { validatePrepaid: async () => ({ valid: true }), postPayment: async () => undefined },
  store: new InMemoryStore(),
  availabilityToken: process.env.AVAILABILITY_TOKEN ?? 'dev-token',
});

type EsadadQuery = { guid?: string; username?: string; password?: string };
const app = Fastify({ logger: true, bodyLimit: 512 * 1024 });

// Everything under /api/v1/esadad receives the body as a plain string,
// whatever Content-Type E-SADAD sends (text/xml, application/xml or none).
app.register(
  async (esadadRoutes) => {
    esadadRoutes.removeAllContentTypeParsers();
    esadadRoutes.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

    const xmlRoute = (api: ApiName) => async (req: FastifyRequest<{ Querystring: EsadadQuery }>, reply: FastifyReply) => {
      try {
        const { xml } = await esadad.handle(api, {
          body: typeof req.body === 'string' ? req.body : '',
          guid: req.query.guid,
          username: req.query.username,
          password: req.query.password,
        });
        return reply.code(200).header('Content-Type', 'application/xml; charset=utf-8').send(xml);
      } catch (err) {
        // Only EsadadSigningError reaches here (key problem): 500 makes E-SADAD retry later.
        app.log.error(err);
        return reply.code(500).send(err instanceof EsadadSigningError ? 'Signing failed' : 'Internal Server Error');
      }
    };

    esadadRoutes.post('/BillPull', xmlRoute('BillPull'));
    esadadRoutes.post('/prepaid/PrepaidValidation', xmlRoute('PrepaidValidation'));
    esadadRoutes.post('/Payment/ReceivePaymentNotification', xmlRoute('ReceivePaymentNotification'));
    esadadRoutes.get<{ Querystring: { token?: string } }>('/availability', async (req, reply) => {
      const { statusCode, body } = await esadad.availability(req.query.token);
      return reply.code(statusCode).send(body);
    });
  },
  { prefix: '/api/v1/esadad' },
);

app.listen({ port: 3000 });
