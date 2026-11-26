import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { EsadadConfigError } from '../errors';
import { InMemoryAccessTokenStore } from '../storage/accessTokenMemory';
import type {
  AccessTokenStore,
  AuthenticationConfig,
  AuthenticationErrorData,
  AuthenticationResponseBody,
  AuthenticationSuccessData,
  AuthSignatureFormat,
  Logger,
  MessageSigner,
} from '../types';

const DEFAULT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
/** Requests larger than this are rejected before parsing. */
export const MAX_AUTH_BODY_BYTES = 16 * 1024;
const MAX_FIELD_LENGTH = 512;
/** ISO 8601 date-time, with optional fractions and time zone (`Z` or `±hh:mm`). */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/;

export interface AuthenticationResult {
  /** HTTP status code to send: 200, 400, 401, 500 or 503. */
  statusCode: number;
  /** Signed JSON body to send. */
  body: AuthenticationResponseBody;
}

/** Fields of a well-formed request. */
interface AuthRequest {
  data: Record<string, unknown> & { user: string; secret: string; tranTimestamp: string };
  signature: string;
}

/**
 * The text that is signed for a `data` object:
 * - `pipe`: the values in their original order, joined with `|`
 * - `json`: the object as compact JSON
 */
export function authSigningString(data: object, format: AuthSignatureFormat): string {
  if (format === 'json') return JSON.stringify(data);
  return Object.values(data as Record<string, unknown>)
    .map((value) => (value === null || value === undefined ? '' : String(value)))
    .join('|');
}

/** Lowercase hex SHA-256 of a token. Stores only ever see this, never the token. */
export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** ISO 8601 UTC without milliseconds: `2025-05-14T12:34:56Z`. */
function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Constant-time comparison that does not leak the length of either value. */
function sameSecret(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Authentication API (`POST /authentication`), as described in the E-SADAD
 * Authentication API document.
 *
 * 1. Checks that the body has `data.user`, `data.secret`, `data.tranTimestamp` and `signature`.
 * 2. Verifies E-SADAD's signature over the `data` values (UTF-8, RSA SHA-256 PKCS#1).
 * 3. Rejects a `tranTimestamp` too far from the server clock (replay protection).
 * 4. Checks the shared user and secret in constant time.
 * 5. Issues a token: SHA-256 hex of `user:tranTimestamp:UUID`, valid for 7 days by default.
 *
 * Every response, success or error, is signed with the biller private key.
 */
export class Authenticator {
  private readonly tokenTtlMs: number;
  private readonly maxClockSkewMs: number | false;
  private readonly requestFormats: AuthSignatureFormat[];
  private readonly responseFormat: AuthSignatureFormat;
  private readonly tokenStore: AccessTokenStore;

  constructor(
    private readonly config: AuthenticationConfig,
    private readonly signer: MessageSigner,
    private readonly logger: Logger,
  ) {
    assertAuthenticationConfig(config, signer);
    this.tokenTtlMs = config.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.maxClockSkewMs = config.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
    this.requestFormats = config.requestSignatureFormats ?? ['pipe', 'json'];
    this.responseFormat = config.responseSignatureFormat ?? 'pipe';
    if (config.tokenStore) {
      this.tokenStore = config.tokenStore;
    } else {
      logger.warn?.('No authentication tokenStore configured: tokens are kept in memory and lost on restart.');
      this.tokenStore = new InMemoryAccessTokenStore();
    }
  }

  /** Handles one request. `body` is the raw body (string or Buffer) or an already-parsed object. Never throws. */
  async authenticate(body: unknown): Promise<AuthenticationResult> {
    const request = parseRequest(body);
    if (!request) return this.error(400, 'Invalid request', tranTimestampOf(body));
    const { data, signature } = request;

    if (!(await this.signatureIsValid(data, signature))) {
      this.logger.warn?.('Authentication rejected: invalid signature');
      return this.error(401, 'Invalid signature', data.tranTimestamp);
    }

    if (!this.timestampIsFresh(data.tranTimestamp)) {
      this.logger.warn?.('Authentication rejected: tranTimestamp outside the allowed clock skew', {
        tranTimestamp: data.tranTimestamp,
      });
      return this.error(401, 'Request expired', data.tranTimestamp);
    }

    // Evaluate both comparisons so the timing does not tell which one failed.
    const userOk = sameSecret(data.user, this.config.user);
    const secretOk = sameSecret(data.secret, this.config.secret);
    if (!userOk || !secretOk) {
      this.logger.warn?.('Authentication rejected: invalid user credentials');
      return this.error(401, 'Invalid user credentials', data.tranTimestamp);
    }

    const token = createHash('sha256').update(`${data.user}:${data.tranTimestamp}:${randomUUID()}`, 'utf8').digest('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + this.tokenTtlMs);
    try {
      await this.tokenStore.saveAccessToken({
        tokenHash: hashAccessToken(token),
        user: data.user,
        issuedAt,
        expiresAt,
        tranTimestamp: data.tranTimestamp,
      });
    } catch (err) {
      this.logger.error?.('Authentication failed: the token could not be saved', err);
      return this.error(500, 'Internal error', data.tranTimestamp);
    }

    this.logger.info?.('Authentication succeeded: token issued', { expiresAt: isoSeconds(expiresAt) });
    const success: AuthenticationSuccessData = {
      token,
      expiryDate: isoSeconds(expiresAt),
      tranTimestamp: data.tranTimestamp,
    };
    return this.respond(200, success);
  }

  /** `true` when the token was issued by `authenticate` and has not expired. */
  async verifyAccessToken(token: unknown): Promise<boolean> {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) return false;
    try {
      const record = await this.tokenStore.findAccessToken(hashAccessToken(token.toLowerCase()));
      return !!record && record.expiresAt.getTime() > Date.now();
    } catch (err) {
      this.logger.error?.('Access token lookup failed', err);
      return false;
    }
  }

  private async signatureIsValid(data: AuthRequest['data'], signature: string): Promise<boolean> {
    for (const format of this.requestFormats) {
      try {
        if (await this.signer.verifyUtf8!(authSigningString(data, format), signature)) return true;
      } catch (err) {
        this.logger.error?.('Authentication signature verification failed', err);
        return false;
      }
    }
    return false;
  }

  private timestampIsFresh(tranTimestamp: string): boolean {
    if (this.maxClockSkewMs === false) return true;
    return Math.abs(Date.now() - Date.parse(tranTimestamp)) <= this.maxClockSkewMs;
  }

  private error(statusCode: number, message: string, tranTimestamp: string): Promise<AuthenticationResult> {
    const data: AuthenticationErrorData = { status: 'error', message, error_code: statusCode, tranTimestamp };
    return this.respond(statusCode, data);
  }

  private async respond(
    statusCode: number,
    data: AuthenticationSuccessData | AuthenticationErrorData,
  ): Promise<AuthenticationResult> {
    try {
      const signature = await this.signer.signUtf8!(authSigningString(data, this.responseFormat));
      return { statusCode, body: { data, signature } };
    } catch (err) {
      this.logger.error?.('Authentication response could not be signed', err);
      const failure: AuthenticationErrorData = {
        status: 'error',
        message: 'Internal error',
        error_code: 500,
        tranTimestamp: data.tranTimestamp,
      };
      return { statusCode: 500, body: { data: failure, signature: '' } };
    }
  }
}

function assertAuthenticationConfig(config: AuthenticationConfig, signer: MessageSigner): void {
  if (typeof config.user !== 'string' || !config.user.trim()) throw new EsadadConfigError('authentication.user is required');
  if (typeof config.secret !== 'string' || !config.secret) throw new EsadadConfigError('authentication.secret is required');
  if (config.tokenTtlMs !== undefined && !(config.tokenTtlMs > 0)) {
    throw new EsadadConfigError('authentication.tokenTtlMs must be a positive number');
  }
  if (config.maxClockSkewMs !== undefined && config.maxClockSkewMs !== false && !(config.maxClockSkewMs > 0)) {
    throw new EsadadConfigError('authentication.maxClockSkewMs must be a positive number or false');
  }
  const formats = config.requestSignatureFormats;
  if (formats !== undefined && (!Array.isArray(formats) || !formats.length || !formats.every(isFormat))) {
    throw new EsadadConfigError("authentication.requestSignatureFormats must list 'pipe' and/or 'json'");
  }
  if (config.responseSignatureFormat !== undefined && !isFormat(config.responseSignatureFormat)) {
    throw new EsadadConfigError("authentication.responseSignatureFormat must be 'pipe' or 'json'");
  }
  if (typeof signer.signUtf8 !== 'function' || typeof signer.verifyUtf8 !== 'function') {
    throw new EsadadConfigError('authentication needs a signer with signUtf8 and verifyUtf8');
  }
}

function isFormat(value: unknown): value is AuthSignatureFormat {
  return value === 'pipe' || value === 'json';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}

/** Parses and checks the request body. `undefined` when it is not a well-formed request. */
function parseRequest(body: unknown): AuthRequest | undefined {
  let parsed: unknown = body;
  if (Buffer.isBuffer(body)) {
    if (body.length > MAX_AUTH_BODY_BYTES) return undefined;
    parsed = body.toString('utf8');
  }
  if (typeof parsed === 'string') {
    if (Buffer.byteLength(parsed) > MAX_AUTH_BODY_BYTES) return undefined;
    try {
      parsed = JSON.parse(parsed.replace(/^\uFEFF/, ''));
    } catch {
      return undefined;
    }
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.data) || typeof parsed.signature !== 'string') return undefined;
  const data = parsed.data;
  if (!isField(data.user) || !isField(data.secret) || !isField(data.tranTimestamp)) return undefined;
  if (!ISO_DATE_TIME.test(data.tranTimestamp) || Number.isNaN(Date.parse(data.tranTimestamp))) return undefined;
  return { data: data as AuthRequest['data'], signature: parsed.signature };
}

/** Best-effort `tranTimestamp` of a malformed request, echoed back in the error. */
function tranTimestampOf(body: unknown): string {
  try {
    const raw = Buffer.isBuffer(body) || typeof body === 'string' ? String(body) : undefined;
    if (raw !== undefined && Buffer.byteLength(raw) > MAX_AUTH_BODY_BYTES) return '';
    const parsed: unknown = raw !== undefined ? JSON.parse(raw.replace(/^\uFEFF/, '')) : body;
    const value = isPlainObject(parsed) && isPlainObject(parsed.data) ? parsed.data.tranTimestamp : undefined;
    return isField(value) ? value : '';
  } catch {
    return '';
  }
}
