import type { ApiName, Currency, ResultCode, ResultCodeKey, ResultCodes } from './constants';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** A file on disk, or its contents already loaded into memory. */
export type FileOrData = { path: string } | { data: string | Buffer };

export type PaymentType = 'PostPaid' | 'PrePaid';

/** Biller information (the "Biller" config table in the integration document). */
export interface BillerInfo {
  /** Biller code assigned by E-SADAD. Sent as `SdrCode` and `BillerCode`. */
  code: string | number;
  name?: string;
}

/** One E-SADAD service (the "eSadad Services Configurations" table). */
export interface ServiceConfig {
  /** `ServiceType` code as registered with E-SADAD, for example `TELC_Recharge`. */
  serviceType: string;
  nameAr?: string;
  nameEn?: string;
  paymentType: PaymentType;
  currency: Currency;
  /** Settlement bank code, sent as `SetBnkCode`. */
  bankCode: string | number;
  /** Settlement IBAN, sent as `AcctNo` in `SubPmt`. */
  iban: string;
  /** Allow partial payment (BillPull `PmtConst/AllowPart`). Defaults to `false`. */
  partialPayment?: boolean;
  /** Minimum accepted amount (inclusive). */
  lowerValue?: number;
  /** Maximum accepted amount (inclusive). */
  upperValue?: number;
}

/**
 * Digital signature certificates (the "Digital Signature Certificates" table).
 * Provide either `billerPfx` or `billerPrivateKey`.
 */
export interface CertificatesConfig {
  /** E-SADAD public certificate (`.cer`/`.crt`, PEM or DER) or a PEM public key. Used to verify requests. */
  esadadCertificate: FileOrData;
  /** Biller PKCS#12 (`.pfx`/`.p12`) holding the private key used to sign responses. */
  billerPfx?: FileOrData & { password: string };
  /** Alternative to `billerPfx`: a PEM private key (PKCS#1 or PKCS#8). */
  billerPrivateKey?: FileOrData & { passphrase?: string };
}

/** Optional `username`/`password` query-string credentials. */
export interface Credentials {
  username: string;
  password: string;
}

export interface Logger {
  debug?(message: string, meta?: unknown): void;
  info?(message: string, meta?: unknown): void;
  warn?(message: string, meta?: unknown): void;
  error?(message: string, meta?: unknown): void;
}

export interface EsadadConfig {
  biller: BillerInfo;
  services: ServiceConfig[];
  /** Certificates used for signing and verification. Ignored when `signer` is given. */
  certificates?: CertificatesConfig;
  /** Custom signer, for example one backed by an HSM. Takes precedence over `certificates`. */
  signer?: MessageSigner;
  /** Connects the library to your billing system. */
  adapter: BillerAdapter;
  /** Persistence for transaction and payment logs. Defaults to an in-memory store (not for production). */
  store?: EsadadStore;
  /** When set, the `username`/`password` query parameters must match. */
  credentials?: Credentials;
  /** Verify incoming request signatures. Defaults to `true`. Turn off only in local development. */
  verifySignature?: boolean;
  /**
   * Normalises or validates a billing number before it reaches the adapter.
   * Return `null` or `''` to reject it with INVALID_BILLING_NUMBER.
   * Defaults to trimming whitespace.
   */
  normalizeBillingNo?: (billingNo: string, serviceType: string) => string | null | undefined;
  /**
   * Time limit in milliseconds for the read-only adapter calls (`getBills`,
   * `validatePrepaid`). When exceeded, E-SADAD gets GENERAL_ERROR instead of
   * waiting forever. Not applied to `postPayment`: a payment that timed out
   * could still complete and be posted again on retry. Default: no limit.
   */
  adapterTimeoutMs?: number;
  /** Background callbacks (SMS, e-mail, webhooks, metrics). They never delay or change the response. */
  hooks?: EsadadHooks;
  /** Maximum request body size in bytes. Defaults to 512 KB. Larger requests get INVALID_REQUEST. */
  maxBodyBytes?: number;
  /** Override the default result codes (for example, if E-SADAD assigns different numbers). */
  resultCodes?: Partial<ResultCodes>;
  /** Timestamp for `MsgHeader/TmStp`. Defaults to local time as `YYYY-MM-DDTHH:mm:ss`. */
  timestamp?: () => string;
  /** Shared token for the `/availability` endpoint. */
  availabilityToken?: string;
  /** Extra health check used by `/availability`. Throw or return `false` to report the service as unavailable. */
  healthCheck?: () => boolean | void | Promise<boolean | void>;
  logger?: Logger;
}

/** Data passed to `hooks.onRequestCompleted`. */
export interface RequestCompletedEvent {
  api: ApiName;
  guid: string;
  /** Header-level result sent to E-SADAD. */
  result: ResultCode;
  /** Time from receiving the request to having the signed response, in milliseconds. */
  durationMs: number;
  requestXml: string;
  responseXml: string;
}

/**
 * Callbacks run in the background after the response is ready. They never
 * delay or change what E-SADAD receives; errors are sent to `logger.error`.
 */
export interface EsadadHooks {
  /**
   * A payment was posted to your billing system. Not called for retries of an
   * already-posted payment. Use it for SMS or e-mail confirmations.
   */
  onPaymentPosted?(transaction: PaymentTransaction, ctx: HandlerContext): void | Promise<void>;
  /** Any XML request was answered (success or error). Use it for metrics and alerts. */
  onRequestCompleted?(event: RequestCompletedEvent): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

export interface MessageSigner {
  /** Returns the base64 signature of the canonical `MsgBody` string. */
  sign(canonicalMsgBody: string): string | Promise<string>;
  /** Verifies a base64 signature against the canonical `MsgBody` string. */
  verify(canonicalMsgBody: string, signatureBase64: string): boolean | Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Parsed requests
// ---------------------------------------------------------------------------

export interface MessageHeader {
  timestamp?: string;
  guid?: string;
  senderCode?: string;
  receiverCode?: string;
  requestType?: string;
}

export interface SubPayment {
  amount: number;
  /** `SetBnkCode`. */
  bankCode: string;
  /** `AcctNo` (IBAN). */
  accountNo: string;
}

interface BaseRequest {
  /** GUID from the query string, or from `MsgHeader/GUID` when the query string has none. */
  guid: string;
  header: MessageHeader;
  /** The raw request XML. */
  rawXml: string;
}

export interface BillPullRequest extends BaseRequest {
  /** Billing number after `normalizeBillingNo`. */
  billingNo: string;
  /** Billing number exactly as received. */
  originalBillingNo: string;
  billNo?: string;
  serviceType: string;
  service: ServiceConfig;
}

export interface PrepaidValidationRequest extends BaseRequest {
  billingNo: string;
  originalBillingNo: string;
  billerCode?: string;
  /** Amount the customer wants to pay. */
  dueAmount?: number;
  validationCode?: string;
  serviceType: string;
  prepaidCategory?: string;
  currency?: string;
  service: ServiceConfig;
}

export interface PaymentTransaction {
  guid: string;
  billingNo: string;
  originalBillingNo: string;
  billNo?: string;
  /** E-SADAD transaction number (`JOEBPPSTrx`). */
  joebppsTrx: string;
  bankTrxId?: string;
  bankCode?: string;
  paymentStatus?: string;
  dueAmount?: number;
  paidAmount: number;
  feesAmount?: number;
  feesOnBiller?: boolean;
  processDate?: string;
  stmtDate?: string;
  accessChannel?: string;
  paymentMethod?: string;
  paymentType?: string;
  currency?: string;
  serviceType: string;
  prepaidCategory?: string;
  validationCode?: string;
  subPayments: SubPayment[];
  service?: ServiceConfig;
}

export interface PaymentNotificationRequest extends BaseRequest {
  transactions: PaymentTransaction[];
}

// ---------------------------------------------------------------------------
// Adapter: your billing system
// ---------------------------------------------------------------------------

/** A result code: either a key of the result-code table or a full code object. */
export type ResultInput = ResultCodeKey | ResultCode;

export type BillStatus = 'BillNew' | 'BillUpdated' | 'BillExpired' | (string & {});

export interface BillRecord {
  /** Defaults to the requested billing number. */
  billingNo?: string;
  billNo?: string;
  /** Amount due. Use `0` for a bill with nothing due. */
  dueAmount: number;
  billStatus?: BillStatus;
  issueDate?: string | Date;
  openDate?: string | Date;
  dueDate?: string | Date;
  expiryDate?: string | Date;
  closeDate?: string | Date;
  /** Overrides `ServiceConfig.partialPayment`. */
  allowPartial?: boolean;
  /** Overrides `ServiceConfig.lowerValue`. */
  lowerAmount?: number;
  /** Overrides `ServiceConfig.upperValue`. */
  upperAmount?: number;
  /** Defaults to one sub-payment of `dueAmount` to the service's bank code and IBAN. */
  subPayments?: SubPayment[];
}

export type BillPullResult = { found: false; result?: ResultInput } | { found: true; bills: BillRecord[] };

export type PrepaidValidationResult =
  | {
      valid: true;
      /** Overrides the requested amount. */
      dueAmount?: number;
      /** Overrides the requested validation code. */
      validationCode?: string;
      subPayments?: SubPayment[];
    }
  | { valid: false; result?: ResultInput };

export type PostPaymentResult = { success: true } | { success: false; result?: ResultInput };

export interface HandlerContext {
  api: ApiName;
  guid: string;
}

/**
 * Connects the library to your billing system. Implement only the methods for
 * the APIs you expose.
 *
 * Throw an `EsadadError` to return a specific result code. Any other thrown
 * error becomes GENERAL_ERROR.
 */
export interface BillerAdapter {
  /** BillPull (post-paid services). */
  getBills?(request: BillPullRequest, ctx: HandlerContext): Promise<BillPullResult> | BillPullResult;
  /** PrepaidValidation (pre-paid services). */
  validatePrepaid?(
    request: PrepaidValidationRequest,
    ctx: HandlerContext,
  ): Promise<PrepaidValidationResult> | PrepaidValidationResult;
  /**
   * Posts a payment to your billing system. Once it succeeds for a
   * `JOEBPPSTrx`, retries from E-SADAD are answered from the payment log and
   * this is not called again. Return `{ success: false }` or throw when posting
   * fails: the payment stays unposted, so the next retry posts it.
   */
  postPayment?(
    transaction: PaymentTransaction,
    ctx: HandlerContext,
  ): Promise<PostPaymentResult | void> | PostPaymentResult | void;
}

// ---------------------------------------------------------------------------
// Store: transaction and payment logs
// ---------------------------------------------------------------------------

export interface TransactionLogEntry {
  transactionType: 'Request' | 'Response';
  api: ApiName;
  guid: string;
  billingNo?: string;
  billNo?: string;
  serviceType?: string;
  currency?: string;
  xml: string;
  resultCode?: number;
  createdAt: Date;
}

export interface PaymentLogEntry {
  guid: string;
  joebppsTrx: string;
  billingNo: string;
  billNo?: string;
  serviceType: string;
  currency?: string;
  paidAmount: number;
  isPaymentPosted: boolean;
  createdAt: Date;
}

export interface EsadadStore {
  /** Adds a row to EsadadTransactionsLogs. */
  logTransaction(entry: TransactionLogEntry): Promise<void> | void;
  /** Adds a row to EsadadPaymentsLogs with `isPaymentPosted = false`. */
  logPayment(entry: PaymentLogEntry): Promise<void> | void;
  /**
   * True when the E-SADAD transaction `joebppsTrx` has already been posted.
   *
   * Match on `joebppsTrx`: it is inside the signed `MsgBody`. The GUID comes
   * from the unsigned query string and is passed for information only, so
   * keying on it alone would let a replayed request post a payment twice.
   */
  isPaymentPosted(joebppsTrx: string, guid: string): Promise<boolean> | boolean;
  /** Sets `isPaymentPosted = true` on the most recent row for `joebppsTrx`. */
  markPaymentPosted(joebppsTrx: string, guid: string): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Handler input/output
// ---------------------------------------------------------------------------

export interface HandlerInput {
  /** Raw XML request body. */
  body: string | Buffer;
  /** `guid` query-string parameter. */
  guid?: string;
  /** `username` query-string parameter (optional). */
  username?: string;
  /** `password` query-string parameter (optional). */
  password?: string;
}

export interface HandlerOutput {
  /** Signed XML response. Return it with HTTP 200 and `Content-Type: application/xml`. */
  xml: string;
  /** Header-level result. */
  result: ResultCode;
  api: ApiName;
  guid: string;
}

export interface AvailabilityResponse {
  status: 'success' | 'error';
  availability?: { response_time: number; status_code: number; status_message: string };
  message?: string;
  error_code?: number;
  checked_at: string;
}
