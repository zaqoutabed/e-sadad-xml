import type { ApiName, ResultCode } from '../constants';
import type { KeyedLock } from '../core/lock';
import type { ResultResolver } from '../core/results';
import type { ServiceRegistry } from '../core/services';
import type {
  BillerAdapter,
  EsadadHooks,
  EsadadStore,
  HandlerContext,
  Logger,
  MessageHeader,
  TransactionLogEntry,
} from '../types';
import type { XmlNode } from '../xml/builder';
import type { XDocument } from '../xml/parser';

/** Everything a handler needs. Built once by `EsadadService`. */
export interface HandlerDeps {
  billerCode: string;
  adapter: BillerAdapter;
  store: EsadadStore;
  services: ServiceRegistry;
  results: ResultResolver;
  logger: Logger;
  locks: KeyedLock;
  hooks: EsadadHooks;
}

/** Fields copied from a request into the transaction log. */
export type LogFields = Pick<TransactionLogEntry, 'billingNo' | 'billNo' | 'serviceType' | 'currency'>;

/** One incoming request as it moves through the pipeline. */
export interface RequestContext {
  api: ApiName;
  /** GUID from the query string, or from `MsgHeader/GUID`. */
  guid: string;
  rawXml: string;
  /** Parsed document. Always set when `process` runs; may be missing in `errorBody`. */
  doc?: XDocument;
  header: MessageHeader;
}

/** What a handler answers: the header result and the `<MsgBody>`. */
export interface Reply {
  result: ResultCode;
  body: XmlNode;
}

/**
 * One E-SADAD API. The shared steps (logging, credentials, signature,
 * signing the response) live in `RequestPipeline`; a handler only contains
 * the parts specific to its API.
 *
 * To add an API, implement this interface and expose it from `EsadadService`.
 */
export interface ApiHandler {
  readonly api: ApiName;
  /** `ResTyp` of the response, for example `BILRPREPADVALRS`. */
  readonly responseType: string;

  /** Extracts the fields logged with the request. Must not throw on incomplete requests. */
  describe(doc: XDocument): LogFields;

  /** Optional step after the request is logged and before the signature is verified. */
  beforeVerify?(ctx: RequestContext): Promise<void>;

  /** Business logic. Runs only for well-formed, authenticated, correctly signed requests. */
  process(ctx: RequestContext): Promise<Reply>;

  /** `<MsgBody>` for a header-level error (bad signature, bad credentials, malformed request, unexpected error). */
  errorBody(ctx: RequestContext, result: ResultCode): XmlNode;
}

export function handlerContext(ctx: RequestContext): HandlerContext {
  return { api: ctx.api, guid: ctx.guid };
}
