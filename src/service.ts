import type { ApiName, ResultCodes } from './constants';
import { ApiNames } from './constants';
import { KeyedLock } from './core/lock';
import { RequestPipeline, defaultTimestamp } from './core/pipeline';
import { ResultResolver } from './core/results';
import { ServiceRegistry } from './core/services';
import { CertificateSigner } from './crypto/signature';
import { EsadadConfigError } from './errors';
import { Authenticator, type AuthenticationResult } from './handlers/authenticationHandler';
import { checkAvailability, type AvailabilityResult } from './handlers/availabilityHandler';
import { BillPullHandler } from './handlers/billPullHandler';
import { PaymentNotificationHandler } from './handlers/paymentNotificationHandler';
import { PrepaidValidationHandler } from './handlers/prepaidValidationHandler';
import type { ApiHandler, HandlerDeps } from './handlers/types';
import { InMemoryStore } from './storage/memory';
import type { EsadadConfig, EsadadStore, HandlerInput, HandlerOutput, Logger, MessageSigner, ServiceConfig } from './types';

const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

/**
 * Entry point of the library. Validates the configuration, wires the
 * components together and exposes one method per E-SADAD API. Works with any
 * web framework: pass it the raw body and query parameters, and return the
 * `xml` it gives back.
 *
 * @example
 * const esadad = new EsadadService({ biller, services, certificates, adapter, store });
 * const { xml } = await esadad.prepaidValidation({ body: rawXml, guid: req.query.guid });
 */
export class EsadadService {
  readonly resultCodes: ResultCodes;
  private readonly config: EsadadConfig;
  private readonly services: ServiceRegistry;
  private readonly logger: Logger;
  private readonly pipeline: RequestPipeline;
  private readonly handlers: Record<ApiName, ApiHandler>;
  private readonly authenticator?: Authenticator;

  constructor(config: EsadadConfig) {
    assertBaseConfig(config);
    this.config = config;
    this.logger = config.logger ?? {};

    const results = new ResultResolver(config.resultCodes);
    this.resultCodes = results.codes;
    this.services = new ServiceRegistry(config.services, config.normalizeBillingNo);
    const signer = createSigner(config);
    const store = createStore(config, this.logger);
    const billerCode = String(config.biller.code);

    if (config.verifySignature === false) {
      this.logger.warn?.('Request signature verification is DISABLED. Never do this in production.');
    }

    this.pipeline = new RequestPipeline({
      billerCode,
      signer,
      store,
      results,
      logger: this.logger,
      credentials: config.credentials,
      verifySignature: config.verifySignature !== false,
      maxBodyBytes: config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      timestamp: config.timestamp ?? defaultTimestamp,
      hooks: config.hooks ?? {},
    });

    if (config.authentication) this.authenticator = new Authenticator(config.authentication, signer, this.logger);

    const deps: HandlerDeps = {
      billerCode,
      adapter: config.adapter,
      store,
      services: this.services,
      results,
      logger: this.logger,
      locks: new KeyedLock(),
      hooks: config.hooks ?? {},
      adapterTimeoutMs: config.adapterTimeoutMs,
    };
    this.handlers = {
      [ApiNames.BILL_PULL]: new BillPullHandler(deps),
      [ApiNames.PREPAID_VALIDATION]: new PrepaidValidationHandler(deps),
      [ApiNames.RECEIVE_PAYMENT_NOTIFICATION]: new PaymentNotificationHandler(deps),
    };
  }

  /** BillPull (post-paid). */
  billPull(input: HandlerInput): Promise<HandlerOutput> {
    return this.handle(ApiNames.BILL_PULL, input);
  }

  /** PrepaidValidation (pre-paid). */
  prepaidValidation(input: HandlerInput): Promise<HandlerOutput> {
    return this.handle(ApiNames.PREPAID_VALIDATION, input);
  }

  /** ReceivePaymentNotification. Idempotent per `JOEBPPSTrx`. */
  receivePaymentNotification(input: HandlerInput): Promise<HandlerOutput> {
    return this.handle(ApiNames.RECEIVE_PAYMENT_NOTIFICATION, input);
  }

  /** Runs an XML API by name. */
  handle(api: ApiName, input: HandlerInput): Promise<HandlerOutput> {
    const handler = this.handlers[api];
    if (!handler) return Promise.reject(new EsadadConfigError(`Unknown API "${String(api)}"`));
    return this.pipeline.execute(handler, input);
  }

  /** Availability Check (`GET /availability?token=...`). Returns the HTTP status and JSON body. */
  availability(token: unknown): Promise<AvailabilityResult> {
    return checkAvailability(token, {
      token: this.config.availabilityToken,
      healthCheck: this.config.healthCheck,
      logger: this.logger,
    });
  }

  /** `true` when `authentication` is configured, so `POST /authentication` is served. */
  get authenticationEnabled(): boolean {
    return this.authenticator !== undefined;
  }

  /**
   * Authentication API (`POST /authentication`). Pass the raw JSON body (string
   * or Buffer) or the parsed object. Returns the HTTP status and the signed JSON
   * body. Never throws.
   */
  async authenticate(body: unknown): Promise<AuthenticationResult> {
    if (this.authenticator) return this.authenticator.authenticate(body);
    return {
      statusCode: 503,
      body: { data: { status: 'error', message: 'Service unavailable', error_code: 503, tranTimestamp: '' }, signature: '' },
    };
  }

  /** `true` when the token came from `authenticate` and has not expired. Always `false` without `authentication`. */
  async verifyAccessToken(token: unknown): Promise<boolean> {
    return this.authenticator ? this.authenticator.verifyAccessToken(token) : false;
  }

  /** Configuration of a service type, or `undefined`. */
  getService(serviceType: string): ServiceConfig | undefined {
    return this.services.find(serviceType);
  }
}

/** Shortcut for `new EsadadService(config)`. */
export function createEsadadService(config: EsadadConfig): EsadadService {
  return new EsadadService(config);
}

// --- construction helpers ----------------------------------------------------

function assertBaseConfig(config: EsadadConfig): void {
  if (!config || typeof config !== 'object') throw new EsadadConfigError('config is required');
  const code = config.biller?.code;
  if (code === undefined || code === null || String(code).trim() === '') throw new EsadadConfigError('biller.code is required');
  if (!config.adapter || typeof config.adapter !== 'object') throw new EsadadConfigError('adapter is required');
  if (config.credentials && (!config.credentials.username || !config.credentials.password)) {
    throw new EsadadConfigError('credentials.username and credentials.password are both required');
  }
  if (config.adapterTimeoutMs !== undefined && !(config.adapterTimeoutMs > 0)) {
    throw new EsadadConfigError('adapterTimeoutMs must be a positive number');
  }
  if (config.maxBodyBytes !== undefined && !(config.maxBodyBytes > 0)) {
    throw new EsadadConfigError('maxBodyBytes must be a positive number');
  }
}

function createSigner(config: EsadadConfig): MessageSigner {
  if (config.signer) return config.signer;
  if (config.certificates) return new CertificateSigner(config.certificates);
  throw new EsadadConfigError('Provide either certificates or signer');
}

function createStore(config: EsadadConfig, logger: Logger): EsadadStore {
  if (config.store) return config.store;
  logger.warn?.('No store configured: using InMemoryStore. Payment retries are not idempotent across restarts.');
  return new InMemoryStore();
}
