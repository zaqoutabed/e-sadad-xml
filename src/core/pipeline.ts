import { EsadadError } from '../errors';
import type { ApiHandler, Reply, RequestContext } from '../handlers/types';
import { buildEnvelope, parseHeader } from '../messages/envelope';
import type { Credentials, EsadadHooks, EsadadStore, HandlerInput, HandlerOutput, Logger, MessageSigner } from '../types';
import { formatTimestamp } from '../utils/datetime';
import { el, toXml } from '../xml/builder';
import { canonicalMsgBody } from '../xml/c14n';
import { decodeXmlBody } from '../xml/encoding';
import { parseXml, text, type XDocument } from '../xml/parser';
import { runInBackground } from './background';
import type { ResultResolver } from './results';
import { safeEqual } from './security';

export interface PipelineOptions {
  billerCode: string;
  signer: MessageSigner;
  store: EsadadStore;
  results: ResultResolver;
  logger: Logger;
  credentials?: Credentials;
  verifySignature: boolean;
  maxBodyBytes: number;
  timestamp: () => string;
  hooks: EsadadHooks;
}

/** GUIDs are echoed in responses and written to logs, so only plain identifier characters are accepted. */
const GUID_PATTERN = /^[A-Za-z0-9{}._-]{1,100}$/;

/** Thrown when a response cannot be signed (for example, a broken key). The HTTP layer should answer 500. */
export class EsadadSigningError extends Error {
  constructor(cause: unknown) {
    super('Failed to sign the E-SADAD response', { cause });
    this.name = 'EsadadSigningError';
  }
}

/**
 * The steps shared by every XML API, in the order the E-SADAD integration
 * document requires:
 *
 *   1. read the inputs (guid, username and password from the query, XML from the body)
 *   2. log the request
 *   3. handler.beforeVerify (for example, payment log rows)
 *   4. check credentials and verify the request signature
 *   5. handler.process (business logic)
 *   6. sign `MsgBody` and build the response envelope
 *   7. log the response
 *
 * Any error in steps 1-5 becomes a signed error response with a generic
 * description; internal details go only to the logger. `execute` throws only
 * `EsadadSigningError`, when the response cannot be signed at all.
 */
export class RequestPipeline {
  constructor(private readonly options: PipelineOptions) {}

  async execute(handler: ApiHandler, input: HandlerInput): Promise<HandlerOutput> {
    const startedAt = Date.now();
    const ctx = this.readInputs(handler, input);
    let reply: Reply;

    try {
      const inputError = this.parse(ctx) ?? this.checkGuid(ctx, input);
      await this.log(ctx, handler, 'Request', ctx.rawXml);
      if (inputError) throw inputError;

      if (handler.beforeVerify) await handler.beforeVerify(ctx);
      this.checkCredentials(input);
      await this.checkSignature(ctx.doc!);

      reply = await handler.process(ctx);
    } catch (err) {
      reply = this.errorReply(handler, ctx, err);
    }

    let xml: string;
    try {
      xml = await this.buildResponse(handler.responseType, ctx.guid, reply);
    } catch (err) {
      this.options.logger.error?.(`[${ctx.api}] ${ctx.guid}: cannot sign response`, err);
      throw new EsadadSigningError(err);
    }
    await this.log(ctx, handler, 'Response', xml, reply.result.code);
    this.notifyCompleted(ctx, reply, xml, Date.now() - startedAt);
    return { xml, result: reply.result, api: handler.api, guid: ctx.guid };
  }

  /** Runs `hooks.onRequestCompleted` in the background (metrics, alerts). */
  private notifyCompleted(ctx: RequestContext, reply: Reply, responseXml: string, durationMs: number): void {
    const hook = this.options.hooks.onRequestCompleted;
    if (!hook) return;
    const event = { api: ctx.api, guid: ctx.guid, result: reply.result, durationMs, requestXml: ctx.rawXml, responseXml };
    runInBackground(`[${ctx.api}] ${ctx.guid}: onRequestCompleted`, () => hook(event), this.options.logger);
  }

  // --- Step 1 ---------------------------------------------------------------

  private readInputs(handler: ApiHandler, input: HandlerInput): RequestContext {
    const body = input?.body;
    // Buffers may be UTF-8 or UTF-16: detect from the bytes.
    const rawXml = Buffer.isBuffer(body) ? decodeXmlBody(body) : typeof body === 'string' ? body : '';
    const guid = typeof input?.guid === 'string' ? input.guid.trim() : '';
    return { api: handler.api, guid, rawXml, header: {} };
  }

  /**
   * Parses the body into `ctx`. Returns the error instead of throwing, so the
   * request can still be logged first.
   */
  private parse(ctx: RequestContext): EsadadError | undefined {
    if (Buffer.byteLength(ctx.rawXml, 'utf8') > this.options.maxBodyBytes) {
      ctx.rawXml = ctx.rawXml.slice(0, 1024) + '... [truncated: body too large]';
      return new EsadadError('INVALID_REQUEST', 'Request body too large');
    }
    try {
      ctx.doc = parseXml(ctx.rawXml);
      ctx.header = parseHeader(ctx.doc);
      return undefined;
    } catch (err) {
      return err instanceof EsadadError ? err : new EsadadError('INVALID_REQUEST', 'Malformed XML');
    }
  }

  /**
   * Resolves the GUID: query string first, then `MsgHeader/GUID`. When both
   * are present they must match, because the query string is not signed.
   * An invalid GUID is never echoed back.
   */
  private checkGuid(ctx: RequestContext, input: HandlerInput): EsadadError | undefined {
    const headerGuid = ctx.header.guid ?? '';
    if (!ctx.guid) ctx.guid = headerGuid;
    if (!ctx.guid) return new EsadadError('INVALID_REQUEST', 'GUID is required');
    if (!GUID_PATTERN.test(ctx.guid)) {
      ctx.guid = '';
      return new EsadadError('INVALID_REQUEST', 'GUID has an invalid format');
    }
    if (input?.guid && headerGuid && headerGuid.toLowerCase() !== ctx.guid.toLowerCase()) {
      return new EsadadError('INVALID_REQUEST', 'GUID in query string does not match MsgHeader/GUID');
    }
    return undefined;
  }

  // --- Steps 2 and 7 --------------------------------------------------------

  private async log(ctx: RequestContext, handler: ApiHandler, type: 'Request' | 'Response', xml: string, resultCode?: number) {
    try {
      const fields = ctx.doc ? handler.describe(ctx.doc) : {};
      await this.options.store.logTransaction({
        transactionType: type,
        api: ctx.api,
        guid: ctx.guid,
        ...fields,
        xml,
        resultCode,
        createdAt: new Date(),
      });
    } catch (err) {
      // A failed audit-log write must not change the answer sent to E-SADAD.
      this.options.logger.error?.(`[${ctx.api}] ${ctx.guid}: failed to write ${type} log`, err);
    }
  }

  // --- Step 4 ---------------------------------------------------------------

  private checkCredentials(input: HandlerInput): void {
    const expected = this.options.credentials;
    if (!expected) return;
    const usernameOk = safeEqual(String(input.username ?? ''), expected.username);
    const passwordOk = safeEqual(String(input.password ?? ''), expected.password);
    if (!usernameOk || !passwordOk) throw new EsadadError('AUTHENTICATION_FAILED');
  }

  private async checkSignature(doc: XDocument): Promise<void> {
    if (!this.options.verifySignature) return;
    const signature = text(doc, 'MsgFooter', 'Signature') ?? text(doc, 'Signature');
    if (!signature) throw new EsadadError('INVALID_SIGNATURE', 'Signature not found');

    let valid = false;
    try {
      valid = await this.options.signer.verify(canonicalMsgBody(doc), signature);
    } catch (err) {
      this.options.logger.warn?.('Signature verification threw', err);
    }
    if (!valid) throw new EsadadError('INVALID_SIGNATURE');
  }

  // --- Errors ---------------------------------------------------------------

  private errorReply(handler: ApiHandler, ctx: RequestContext, err: unknown): Reply {
    const result = this.options.results.fromError(err);
    if (err instanceof EsadadError) {
      this.options.logger.warn?.(`[${ctx.api}] ${ctx.guid}: ${result.code} ${result.desc} (${err.message})`);
    } else {
      this.options.logger.error?.(`[${ctx.api}] ${ctx.guid}: unexpected error`, err);
    }
    return { result, body: this.safeErrorBody(handler, ctx, result) };
  }

  /** The error body echoes request values; if building it fails, fall back to an empty `<MsgBody>`. */
  private safeErrorBody(handler: ApiHandler, ctx: RequestContext, result: Reply['result']): Reply['body'] {
    try {
      return handler.errorBody(ctx, result);
    } catch (err) {
      this.options.logger.error?.(`[${ctx.api}] ${ctx.guid}: failed to build error body`, err);
      return el('MsgBody');
    }
  }

  // --- Step 6 ---------------------------------------------------------------

  private async buildResponse(responseType: string, guid: string, reply: Reply): Promise<string> {
    // Sign the canonical form of the body, exactly as E-SADAD will verify it.
    const signature = await this.options.signer.sign(canonicalMsgBody(parseXml(toXml(reply.body))));
    const envelope = buildEnvelope({
      timestamp: this.options.timestamp(),
      guid,
      senderCode: this.options.billerCode,
      responseType,
      result: reply.result,
      body: reply.body,
      signature,
    });
    return toXml(envelope);
  }
}

export const defaultTimestamp = (): string => formatTimestamp();
