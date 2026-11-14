// Express integration: `import { createEsadadRouter } from 'e-sadad-xml/express'`.

import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import type { ApiName } from '../constants';
import { ApiNames } from '../constants';
import type { EsadadService } from '../service';
import type { HandlerInput } from '../types';

export interface EsadadRouterPaths {
  billPull?: string | false;
  prepaidValidation?: string | false;
  receivePaymentNotification?: string | false;
  availability?: string | false;
}

export interface EsadadRouterOptions {
  /**
   * Route paths relative to where the router is mounted. Set a path to `false`
   * to disable that route. Defaults:
   * - `/BillPull`
   * - `/prepaid/PrepaidValidation`
   * - `/Payment/ReceivePaymentNotification`
   * - `/availability`
   */
  paths?: EsadadRouterPaths;
  /** Body size limit passed to `express.text`. Defaults to `512kb`. */
  bodyLimit?: string | number;
}

export const defaultPaths: Required<EsadadRouterPaths> = {
  billPull: '/BillPull',
  prepaidValidation: '/prepaid/PrepaidValidation',
  receivePaymentNotification: '/Payment/ReceivePaymentNotification',
  availability: '/availability',
};

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
};

/** 4xx status set by body-parser (too large, bad charset, aborted request), or undefined. */
function clientErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown; statusCode?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

/** First string value of a query parameter (`?guid=a&guid=b` gives `a`; arrays and objects are ignored). */
function queryValue(req: Request, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = (req.query as Record<string, unknown>)[name];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return undefined;
}

function toHandlerInput(req: Request): HandlerInput {
  return {
    body: typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : '',
    guid: queryValue(req, 'guid', 'GUID', 'Guid'),
    username: queryValue(req, 'username', 'UserName', 'userName'),
    password: queryValue(req, 'password', 'Password'),
  };
}

/**
 * Express router exposing the E-SADAD endpoints. Mount it under a versioned
 * prefix:
 *
 * @example
 * app.use('/api/v1/esadad', createEsadadRouter(esadad));
 */
export function createEsadadRouter(service: EsadadService, options: EsadadRouterOptions = {}): Router {
  const router = express.Router();
  const paths = { ...defaultPaths, ...(options.paths ?? {}) };
  // Read every content type as text: E-SADAD may send text/xml, application/xml or none.
  const readBody = express.text({ type: () => true, limit: options.bodyLimit ?? '512kb' });

  const xmlRoute = (api: ApiName) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const output = await service.handle(api, toHandlerInput(req));
      res.status(200).type('application/xml; charset=utf-8').send(output.xml);
    } catch (err) {
      next(err);
    }
  };

  if (paths.billPull) router.post(paths.billPull, readBody, xmlRoute(ApiNames.BILL_PULL));
  if (paths.prepaidValidation) router.post(paths.prepaidValidation, readBody, xmlRoute(ApiNames.PREPAID_VALIDATION));
  if (paths.receivePaymentNotification) {
    router.post(paths.receivePaymentNotification, readBody, xmlRoute(ApiNames.RECEIVE_PAYMENT_NOTIFICATION));
  }
  if (paths.availability) {
    router.get(paths.availability, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { statusCode, body } = await service.availability(queryValue(req, 'token'));
        res.status(statusCode).json(body);
      } catch (err) {
        next(err);
      }
    });
  }

  // Never send stack traces or internal messages to the caller.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status = clientErrorStatus(err) ?? 500;
    res.status(status).type('text/plain').send(STATUS_TEXT[status] ?? 'Bad Request');
  });

  return router;
}
